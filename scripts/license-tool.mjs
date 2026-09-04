#!/usr/bin/env node
/**
 * Developer-only offline-license tool (the client never has this).
 * Uses node:crypto Ed25519 — no dependencies.
 *
 * Usage:
 *   node scripts/license-tool.mjs keygen [outDir]        # generate keypair PEMs
 *   node scripts/license-tool.mjs issue <hwid> [--gym NAME] [--days N] [--until YYYY-MM-DD] [--key private.pem]
 *
 * `keygen` prints/saves:
 *   - id_ed25519_private.pem  (keep on THIS machine; never ship)
 *   - id_ed25519_public.pem   (PEM to embed as EMBEDDED_PUBLIC_PEM in server/license/crypto.ts)
 *
 * `issue` reads the private key, embeds hwid + gym + expiry into a signed
 * JSON payload and writes `<out>/.lic` (or prints it). Client pastes/uploads
 * this as the activation file.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function printHelp() {
  console.log(`Usage:
  node scripts/license-tool.mjs keygen [dir]
  node scripts/license-tool.mjs issue <hwid> [--gym NAME] [--days N] [--until YYYY-MM-DD] [--key path] [--out path]
`);
}

function keygen(dir = "config") {
  const out = path.isAbsolute(dir) ? dir : path.resolve(path.join(ROOT, dir));
  fs.mkdirSync(out, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  fs.writeFileSync(path.join(out, "id_ed25519_private.pem"), privPem);
  fs.writeFileSync(path.join(out, "id_ed25519_public.pem"), pubPem);
  console.log(`Private key  -> ${path.join(out, "id_ed25519_private.pem")}  (KEEP SECURE, never ship)`);
  console.log(`Public key   -> ${path.join(out, "id_ed25519_public.pem")}`);
  console.log(`\nEmbed this PEM as EMBEDDED_PUBLIC_PEM in server/license/crypto.ts:\n`);
  console.log(pubPem);
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      flags[a.slice(2)] = args[i + 1];
      i++;
    } else positional.push(a);
  }
  return { flags, positional };
}

function issue(argv) {
  const { flags, positional } = parseArgs(argv);
  const hwid = positional[0];
  if (!hwid) {
    printHelp();
    process.exit(1);
  }
  const keyPath = flags.key ? path.resolve(flags.key) : path.join(ROOT, "config", "id_ed25519_private.pem");
  if (!fs.existsSync(keyPath)) {
    console.error(`Private key not found at ${keyPath}. Run keygen first or pass --key.`);
    process.exit(1);
  }
  const privPem = fs.readFileSync(keyPath, "utf8");
  const gym = flags.gym ?? "GymSystem";
  let expiresAt;
  if (flags.until) {
    const d = Date.parse(flags.until + "T23:59:59");
    if (Number.isNaN(d)) {
      console.error("Bad --until; expected YYYY-MM-DD");
      process.exit(1);
    }
    expiresAt = d;
  } else {
    const days = Number(flags.days ?? 365);
    expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  }
  const payload = JSON.stringify({
    hwid,
    gym,
    issuedAt: Date.now(),
    expiresAt,
    tier: "full",
  });
  const key = crypto.createPrivateKey(privPem);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), key).toString("hex");
  const licJson = JSON.stringify({ payload, signature });

  const outPath = flags.out ? path.resolve(flags.out) : path.join(ROOT, "license.lic");
  fs.writeFileSync(outPath, licJson, "utf8");
  console.log(`Issued license for HWID ${hwid} (${gym}, expires ${new Date(expiresAt).toISOString()})`);
  console.log(`Wrote ${outPath}. Hand this file to the client to activate via the app.`);
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "keygen":
    keygen(rest[0]);
    break;
  case "issue":
    issue(rest);
    break;
  default:
    printHelp();
    process.exit(cmd ? 1 : 0);
}