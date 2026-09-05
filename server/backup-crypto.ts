import crypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { errValidation } from "../src/core/errors";
import { dpapiProtect, dpapiUnprotect } from "./dpapi";

/**
 * Encrypted `.gymbak` container ("gymbak2", TASK-042).
 *
 * A v2 file is an AUTHENTICATED envelope wrapping an ENTIRE v1 buffer:
 *
 *   [magic "GYMBAK2\0" (8)][headerLenLE (4)][JSON header][AES-256-GCM ciphertext]
 *
 * The plaintext payload is bit-for-bit the existing v1 composite
 * (`[sqlite][GYMBAK-FILES-V1 trailer]`), so the whole pre-existing verification,
 * manifest and fail-fast restore pipeline works on the decrypted bytes.
 *
 * Security properties:
 *  - authenticated encryption (AES-256-GCM, 12-byte random IV, 16-byte tag);
 *  - tamper detection via GCM tag PLUS a header-held SHA-256 of the payload;
 *  - versioned format (`version: 2`); unknown/newer versions are refused;
 *  - no hardcoded secret — the data key is derived per backup via HKDF-SHA256
 *    from a 256-bit MASTER key with a fresh random salt (KDF metadata recorded
 *    in the header);
 *  - password-based master keys use scrypt (random salt; N/r/p/keyLen and salt
 *    stored in the header) so the password ALONE can reconstruct the key;
 *  - the master key is stored at rest wrapped by Windows DPAPI (CurrentUser),
 *    never in plaintext (see dpapi.ts; fallback = restrictive-permission file).
 *
 * The non-secret header carries only cryptographic envelope + KDF metadata +
 * timestamp/kind; every piece of sensitive metadata (gym/schema/counts) lives
 * inside the encrypted DB payload.
 */

export const BACKUP_CONTAINER_MAGIC = Buffer.from("GYMBAK2\0", "latin1");
export const BACKUP_CONTAINER_MAGIC_B64 = BACKUP_CONTAINER_MAGIC.toString("base64");
export const BACKUP_ENCRYPTED_FORMAT_VERSION = 2;
export const BACKUP_KEY_FILE = "backup-key.json";

export const KEY_SALT_BYTES = 16;
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const HKDF_INFO = "gymsystem:gymbak2:data-key:v1";

export const SCRYPT_N = 65536;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_MAXMEM = 256 * 1024 * 1024;
export const SCRYPT_KEYLEN = 32;

export const MIN_BACKUP_PASSWORD_LENGTH = 8;
export const MAX_BACKUP_PASSWORD_LENGTH = 128;

export interface ScryptParams {
  name: "scrypt";
  N: number;
  r: number;
  p: number;
  keyLen: number;
  /** base64 salt */
  salt: string;
}

export interface HkdfParams {
  name: "hkdf-sha256";
  /** base64 per-backup salt */
  salt: string;
  info: string;
  keyLen: number;
}

export interface BackupKdfEnvelope {
  source: "password" | "key";
  /** present only for password-derived master keys */
  master?: ScryptParams;
  derive: HkdfParams;
}

export interface BackupContainerHeader {
  magic: string;
  format: string;
  version: number;
  cipher: "aes-256-gcm";
  iv: string;
  authTag: string;
  payloadSize: number;
  payloadSha256: string;
  createdAt: string;
  kind: string;
  kdf: BackupKdfEnvelope;
}

export interface CryptMeta {
  kind: string;
  createdAt: string;
  /** "password" when the master key is password-derived. */
  source: "password" | "key";
  /** scrypt master params — present when source === "password". */
  master: ScryptParams | null;
}

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function randomBytes(length: number): Buffer {
  return crypto.randomBytes(length);
}

