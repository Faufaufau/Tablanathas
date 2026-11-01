import { randomBytes, timingSafeEqual } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

const ARGON2_OPTIONS = {
  parallelism: 4,
  iterations: 3,
  memorySize: 65_536,
  hashLength: 32,
  outputType: "encoded" as const,
};

const HASH_PATTERN = /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PASSWORD_LENGTH = 4_096;

let passwordJobQueue: Promise<void> = Promise.resolve();

function enqueuePasswordJob<T>(job: () => Promise<T>): Promise<T> {
  const result = passwordJobQueue.then(job, job);
  passwordJobQueue = result.then(() => undefined, () => undefined);
  return result;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function authorized(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (supplied.length !== expected.length || expected.length < 32) return false;
  return timingSafeEqual(supplied, expected);
}

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("body-too-large");
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("body-too-large");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function handlePasswordRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expectedToken = process.env.PASSWORD_SERVICE_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    return json({ error: "Password service is not configured" }, 503);
  }
  if (!authorized(request, expectedToken)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof Error && error.message === "body-too-large" ? "Request too large" : "Invalid JSON" }, 400);
  }

  if (!isRecord(body) || typeof body.password !== "string" || body.password.length > MAX_PASSWORD_LENGTH) {
    return json({ error: "Invalid request" }, 400);
  }

  try {
    if (body.action === "verify") {
      if (typeof body.hash !== "string" || body.hash.length > 512 || !HASH_PATTERN.test(body.hash)) {
        return json({ valid: false });
      }

      const valid = await enqueuePasswordJob(() =>
        argon2Verify({ password: body.password as string, hash: body.hash as string }),
      );
      return json({ valid });
    }

    if (body.action === "hash") {
      const hash = await enqueuePasswordJob(async () => {
        const encoded = await argon2id({
          password: body.password as string,
          salt: randomBytes(16),
          ...ARGON2_OPTIONS,
        });
        if (typeof encoded !== "string") {
          throw new Error("Argon2id did not return an encoded hash");
        }
        return encoded;
      });
      return json({ hash });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch {
    // Ne jamais journaliser le mot de passe, le hash ou le corps de la requête.
    console.error("[Password service] Argon2id operation failed.");
    return json({ error: "Password operation failed" }, 500);
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    return handlePasswordRequest(request);
  },
};
