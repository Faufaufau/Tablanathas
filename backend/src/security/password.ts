import { randomBytes } from "node:crypto";

// Les opérations Argon2 locales sont sérialisées : chaque calcul consomme
// environ 64 Mio de mémoire avec les paramètres conservés de node-argon2.
let passwordJobQueue: Promise<void> = Promise.resolve();

function enqueuePasswordJob<T>(job: () => Promise<T>): Promise<T> {
  const result = passwordJobQueue.then(job, job);
  passwordJobQueue = result.then(() => undefined, () => undefined);
  return result;
}

function isCloudflareWorker(): boolean {
  return process.env.WORKER_RUNTIME === "cloudflare";
}

function useNeonPasswordService(): boolean {
  return isCloudflareWorker() && process.env.NODE_ENV === "production";
}

const ARGON2_OPTIONS = {
  parallelism: 4,
  iterations: 3,
  memorySize: 65_536,
  hashLength: 32,
  outputType: "encoded" as const,
};

const EXPECTED_HASH_PREFIX = "$argon2id$v=19$m=65536,t=3,p=4$";
const ENCODED_HASH_PATTERN = /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u;

type PasswordServiceResponse = {
  valid?: unknown;
  hash?: unknown;
};

async function callNeonPasswordService(
  payload: { action: "verify"; hash: string; password: string } | { action: "hash"; password: string },
): Promise<PasswordServiceResponse> {
  const serviceUrl = process.env.PASSWORD_SERVICE_URL?.trim();
  const serviceToken = process.env.PASSWORD_SERVICE_TOKEN?.trim();

  if (!serviceUrl || !serviceToken) {
    throw new Error("Le service Neon de calcul des mots de passe n'est pas configuré en production.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(serviceUrl);
  } catch {
    throw new Error("PASSWORD_SERVICE_URL n'est pas une URL valide.");
  }
  if (endpoint.protocol !== "https:") {
    throw new Error("Le service Neon de mots de passe doit être appelé en HTTPS.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Ne pas recopier le corps distant dans les logs : il pourrait contenir
    // des informations internes. Le statut suffit pour le diagnostic.
    throw new Error(`Le service Neon de mots de passe a répondu HTTP ${response.status}.`);
  }

  const result: unknown = await response.json();
  if (!result || typeof result !== "object") {
    throw new Error("Réponse invalide du service Neon de mots de passe.");
  }
  return result as PasswordServiceResponse;
}

export async function hashPassword(password: string): Promise<string> {
  if (useNeonPasswordService()) {
    const result = await callNeonPasswordService({ action: "hash", password });
    if (typeof result.hash !== "string" || !result.hash.startsWith(EXPECTED_HASH_PREFIX) || !ENCODED_HASH_PATTERN.test(result.hash)) {
      throw new Error("Le service Neon n'a pas retourné une empreinte Argon2id compatible.");
    }
    return result.hash;
  }

  return enqueuePasswordJob(async () => {
    if (isCloudflareWorker()) {
      // En développement Wrangler conserve le moteur WASM précompilé local.
      const { hashPasswordWithWasm } = await import("./password.cloudflare.js");
      return hashPasswordWithWasm(password);
    }

    const { argon2id } = await import("hash-wasm");
    const encoded = await argon2id({
      password,
      salt: randomBytes(16),
      ...ARGON2_OPTIONS,
    });
    if (typeof encoded !== "string") {
      throw new Error("Le moteur Argon2 n'a pas retourné un hash encodé.");
    }
    return encoded;
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (useNeonPasswordService()) {
    if (!ENCODED_HASH_PATTERN.test(hash)) return false;
    const result = await callNeonPasswordService({ action: "verify", hash, password });
    if (typeof result.valid !== "boolean") {
      throw new Error("Le service Neon n'a pas retourné de résultat de vérification valide.");
    }
    return result.valid;
  }

  return enqueuePasswordJob(async () => {
    if (isCloudflareWorker()) {
      // En développement Wrangler conserve le moteur WASM précompilé local.
      const { verifyPasswordWithWasm } = await import("./password.cloudflare.js");
      return verifyPasswordWithWasm(hash, password);
    }

    const { argon2Verify } = await import("hash-wasm");
    return argon2Verify({ password, hash });
  });
}