/** Standard scrypt derivation used for password-based master keys. */
export async function derivePasswordKey(password: string, params: ScryptParams): Promise<Buffer> {
  return scryptAsync(password, Buffer.from(params.salt, "base64"), params.keyLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/** Generate a fresh scrypt parameter set + master key from a plaintext password. */
export async function makeMasterKeyParams(
  password: string,
): Promise<{ masterKey: Buffer; params: ScryptParams }> {
  const salt = crypto.randomBytes(KEY_SALT_BYTES);
  const params: ScryptParams = {
    name: "scrypt",
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keyLen: SCRYPT_KEYLEN,
    salt: salt.toString("base64"),
  };
  const masterKey = await derivePasswordKey(password, params);
  return { masterKey, params };
}

/** Per-backup data key: HKDF-SHA256(master, randomSalt) -> 32 bytes. */
export function deriveDataKey(masterKey: Buffer, salt: Uint8Array): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(masterKey), Buffer.from(salt), HKDF_INFO, SCRYPT_KEYLEN));
}

/** Contains the whole header JSON + ciphertext (excluding the magic/length). */
export function containerPayloadOffset(bytes: Uint8Array): number {
  const headerLen = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8) | ((bytes[10] ?? 0) << 16) | ((bytes[11] ?? 0) << 24);
  return 12 + headerLen;
}

/**
 * Returns true when `bytes` start with the v2 magic (regardless of validity).
 */
export function looksLikeContainer(bytes: Uint8Array): boolean {
  if (bytes.length < BACKUP_CONTAINER_MAGIC.length) return false;
  for (let i = 0; i < BACKUP_CONTAINER_MAGIC.length; i += 1) {
    if (bytes[i] !== BACKUP_CONTAINER_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Parse + validate the header of a v2 container. Returns null when the buffer
 * is not a container at all, and throws errValidation for a container that is
 * structurally corrupt / an unsupported version.
 */
export function parseBackupContainer(bytes: Uint8Array): BackupContainerHeader | null {
  if (!looksLikeContainer(bytes)) return null;
  if (bytes.length < 13) throw errValidation("errors.backupArchiveCorrupt", { reason: "truncated header" });
  const headerLen = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8) | ((bytes[10] ?? 0) << 16) | ((bytes[11] ?? 0) << 24);
  if (headerLen < 12 || 12 + headerLen > bytes.length) {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "invalid header length" });
  }
  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(bytes.subarray(12, 12 + headerLen)).toString("utf8"));
  } catch {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "header is not JSON" });
  }
  const h = header as Partial<BackupContainerHeader>;
  if (!h || h.format !== "gymbak2" || h.version !== BACKUP_ENCRYPTED_FORMAT_VERSION) {
    throw errValidation("errors.backupUnsupportedVersion", {
      version: String(h?.version ?? "unknown"),
    });
  }
  if (h.cipher !== "aes-256-gcm") {
    throw errValidation("errors.backupUnsupportedVersion", { version: String(h?.cipher ?? "unknown") });
  }
  if (typeof h.iv !== "string" || typeof h.authTag !== "string" || typeof h.payloadSha256 !== "string") {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "missing cipher fields" });
  }
  if (!h.kdf || (h.kdf.source !== "password" && h.kdf.source !== "key")) {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "missing kdf" });
  }
  if (h.kdf.source === "password" && (!h.kdf.master || h.kdf.master.name !== "scrypt")) {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "missing master kdf" });
  }
  const kdfDerive = h.kdf.derive;
  if (!kdfDerive || kdfDerive.name !== "hkdf-sha256" || !kdfDerive.salt) {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "missing derive kdf" });
  }
  return h as BackupContainerHeader;
}

