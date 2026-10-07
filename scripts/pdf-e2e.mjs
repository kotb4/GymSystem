// End-to-end check of the PDF receipt flow against the REAL built server
// bundle (dist-server/index.cjs) over HTTP. Temporary, dev-only script.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "gym-pdf-e2e-"));

const server = spawn(process.execPath, ["dist-server/index.cjs"], {
  env: {
    ...process.env,
    GYMSYSTEM_DATA_DIR: dataDir,
    GYMSYSTEM_PORT: String(PORT),
    GYMSYSTEM_NO_OPEN: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`server never became ready:\n${serverOut}`);
}

let token = "";
async function rpc(service, fn, args) {
  const res = await fetch(`${BASE}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-session-token": token },
    body: JSON.stringify({ service, fn, args }),
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(`${service}.${fn} failed: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body.result;
}

const fail = (msg) => {
  console.log("FAIL:", msg);
  server.kill();
  process.exit(1);
};

try {
  await waitReady();
  console.log("server ready");

  const setup = await (
    await fetch(`${BASE}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { gymName: "جيم النوردة", ownerFullName: "Owner", username: "owner", password: "Owner@2026" },
      }),
    })
  ).json();
  token = setup.result.token;
  console.log("auth ok");

  const plan = await rpc("plans", "createPlan", [{ name: "Gold", durationDays: 30, price: 1500 }]);
  const member = await rpc("members", "createMember", [{ fullName: "أحمد محمد", phone: "01000000000" }]);
  const sub = await rpc("subscriptions", "createSubscription", [{ memberId: member.id, planId: plan.id }]);
  const payment = await rpc("payments", "recordPayment", [
    { memberId: member.id, subscriptionId: sub.id, baseAmountMinor: 150000, paidAmountMinor: 150000, methodCode: "cash" },
  ]);
  console.log("fixtures created");

  const pdf = await rpc("pdf", "generatePaymentReceipt", [payment.id]);
  const bytes = Buffer.from(pdf.base64, "base64");
  writeFileSync("e2e-receipt.pdf", bytes);
  if (bytes.subarray(0, 5).toString() !== "%PDF-") fail("not a PDF");
  if (bytes.length < 2000) fail("PDF too small");
  if (!pdf.fileName.endsWith(".pdf")) fail("bad file name");
  console.log(`PDF ok: ${pdf.fileName} ${bytes.length} bytes hash=${pdf.hash.slice(0, 12)}`);

  const deliveriesBefore = await rpc("pdf", "listPdfDeliveries", [{}]);
  if (deliveriesBefore.length !== 0) fail("generation must not create a delivery row");

  const sent = await rpc("pdf", "sendPaymentReceipt", [payment.id]);
  if (sent.delivery.status !== "not_configured") fail(`expected not_configured, got ${sent.delivery.status}`);
  const deliveriesAfter = await rpc("pdf", "listPdfDeliveries", [{}]);
  if (deliveriesAfter.length !== 1) fail("delivery row not archived");
  console.log(`send ok: status=${sent.delivery.status} archived=${deliveriesAfter.length}`);

  console.log("\nE2E PASS");
} catch (err) {
  fail(err.message);
} finally {
  server.kill();
}
