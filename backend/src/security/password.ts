import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

// Paramètres de node-argon2 conservés (Argon2id v=19) pour rester compatibles
// avec les empreintes de mots de passe déjà enregistrées dans PostgreSQL.
const ARGON2_OPTIONS = {
  parallelism: 4,
  iterations: 3,
  memorySize: 65_536,
  hashLength: 32,
  outputType: "encoded" as const,
};

// Workers limite chaque isolate à 128 Mio. Argon2 utilise 64 Mio par opération :
// sérialiser les opérations dans un isolate évite plusieurs allocations WASM simultanées.
let passwordJobQueue: Promise<void> = Promise.resolve();

function enqueuePasswordJob<T>(job: () => Promise<T>): Promise<T> {
  const result = passwordJobQueue.then(job, job);
  passwordJobQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function hashPassword(password: string): Promise<string> {
  return enqueuePasswordJob(async () => {
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

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return enqueuePasswordJob(async () => {
    try {
      return await argon2Verify({ password, hash });
    } catch {
      return false;
    }
  });
}