export function encryptBackupPayload(
  payload: Uint8Array,
  masterKey: Buffer,
  meta: CryptMeta,
): Buffer {
  const salt = crypto.randomBytes(KEY_SALT_BYTES);
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const dataKey = deriveDataKey(masterKey, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(payload)), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header: BackupContainerHeader = {
    magic: "gymbak2",
    format: "gymbak2",
    version: BACKUP_ENCRYPTED_FORMAT_VERSION,
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
    payloadSize: payload.length,
    payloadSha256: sha256Hex(payload),
    createdAt: meta.createdAt,
    kind: meta.kind,
    kdf: {
      source: meta.source,
      ...(meta.master ? { master: meta.master } : {}),
      derive: {
        name: "hkdf-sha256",
        salt: salt.toString("base64"),
        info: HKDF_INFO,
        keyLen: SCRYPT_KEYLEN,
      },
    },
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const sizeBytes = Buffer.alloc(4);
  sizeBytes.writeUInt32LE(headerBytes.length, 0);
  return Buffer.concat([BACKUP_CONTAINER_MAGIC, sizeBytes, headerBytes, ciphertext]);
}

export type DecryptKeySource =
  | { kind: "master"; key: Buffer }
  | { kind: "password"; password: string };

export interface DecryptedContainer {
  payload: Uint8Array;
  header: BackupContainerHeader;
}

/**
 * Decrypt + authenticate a v2 container. A wrong key or any ciphertext
 * modification fails the GCM tag → `errors.backupWrongPassword` (the same
 * error for both, since an attacker cannot be allowed to learn which one);
 * a payload/length/sha mismatch is treated as corruption.
 */
export async function decryptBackupContainer(
  bytes: Uint8Array,
  header: BackupContainerHeader,
  source: DecryptKeySource,
): Promise<DecryptedContainer> {
  let masterKey: Buffer;
  if (source.kind === "password") {
    if (header.kdf.source !== "password" || !header.kdf.master) {
      throw errValidation("errors.backupKeyRequired");
    }
    masterKey = await derivePasswordKey(source.password, header.kdf.master);
  } else {
    masterKey = source.key;
  }

  const derive = header.kdf.derive;
  let salt: Buffer;
  try {
    salt = Buffer.from(derive.salt, "base64");
  } catch {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "bad salt" });
  }
  const dataKey = deriveDataKey(masterKey, salt);
  let iv: Buffer;
  let tag: Buffer;
  try {
    iv = Buffer.from(header.iv, "base64");
    tag = Buffer.from(header.authTag, "base64");
  } catch {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "bad iv/tag" });
  }
  const start = containerPayloadOffset(bytes);
  const cipherLen = bytes.length - start;
  if (cipherLen < 0) throw errValidation("errors.backupArchiveCorrupt", { reason: "payload offset" });

  const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey, iv);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([
      decipher.update(bytes.subarray(start, start + cipherLen)),
      decipher.final(),
    ]);
  } catch {
    throw errValidation("errors.backupWrongPassword");
  }
  if (plain.length !== header.payloadSize) {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "payload size mismatch" });
  }
  if (sha256Hex(plain) !== header.payloadSha256) {
    throw errValidation("errors.backupArchiveCorrupt", { reason: "payload digest mismatch" });
  }
  return { payload: new Uint8Array(plain), header };
}

/* ------------------------------------------------------------------------- */
/* Master-key storage                                                        */
/* ------------------------------------------------------------------------- */

export interface SecretStore {
  readonly engine: "dpapi" | "file";
  protect(bytes: Uint8Array): Buffer;
  unprotect(wrapped: Uint8Array): Buffer;
}

const fileStore: SecretStore = {
  engine: "file",
  protect: (bytes) => Buffer.from(bytes),
  unprotect: (wrapped) => Buffer.from(wrapped),
};

const dpapiStore: SecretStore = {
  engine: "dpapi",
  protect: dpapiProtect,
  unprotect: dpapiUnprotect,
};

/** DI seam used by tests to avoid shelling out to PowerShell. */
let secretStoreOverride: SecretStore | null = null;
let cachedStore: SecretStore | null = null;

export function _setSecretStoreForTest(store: SecretStore | null): void {
  secretStoreOverride = store;
  cachedStore = null;
}

/**
 * Pick the production secret store: DPAPI (Windows) when it demonstrably works,
 * else the restrictive-permission file store. `GYMSYSTEM_SECRET_STORE=file`
 * opts out of DPAPI (used by tests and by non-Windows tooling).
 */
