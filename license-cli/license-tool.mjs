#!/usr/bin/env node
/**
 * Standalone offline-license tool for GymSystem (v9 Pro).
 * Uses node:crypto Ed25519 — zero external dependencies.
 * Automatically provisions config/id_ed25519_*.pem if missing and keeps
 * server/license/crypto.ts in sync when keygen is executed.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const EMBEDDED_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIAoqxdg3uBD8gB/bBPscoROXkyk64qICm1J26IRsJV9A
-----END PRIVATE KEY-----`;

const EMBEDDED_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAM6RoZAxMXLWHjOBjXGsT7ipmp6bzq9W8x2qCYpK/Ro4=
-----END PUBLIC KEY-----`;

function printHelp() {
  console.log(`Usage:
  node license-tool.mjs keygen [dir]
  node license-tool.mjs issue <hwid> [--gym NAME] [--days N] [--until YYYY-MM-DD] [--tier full] [--key path] [--out path]
  node license-tool.mjs hwid [--json]
  node license-tool.mjs issue-here [--gym NAME] [--days N] [--until YYYY-MM-DD] [--tier full] [--key path] [--out path]
  node license-tool.mjs inspect <file.lic> [--key public.pem]
  node license-tool.mjs action <hwid> <reset_clock|reset_owner|emergency_grace|force_deactivate> [--days N] [--new-pass PWD] [--key path]

Commands:
  keygen       generate a fresh Ed25519 keypair (writes config/id_ed25519_*.pem & syncs server/license/crypto.ts)
  hwid         print THIS machine's HWID (exact algorithm matching server/license/hwid.ts)
  issue        sign a license for an explicit HWID
  issue-here   read this machine's HWID automatically, sign a license for it
  inspect      read and verify an issued .lic file (checks signature and displays payload)
  action       generate a cryptographically signed Developer Emergency Action token
`);
}

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

function ensureDefaultKeyFiles() {
  const cfgDir = path.join(ROOT, "config");
  const privFile = path.join(cfgDir, "id_ed25519_private.pem");
  const pubFile = path.join(cfgDir, "id_ed25519_public.pem");
  try {
    if (!fs.existsSync(privFile) || !fs.existsSync(pubFile)) {
      fs.mkdirSync(cfgDir, { recursive: true });
      if (!fs.existsSync(privFile)) fs.writeFileSync(privFile, EMBEDDED_PRIVATE_PEM + "\n", "utf8");
      if (!fs.existsSync(pubFile)) fs.writeFileSync(pubFile, EMBEDDED_PUBLIC_PEM + "\n", "utf8");
    }
  } catch {
    /* ignore write errors on read-only media; in-memory fallback is used */
  }
}

function keygen(dir = "config") {
  const out = path.isAbsolute(dir) ? dir : path.resolve(path.join(ROOT, dir));
  fs.mkdirSync(out, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  fs.writeFileSync(path.join(out, "id_ed25519_private.pem"), privPem, "utf8");
  fs.writeFileSync(path.join(out, "id_ed25519_public.pem"), pubPem, "utf8");
  console.log(`Private key  -> ${path.join(out, "id_ed25519_private.pem")}`);
  console.log(`Public key   -> ${path.join(out, "id_ed25519_public.pem")}`);

  // Automatically sync server/license/crypto.ts if present
  const serverCryptoPath = path.resolve(ROOT, "..", "server", "license", "crypto.ts");
  if (fs.existsSync(serverCryptoPath)) {
    try {
      let src = fs.readFileSync(serverCryptoPath, "utf8");
      const re = /const EMBEDDED_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----\r?\n`;/;
      if (re.test(src)) {
        src = src.replace(re, `const EMBEDDED_PUBLIC_PEM = \`${pubPem.trim()}\n\`;`);
        fs.writeFileSync(serverCryptoPath, src, "utf8");
        console.log(`Synced EMBEDDED_PUBLIC_PEM -> ${serverCryptoPath}`);
      }
    } catch {
      /* ignore */
    }
  }
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else {
        flags[a.slice(2)] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function resolvePrivateKey(customPath) {
  if (customPath) {
    const p = path.resolve(customPath);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  ensureDefaultKeyFiles();
  const defaultPriv = path.join(ROOT, "config", "id_ed25519_private.pem");
  if (fs.existsSync(defaultPriv)) {
    return fs.readFileSync(defaultPriv, "utf8");
  }
  return EMBEDDED_PRIVATE_PEM;
}

function resolvePublicKey(customPath) {
  if (customPath) {
    const keyPath = path.resolve(customPath);
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, "utf8");
  }
  ensureDefaultKeyFiles();
  const defaultPub = path.join(ROOT, "config", "id_ed25519_public.pem");
  if (fs.existsSync(defaultPub)) return fs.readFileSync(defaultPub, "utf8");
  return EMBEDDED_PUBLIC_PEM;
}

function issue(argv) {
  const { flags, positional } = parseArgs(argv);
  const hwid = (positional[0] || "").trim().toUpperCase();
  if (!hwid) {
    printHelp();
    process.exit(1);
  }
  const privPem = resolvePrivateKey(flags.key);
  const gym = (flags.gym ?? "GymSystem").trim() || "GymSystem";
  const tier = (flags.tier ?? "full").trim() || "full";
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
    tier,
  });
  const key = crypto.createPrivateKey(privPem);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), key).toString("hex");
  const licJson = JSON.stringify({ payload, signature });

  const outPath = flags.out ? path.resolve(flags.out) : path.join(ROOT, "license.lic");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, licJson, "utf8");
  console.log(`Issued license for HWID ${hwid} (${gym}, tier=${tier}, expires ${new Date(expiresAt).toISOString()})`);
  console.log(`Wrote ${outPath}. Hand this file to the client to activate via the app.`);
  if (flags.stdout || flags.print) {
    console.log(licJson);
  }
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
  const privPem = resolvePrivateKey(flags.key);
  const gym = (flags.gym ?? "GymSystem").trim() || "GymSystem";
  const tier = (flags.tier ?? "full").trim() || "full";
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
  const payload = JSON.stringify({ hwid, gym, issuedAt: Date.now(), expiresAt, tier });
  const key = crypto.createPrivateKey(privPem);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), key).toString("hex");
  const licJson = JSON.stringify({ payload, signature });

  const outPath = flags.out ? path.resolve(flags.out) : path.join(ROOT, "license.lic");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, licJson, "utf8");
  console.log(`This machine's HWID  : ${hwid}`);
  console.log(`Issued license        : ${gym}, tier=${tier}, expires ${new Date(expiresAt).toISOString()}`);
  console.log(`Wrote                : ${outPath}`);
  console.log(`Paste this file's content (or drop the file) into the app's activation screen.`);
}

