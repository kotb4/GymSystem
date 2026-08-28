// Consistency check: every rpc("service","fn") in src/api must exist in the
// server/rpc/<domain>.rpc.ts registry modules.
const fs = require("fs");
const path = require("path");

const rpcDir = path.join("server", "rpc");
const apiSrc = fs.readFileSync("src/api/index.ts", "utf8");

const reg = new Set();
const files = fs
  .readdirSync(rpcDir)
  .filter((f) => f.endsWith(".rpc.ts"))
  .sort();

for (const file of files) {
  const src = fs.readFileSync(path.join(rpcDir, file), "utf8");
  // service name from: export const <service> = defineService({ ... })
  const serviceMatch = src.match(/export\s+const\s+(\w+)\s*=\s*defineService\s*\(\s*\{/);
  if (!serviceMatch) continue;
  const service = serviceMatch[1];
  const body = src.slice(serviceMatch.index + serviceMatch[0].length);
  // balanced-brace scan; the defineService object closes with `});` (inner
  // entry objects end with `},` and must not be mistaken for the close).
  let depth = 0;
  let i = 0;
  let end = body.length;
  for (; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) {
        const rest = body.slice(i + 1, i + 4).replace(/\s/g, "");
        if (rest.startsWith(");")) {
          end = i;
          break;
        }
      }
    }
  }
  const block = body.slice(0, end);
  // standard a()/p() entries
  const entryRe = /(\w+):\s*[ap]\(/g;
  let e;
  while ((e = entryRe.exec(block))) reg.add(service + "." + e[1]);
  // inline object entries: name: { fn: (...), actor: true }
  const inlineRe = /(\w+):\s*\{\s*fn:\s*\(/g;
  while ((e = inlineRe.exec(block))) reg.add(service + "." + e[1]);
}
reg.add("auth.changeOwnPassword");

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
