import crypto, { createPublicKey } from "node:crypto";
import type { SignedPayload } from "./policy";

/**
 * Ed25519 helpers for the offline license.
 *
 * - Development/signing machine holds the private key (never ships).
 * - The app embeds the PUBLIC key (below) to `verifyLicense`.
 *
 * All formats are PEM; signatures are base64 (URL-safe) hex-JSON of the payload
 * bytes. `node:crypto` is the only primitive — no external deps.
 */

export interface SignedLicenseFile {
  /** Raw JSON payload string (validated/parsed by caller). */
  payload: string;
  /** hex of the Ed25519 signature over the payload bytes. */
  signature: string;
}

/** Deterministic payload bytes we sign/verify. */
export function payloadBytes(payload: string): Buffer {
  return Buffer.from(payload, "utf8");
}

/**
 * Ship-time public key. Replace with the real developer key via
 * `npm run license:keygen` and copying the public PEM here (or into an env /
 * a checked resource). This dev keypair is only for offline testing.
 */
const EMBEDDED_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYclQ5OZ7JEsutSRpRNKJdF/nYdtNbl+5juTMjqqJrVw=
-----END PUBLIC KEY-----
`;

/** Home for private-key generation/export — server-side only, dev tooling. */
export function generateKeyPair(): crypto.KeyPairKeyObjectResult {
  return crypto.generateKeyPairSync("ed25519");
}

export function exportPrivateKeyPem(
  keyPair: crypto.KeyPairKeyObjectResult,
): string {
  return keyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
}

export function exportPublicKeyPem(
  keyPair: crypto.KeyPairKeyObjectResult,
): string {
  return keyPair.publicKey.export({ type: "spki", format: "pem" }) as string;
}

/** Create a .lic from a private key (developer machine only). */
export function signLicense(
  privateKeyPem: string,
  payload: string,
): SignedLicenseFile {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, payloadBytes(payload), key);
  return { payload, signature: sig.toString("hex") };
}

/** Verify a .lic against the embedded public key. */
export function verifyLicense(
  license: SignedLicenseFile,
  publicKeyPem: string = EMBEDDED_PUBLIC_PEM,
): boolean {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    const sig = Buffer.from(license.signature, "hex");
    return crypto.verify(null, payloadBytes(license.payload), publicKey, sig);
  } catch {
    return false;
  }
}

/**
 * Issue a license file content (JSON string). The public key used here matters
 * only for the offline test keypair; the shipped app uses EMBEDDED_PUBLIC_PEM.
 */
export function issueLicense(
  privateKeyPem: string,
  hwid: string,
  gym: string,
  issuedAt: number,
  expiresAt: number,
  tier = "full",
): string {
  const payload = JSON.stringify({ hwid, gym, issuedAt, expiresAt, tier });
  const signed = signLicense(privateKeyPem, payload);
  return JSON.stringify(signed);
}

/** Parse + verify+decode a .lic JSON string; returns the payload or null. */
export function parseAndVerifyLicense(
  licenseJson: string,
  publicKeyPem?: string,
): SignedPayload | null {
  try {
    const file: SignedLicenseFile = JSON.parse(licenseJson);
    if (typeof file.payload !== "string" || typeof file.signature !== "string") return null;
    const ok = verifyLicense(file, publicKeyPem);
    if (!ok) return null;
    const parsed = JSON.parse(file.payload) as SignedPayload;
    if (
      typeof parsed.hwid !== "string" ||
      typeof parsed.gym !== "string" ||
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.tier !== "string"
    ) {
      return null;
    }
    return {
      hwid: parsed.hwid,
      gym: parsed.gym,
      issuedAt: Number(parsed.issuedAt),
      expiresAt: Number(parsed.expiresAt),
      tier: parsed.tier,
    };
  } catch {
    return null;
  }
}

export interface DeveloperActionPayload {
  type: "developer_action";
  hwid: string;
  action: "reset_clock" | "reset_owner" | "emergency_grace" | "force_deactivate";
  params?: {
    newPassword?: string;
    graceDays?: number;
  };
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export function signDeveloperAction(
  privateKeyPem: string,
  payload: DeveloperActionPayload,
): string {
  const payloadStr = JSON.stringify(payload);
  const signed = signLicense(privateKeyPem, payloadStr);
  return JSON.stringify(signed);
}

export function parseAndVerifyDeveloperAction(
  actionJson: string,
  publicKeyPem?: string,
): DeveloperActionPayload | null {
  try {
    const file: SignedLicenseFile = JSON.parse(actionJson);
    if (typeof file.payload !== "string" || typeof file.signature !== "string") return null;
    const ok = verifyLicense(file, publicKeyPem);
    if (!ok) return null;
    const parsed = JSON.parse(file.payload) as DeveloperActionPayload;
    if (
      parsed.type !== "developer_action" ||
      typeof parsed.hwid !== "string" ||
      typeof parsed.action !== "string" ||
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}