export function getSecretStore(): SecretStore {
  if (cachedStore) return cachedStore;
  if (secretStoreOverride) {
    cachedStore = secretStoreOverride;
    return cachedStore;
  }
  if (process.env.GYMSYSTEM_SECRET_STORE === "file") {
    cachedStore = fileStore;
    return cachedStore;
  }
  try {
    const probe = dpapiStore.protect(crypto.randomBytes(32));
    if (dpapiStore.unprotect(probe).length !== 32) throw new Error("DPAPI probe mismatch");
    cachedStore = dpapiStore;
  } catch {
    cachedStore = fileStore;
  }
  return cachedStore;
}

export interface BackupKeyRef {
  source: "password" | "key";
  masterKey: Buffer;
  kdf: ScryptParams | null;
}

interface StoredBackupKeyFile {
  magic: string;
  source: "password" | "key";
  verifier: string;
  kdf: ScryptParams | null;
  wrapped: { engine: "dpapi" | "file"; bytes: string };
}

export function backupKeyPath(configDir: string): string {
  return path.join(configDir, BACKUP_KEY_FILE);
}

export function storeBackupKey(configDir: string, ref: BackupKeyRef): void {
  const store = getSecretStore();
  const wrapped = store.protect(ref.masterKey);
  const file: StoredBackupKeyFile = {
    magic: "gymsystem-backup-key-v1",
    source: ref.source,
    verifier: sha256Hex(ref.masterKey),
    kdf: ref.kdf,
    wrapped: { engine: store.engine, bytes: wrapped.toString("base64") },
  };
  const target = backupKeyPath(configDir);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(target, JSON.stringify(file, null, 2));
  try {
    chmodSync(target, 0o600);
  } catch {
    /* Windows may not honour POSIX modes; ACLs on LOCALAPPDATA apply. */
  }
}

/** Load + unwrap the stored master key. Returns null when absent/corrupt. */
export function loadBackupKey(configDir: string): BackupKeyRef | null {
  const target = backupKeyPath(configDir);
  if (!existsSync(target)) return null;
  let file: StoredBackupKeyFile;
  try {
    file = JSON.parse(readFileSync(target, "utf8")) as StoredBackupKeyFile;
  } catch {
    return null;
  }
  if (!file || file.magic !== "gymsystem-backup-key-v1") return null;
  if (file.source !== "password" && file.source !== "key") return null;
  try {
    const store = getSecretStore();
    const masterKey = store.unprotect(Buffer.from(file.wrapped.bytes, "base64"));
    if (sha256Hex(masterKey) !== file.verifier) return null;
    return { source: file.source, masterKey, kdf: file.kdf ?? null };
  } catch {
    /* wrapped bytes unusable (e.g. different Windows user) */
    return null;
  }
}

export function backupKeyExists(configDir: string): boolean {
  return existsSync(backupKeyPath(configDir));
}

export function deleteBackupKey(configDir: string): boolean {
  const target = backupKeyPath(configDir);
  if (!existsSync(target)) return false;
  rmSync(target, { force: true });
  return true;
}

/**
 * Verify a password against the stored master key WITHOUT decrypting any
 * backup: derive from the stored scrypt params and compare the verifier.
 */
export async function verifyStoredPassword(configDir: string, password: string): Promise<boolean> {
  const target = backupKeyPath(configDir);
  if (!existsSync(target)) return false;
  let file: StoredBackupKeyFile;
  try {
    file = JSON.parse(readFileSync(target, "utf8")) as StoredBackupKeyFile;
  } catch {
    return false;
  }
  if (!file || file.magic !== "gymsystem-backup-key-v1" || file.source !== "password" || !file.kdf) {
    return false;
  }
  const candidate = await derivePasswordKey(password, file.kdf);
  return sha256Hex(candidate) === file.verifier;
}