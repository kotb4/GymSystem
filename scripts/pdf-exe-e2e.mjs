// Verifies the PACKAGED executable (GymSystem.exe) boots and can produce a PDF
// receipt with the fonts resolved from dist-exe/assets/fonts (not the repo).
// Temporary, dev-only script.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8897;
const BASE = `http://127.0.0.1:${PORT}`;
// Deliberately NOT the repo root, so cwd-based font resolution cannot succeed —
// the exe must find assets/fonts via GYMSYSTEM_EXE_DIR.
const dataDir = mkdtempSync(join(tmpdir(), "gym-pdf-exe-"));

if (!existsSync(join(root, "dist-exe", "assets", "fonts", "Cairo-Regular.ttf"))) {
  console.log("FAIL: dist-exe/assets/fonts/Cairo-Regular.ttf missing");
  process.exit(1);
}

const app = spawn(join(root, "dist-exe", "GymSystem.exe"), [], {
  env: {
    ...process.env,
    GYMSYSTEM_DATA_DIR: dataDir,
    GYMSYSTEM_PORT: String(PORT),
    GYMSYSTEM_NO_OPEN: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let out = "";
app.stdout?.on("data", (d) => (out += d));
app.stderr?.on("data", (d) => (out += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = "";

async function rpc(service, fn, args) {
  const res = await fetch(`${BASE}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-session-token": token },
    body: JSON.stringify({ service, fn, args }),
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(`${service}.${fn}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.result;
}

const fail = (m) => {
  console.log("FAIL:", m);
  try { app.kill(); } catch { /* ignore */ }
  process.exit(1);
};

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      up = r.ok;
    } catch {
      await sleep(500);
    }
  }
  if (!up) fail(`exe never became ready:\n${out}`);
  console.log("packaged exe ready");

  const setup = await (
    await fetch(`${BASE}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { gymName: "Gym", ownerFullName: "Owner", username: "owner", password: "Owner@2026" },
      }),
    })
  ).json();
  token = setup.result.token;

  const plan = await rpc("plans", "createPlan", [{ name: "Gold", durationDays: 30, price: 1500 }]);
  const member = await rpc("members", "createMember", [{ fullName: "Ahmed", phone: "01000000000" }]);
  const sub = await rpc("subscriptions", "createSubscription", [{ memberId: member.id, planId: plan.id }]);
  const payment = await rpc("payments", "recordPayment", [
    { memberId: member.id, subscriptionId: sub.id, baseAmountMinor: 150000, paidAmountMinor: 150000, methodCode: "cash" },
  ]);
  console.log("fixtures created via packaged exe");

  const pdf = await rpc("pdf", "generatePaymentReceipt", [payment.id]);
  const bytes = Buffer.from(pdf.base64, "base64");
  writeFileSync("exe-receipt.pdf", bytes);
  if (bytes.subarray(0, 5).toString() !== "%PDF-") fail("not a PDF");
  if (bytes.length < 2000) fail("PDF too small");
  console.log(`PACKAGED PDF OK: ${pdf.fileName} ${bytes.length} bytes`);
  console.log("\nEXE E2E PASS");
  try { app.kill(); } catch { /* ignore */ }
} catch (err) {
  fail(err.message);
}
