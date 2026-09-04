#!/usr/bin/env node
/**
 * Standalone offline-license tool for GymSystem.
 * Lives in license-cli/ alongside its own package.json. Uses node:crypto
 * Ed25519 — no dependencies. Reads the HWID using the same algorithm the
 * app uses (reg query + os.networkInterfaces) so an issued license binds
 * to the right machine.
 *
 * Usage:
 *   node license-tool.mjs keygen [outDir]        # generate keypair PEMs
 *   node license-tool.mjs issue <hwid> [--gym NAME] [--days N] [--until YYYY-MM-DD] [--key private.pem] [--out path]
 *   node license-tool.mjs hwid [--json]
 *   node license-tool.mjs issue-here [--gym NAME] [--days N] [--until YYYY-MM-DD] [--key path] [--out path]
 *
 * `keygen` prints/saves (default: <this-dir>/config/):
 *   - id_ed25519_private.pem  (keep on THIS machine; never ship)
 *   - id_ed25519_public.pem   (PEM to embed as EMBEDDED_PUBLIC_PEM in server/license/crypto.ts)
 *
 * `issue` reads the private key, embeds hwid + gym + expiry into a signed
 * JSON payload and writes a .lic file (default: <this-dir>/license.lic).
 * The client pastes/uploads this in the app's activation screen.
 *
 * SECURITY: Never commit config/id_ed25519_private.pem or any *.lic file.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`Usage:
  node license-tool.mjs keygen [dir]
  node license-tool.mjs issue <hwid> [--gym NAME] [--days N] [--until YYYY-MM-DD] [--key path] [--out path]
  node license-tool.mjs hwid [--json]
  node license-tool.mjs issue-here [--gym NAME] [--days N] [--until YYYY-MM-DD] [--key path] [--out path]

Commands
  keygen       generate a fresh Ed25519 keypair (writes config/id_ed25519_*.pem)
  hwid         print THIS machine's HWID (same algorithm the app uses; no need to type it)
  issue        sign a license for an explicit HWID (needs a matching private key)
  issue-here   read this machine's HWID automatically, sign a license for it (one-liner)

The private key must MATCH the public key embedded in server/license/crypto.ts.
"npm run license:keygen" routes here and, when finished, tells you to embed the public PEM.
`);
}

/**
 * Replicates server/license/hwid.ts::computeHwId EXACTLY so a license issued
 * by this CLI carries the same HWID the app computes at runtime on this machine.
 */
function machineGuidHere(platform) {
  if (platform !== "win32") return null;
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", windowsHide: true, timeout: 4000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function computeHwIdHere() {
  const platform = os.platform();
  const identifiers = [];
  identifiers.push(machineGuidHere(platform));
  identifiers.push(os.hostname());
  identifiers.push(platform);
  identifiers.push(os.arch());
  const macs = [];
  const nets = os.networkInterfaces();
  for (const key of Object.keys(nets)) {
    for (const n of nets[key] ?? []) {
      if (!n.internal && n.mac && n.mac !== "00:00:00:00:00:00") macs.push(n.mac);
    }
  }
  identifiers.push(...macs.sort());
  const canonical = JSON.stringify(identifiers.filter(Boolean));
  const digest = crypto.createHash("sha256").update(canonical).digest("hex").toUpperCase();
  const hex = digest.padEnd(16, "0").slice(0, 16);
  const parts = [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)];
  return `GYM-${parts.join("-")}`;
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
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, licJson, "utf8");
  console.log(`Issued license for HWID ${hwid} (${gym}, expires ${new Date(expiresAt).toISOString()})`);
  console.log(`Wrote ${outPath}. Hand this file to the client to activate via the app.`);
}

function hwidCmd(argv) {
  const { flags } = parseArgs(argv);
  const id = computeHwIdHere();
  if (flags.json) {
    console.log(JSON.stringify({ hwid: id, platform: os.platform(), arch: os.arch() }));
  } else {
    console.log(id);
  }
}

function issueHere(argv) {
  const { flags } = parseArgs(argv);
  const hwid = computeHwIdHere();
  const keyPath = flags.key ? path.resolve(flags.key) : path.join(ROOT, "config", "id_ed25519_private.pem");
  if (!fs.existsSync(keyPath)) {
    console.error(`Private key not found at ${keyPath}. Run "node license-tool.mjs keygen" first (its public key must be embedded in the app).`);
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
  const payload = JSON.stringify({ hwid, gym, issuedAt: Date.now(), expiresAt, tier: "full" });
  const key = crypto.createPrivateKey(privPem);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), key).toString("hex");
  const licJson = JSON.stringify({ payload, signature });

  const outPath = flags.out ? path.resolve(flags.out) : path.join(ROOT, "license.lic");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, licJson, "utf8");
  console.log(`This machine's HWID  : ${hwid}`);
  console.log(`Issued license        : ${gym}, expires ${new Date(expiresAt).toISOString()}`);
  console.log(`Wrote                : ${outPath}`);
  console.log(`Paste this file's content (or drop the file) into the app's activation screen.`);
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "keygen":
    keygen(rest[0]);
    break;
  case "issue":
    issue(rest);
    break;
  case "hwid":
  case "hwid-here":
    hwidCmd(rest);
    break;
  case "issue-here":
    issueHere(rest);
    break;
  default:
    printHelp();
    process.exit(cmd ? 1 : 0);
}