import { argon2id, argon2Verify } from "hash-wasm";

const ARGON2_MEMORY_KIB = 19456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;
const ARGON2_SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(ARGON2_SALT_BYTES));
  return argon2id({
    password,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "encoded",
  });
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    return false;
  }
}

export function assessPasswordStrength(password: string): string | null {
  if (password.length < 8) return "errors.passwordTooShort";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "errors.passwordNeedsLetterAndNumber";
  }
  return null;
}