function inspectCmd(argv) {
  const { flags, positional } = parseArgs(argv);
  const filePath = positional[0];
  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`License file not found: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let file;
  try {
    file = JSON.parse(raw);
  } catch {
    console.error("File is not valid JSON.");
    process.exit(1);
  }
  const pubPem = resolvePublicKey(flags.key);
  let verified = false;
  try {
    const pubKey = crypto.createPublicKey(pubPem);
    const sig = Buffer.from(file.signature, "hex");
    verified = crypto.verify(null, Buffer.from(file.payload, "utf8"), pubKey, sig);
  } catch {
    verified = false;
  }
  console.log(`=== تفاصيل ملف الترخيص: ${path.basename(filePath)} ===`);
  console.log(`حالة التوقيع الرقمي : ${verified ? "سليم وصالح ✓" : "غير صالح أو تالف ✗"}`);
  try {
    const payload = JSON.parse(file.payload);
    if (payload.type === "developer_action") {
      console.log(`نوع الملف           : كود طوارئ ودعم فني (${payload.action})`);
      console.log(`كود الجهاز (HWID)   : ${payload.hwid}`);
      console.log(`تاريخ الإصدار       : ${new Date(payload.issuedAt).toLocaleString("ar-EG")}`);
      console.log(`تاريخ الانتهاء      : ${new Date(payload.expiresAt).toLocaleString("ar-EG")}`);
      if (payload.params && Object.keys(payload.params).length > 0) {
        console.log(`المعاملات           : ${JSON.stringify(payload.params)}`);
      }
      return;
    }
    const expDate = new Date(payload.expiresAt);
    const daysLeft = Math.ceil((payload.expiresAt - Date.now()) / (24 * 3600 * 1000));
    console.log(`كود الجهاز (HWID)   : ${payload.hwid}`);
    console.log(`اسم النادي / الجيم   : ${payload.gym}`);
    console.log(`تاريخ الإصدار       : ${new Date(payload.issuedAt).toLocaleString("ar-EG")}`);
    console.log(`تاريخ الانتهاء      : ${expDate.toLocaleString("ar-EG")}`);
    console.log(`الأيام المتبقية     : ${daysLeft > 0 ? `${daysLeft} يوم` : "منتهي الصلاحية"}`);
    console.log(`الباقة / الفئة      : ${payload.tier || "full"}`);
  } catch {
    console.log("تعذر فك محتوى الـ payload.");
  }
}

function issueAction(argv) {
  const { flags, positional } = parseArgs(argv);
  const hwid = (positional[0] || "").trim().toUpperCase();
  const action = positional[1];
  const validActions = ["reset_clock", "reset_owner", "emergency_grace", "force_deactivate"];
  if (!hwid || !action || !validActions.includes(action)) {
    console.error(`Usage: node license-tool.mjs action <hwid> <${validActions.join("|")}> [--days N] [--new-pass PWD]`);
    process.exit(1);
  }
  const privPem = resolvePrivateKey(flags.key);
  const params = {};
  if (action === "emergency_grace") {
    params.graceDays = Math.max(1, Number(flags.days ?? 7) || 7);
  }
  if (action === "reset_owner") {
    params.newPassword = (flags["new-pass"] ?? "Owner@123456").trim() || "Owner@123456";
  }

  const payloadObj = {
    type: "developer_action",
    hwid,
    action,
    params,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 48 * 60 * 60 * 1000, // token valid for 48 hours
    nonce: crypto.randomUUID(),
  };

  const payloadStr = JSON.stringify(payloadObj);
  const key = crypto.createPrivateKey(privPem);
  const signature = crypto.sign(null, Buffer.from(payloadStr, "utf8"), key).toString("hex");
  const tokenJson = JSON.stringify({ payload: payloadStr, signature });

  console.log(`=== كود الدعم الفني الموقّع (${action}) ===`);
  console.log(`الجهاز المستهدف: ${hwid}`);
  if (action === "reset_owner") {
    console.log(`كلمة المرور الجديدة للمالك: ${params.newPassword}`);
  } else if (action === "emergency_grace") {
    console.log(`عدد أيام التمديد الطارئ: ${params.graceDays} يوم`);
  }
  console.log(`الصلاحية: 48 ساعة حتى ${new Date(payloadObj.expiresAt).toLocaleString("ar-EG")}`);
  console.log(`\nالكود الموقّع:\n`);
  console.log(tokenJson);
  console.log(`\nانسخ هذا الكود بالكامل وأرسله للعميل ليدخله في شاشة الدعم الفني للتطبيق.`);
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
  case "inspect":
    inspectCmd(rest);
    break;
  case "action":
    issueAction(rest);
    break;
  default:
    printHelp();
    process.exit(cmd ? 1 : 0);
}
