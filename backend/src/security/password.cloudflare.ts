import setupWasm from "argon2id/lib/setup.js";
import simdWasmModule from "argon2id/dist/simd.wasm";
import nonSimdWasmModule from "argon2id/dist/no-simd.wasm";

const ARGON2_PARAMETERS = {
  parallelism: 4,
  passes: 3,
  memorySize: 65_536,
  tagLength: 32,
};

const encoder = new TextEncoder();

// setupWasm reçoit des modules déjà compilés par Wrangler. On n'envoie jamais
// des octets à WebAssembly.compile(), API interdite dans le runtime Workers.
const instantiate = async (
  module: WebAssembly.Module,
  importObject: WebAssembly.Imports,
) => ({
  module,
  instance: await WebAssembly.instantiate(module, importObject),
});

type Argon2Compute = (params: {
  password: Uint8Array;
  salt: Uint8Array;
  parallelism: number;
  passes: number;
  memorySize: number;
  tagLength: number;
}) => Uint8Array;

type WasmInstanceLoader = (
  imports: WebAssembly.Imports,
) => Promise<{ module: WebAssembly.Module; instance: WebAssembly.Instance }>;

const setupArgon2 = setupWasm as (
  getSIMD: WasmInstanceLoader,
  getNonSIMD: WasmInstanceLoader,
) => Promise<Argon2Compute>;

let argon2Promise: Promise<Argon2Compute> | null = null;

function getArgon2(): Promise<Argon2Compute> {
  if (!argon2Promise) {
    argon2Promise = setupArgon2(
      (imports) => instantiate(simdWasmModule, imports),
      (imports) => instantiate(nonSimdWasmModule, imports),
    );
  }
  return argon2Promise;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=+$/u, "");
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+$/u.test(value)) {
    throw new Error("Encodage Base64 Argon2 invalide.");
  }
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

interface ParsedHash {
  salt: Uint8Array;
  digest: Uint8Array;
  memorySize: number;
  passes: number;
  parallelism: number;
}

function parsePhcHash(encodedHash: string): ParsedHash | null {
  try {
    const parts = encodedHash.split("$");
    if (
      parts.length !== 6 ||
      parts[0] !== "" ||
      parts[1] !== "argon2id" ||
      parts[2] !== "v=19"
    ) {
      return null;
    }

    const parameters = Object.fromEntries(
      parts[3].split(",").map((part) => part.split("=", 2)),
    );
    const memorySize = Number(parameters.m);
    const passes = Number(parameters.t);
    const parallelism = Number(parameters.p);
    const salt = decodeBase64(parts[4]);
    const digest = decodeBase64(parts[5]);

    // Bornes strictes pour ne jamais laisser un hash stocké en base imposer
    // une consommation mémoire/CPU arbitraire au Worker.
    if (
      !Number.isSafeInteger(memorySize) || memorySize < 8 * parallelism || memorySize > 65_536 ||
      !Number.isSafeInteger(passes) || passes < 1 || passes > 10 ||
      !Number.isSafeInteger(parallelism) || parallelism < 1 || parallelism > 4 ||
      salt.length < 8 || salt.length > 64 ||
      digest.length < 16 || digest.length > 64
    ) {
      return null;
    }

    return { salt, digest, memorySize, passes, parallelism };
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function hashPasswordWithWasm(password: string): Promise<string> {
  const argon2 = await getArgon2();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = argon2({
    password: encoder.encode(password),
    salt,
    ...ARGON2_PARAMETERS,
  });

  return [
    "",
    "argon2id",
    "v=19",
    `m=${ARGON2_PARAMETERS.memorySize},t=${ARGON2_PARAMETERS.passes},p=${ARGON2_PARAMETERS.parallelism}`,
    encodeBase64(salt),
    encodeBase64(digest),
  ].join("$");
}

export async function verifyPasswordWithWasm(
  encodedHash: string,
  password: string,
): Promise<boolean> {
  const parsed = parsePhcHash(encodedHash);
  if (!parsed) return false;

  const argon2 = await getArgon2();
  const actualDigest = argon2({
    password: encoder.encode(password),
    salt: parsed.salt,
    memorySize: parsed.memorySize,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
    tagLength: parsed.digest.length,
  });

  return constantTimeEqual(actualDigest, parsed.digest);
}
