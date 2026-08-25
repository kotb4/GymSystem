// Consistency check: every rpc("service","fn") in src/api must exist in server/rpc.ts REGISTRY.
const fs = require("fs");
const rpcSrc = fs.readFileSync("server/rpc.ts", "utf8");
const apiSrc = fs.readFileSync("src/api/index.ts", "utf8");

const reg = new Set();
const blockRe = /(\w+):\s*\{([\s\S]*?)\n  \},/g;
let m;
while ((m = blockRe.exec(rpcSrc))) {
  const service = m[1];
  // standard a()/p() entries
  const entryRe = /(\w+):\s*[ap]\(/g;
  let e;
  while ((e = entryRe.exec(m[2]))) reg.add(service + "." + e[1]);
  // inline object entries: name: { fn: (...), actor: true }
  const inlineRe = /(\w+):\s*\{\s*fn:\s*\(/g;
  while ((e = inlineRe.exec(m[2]))) reg.add(service + "." + e[1]);
}
if (rpcSrc.includes("changeOwnPassword")) reg.add("auth.changeOwnPassword");

const missing = [];
for (const mm of apiSrc.matchAll(/rpc[^\n]*?\("(\w+)",\s*"(\w+)"/g)) {
  const key = mm[1] + "." + mm[2];
  if (!reg.has(key)) missing.push(key);
}
console.log("registry entries:", reg.size);
console.log("client calls missing from registry:");
if (missing.length === 0) console.log("  (none)");
missing.forEach((k) => console.log("  -", k));

// reverse check: registry entries never used by the client (informational)
const used = new Set();
for (const mm of apiSrc.matchAll(/rpc[^\n]*?\("(\w+)",\s*"(\w+)"/g)) used.add(mm[1] + "." + mm[2]);
const unused = [...reg].filter((k) => !used.has(k) && k !== "auth.changeOwnPassword");
console.log("\nregistry entries with no frontend caller (informational):");
unused.forEach((k) => console.log("  -", k));
