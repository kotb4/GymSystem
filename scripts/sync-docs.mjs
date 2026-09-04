#!/usr/bin/env node
/**
 * sync-docs.mjs
 *
 * Recalculate authoritative, machine-checkable facts from the actual source and
 * refresh them inside the AI documentation files so the docs never drift from
 * the code. This is a NUMBER/VALUE sync only — it never rewrites narrative,
 * business rules, or prose. Those are handled by the `/docs` agent or a human.
 *
 * Sources of truth (all read live from the repo):
 *   - src/core/permissions.ts           → PERMS array length
 *   - src/core/audit-actions.ts         → AUDIT_ACTIONS array length
 *   - src/db/migrations.ts              → highest migration `version`
 *   - server/index.ts                   → default HTTP HOST bind
 *   - src/core/services/*.service.ts    → service file count
 *   - src/pages/*.tsx                   → page file count
 *   - tests/*.test.ts                   → test suite file count
 *
 * Targets it updates (value-only, safe regexes):
 *   - AGENTS.md
 *   - .ai/project.md
 *   - docs/ai/architecture.md
 *   - docs/ai/database.md
 *
 * Run:  node scripts/sync-docs.mjs
 * npm:  npm run sync:docs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const write = (p, s) => writeFileSync(resolve(root, p), s, "utf8");
const fileCount = (dir, pattern) =>
  existsSync(resolve(root, dir)) ? readdirSync(resolve(root, dir)).filter((f) => pattern.test(f)).length : 0;

const log = [];
const changed = [];

/* ------------------------------------------------------------------ *
 * 1. Gather authoritative facts from the source.
 * ------------------------------------------------------------------ */
function permissionCount() {
  const src = read("src/core/permissions.ts");
  const m = src.match(/export const PERMS = \[([\s\S]*?)\] as const;/);
  if (!m) throw new Error("PERMS array not found in permissions.ts");
  return m[1].split("\n").filter((l) => /^\s*"[a-z]+\.[a-z_]+"\s*,\s*$/.test(l)).length;
}

function auditActionCount() {
  const src = read("src/core/audit-actions.ts");
  const m = src.match(/export const AUDIT_ACTIONS = \[([\s\S]*?)\] as const;/);
  if (!m) throw new Error("AUDIT_ACTIONS array not found in audit-actions.ts");
  return m[1].split("\n").filter((l) => /^\s*"[A-Z][A-Z0-9_]*"\s*,\s*$/.test(l)).length;
}

function migrationMax() {
  const src = read("src/db/migrations.ts");
  const versions = [...src.matchAll(/version:\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
  if (versions.length === 0) return 0;
  return Math.max(...versions);
}

function hostBind() {
  const src = read("server/config.ts");
  const m = src.match(/DEFAULT_HTTP_HOST\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

const facts = {
  permissions: permissionCount(),
  auditActions: auditActionCount(),
  migrations: migrationMax(),
  host: hostBind(),
  services: fileCount("src/core/services", /\.service\.ts$/),
  pages: fileCount("src/pages", /\.tsx$/),
  tests: fileCount("tests", /\.test\.ts$/),
};

/* ------------------------------------------------------------------ *
 * 2. Apply value-only replacements (safe, contextual regexes).
 * ------------------------------------------------------------------ */
function replaceIn(path, patterns, label) {
  const full = resolve(root, path);
  if (!existsSync(full)) return;
  let out = read(path);
  const before = out;
  for (const { re, to } of patterns) {
    out = out.replace(re, to);
  }
  if (out !== before) {
    write(path, out);
    changed.push(path);
    log.push(`  [${label}] ${path}`);
  }
}

/* AGENTS.md — host bind in the ASCII diagram + dev:server command + audit actions count */
const agentsPatterns = [
  { re: /HTTP on 127\.0\.0\.1:8890 only/, to: `HTTP on ${facts.host}:8890` },
  { re: /Build \+ run backend \(127\.0\.0\.1:8890\)/, to: `Build + run backend (${facts.host}:8890)` },
  { re: /Audit action enum \(\d+ actions\)/, to: `Audit action enum (${facts.auditActions} actions)` },
  { re: /permissions\.ts          Roles, \d+ permissions, DB-backed grant cache/, to: `permissions.ts          Roles, ${facts.permissions} permissions, DB-backed grant cache` },
];
replaceIn("AGENTS.md", agentsPatterns, "host");

/* .ai/project.md — runtime bind line */
if (facts.host) {
  replaceIn(
    ".ai/project.md",
    [{ re: /Backend listens on `[0-9.]+:8890` only/, to: `Backend listens on \`${facts.host}:8890\` by default` }],
    "host"
  );
} else {
  log.push("  [host] .ai/project.md skipped (no GYMSYSTEM_HOST default found)");
}

/* docs/ai/architecture.md — bind line, migrations range, service count, page count */
replaceIn("docs/ai/architecture.md", [
  { re: /[0-9.]+:8890 \(loopback only\)/, to: `${facts.host}:8890` },
  { re: /v1\.\.v\d+/g, to: `v1..v${facts.migrations}` },
  { re: /migrations v1\.\.v\d+\)/, to: `migrations v1..v${facts.migrations})` },
  { re: /27 domain services/, to: `${facts.services} domain services` },
], "numbers");

/* docs/ai/database.md — migration headline + history + permissions seed */
replaceIn("docs/ai/database.md", [
  { re: /Currently \*\*v1 through v\d+\*\*/, to: `Currently **v1 through v${facts.migrations}**` },
  { re: /v1 through v\d+/, to: `v1 through v${facts.migrations}` },
  { re: /72 permissions/, to: `${facts.permissions} permissions` },
  { re: /Permission codes \(72 seeded\)/, to: `Permission codes (${facts.permissions} seeded)` },
], "numbers");

/* shared permission-count refs in live docs (.ai/* and docs/ai/*) */
const permTargets = [".ai/architecture.md", ".ai/business-rules.md", "docs/ai/architecture.md", "docs/ai/business-rules.md"];
for (const p of permTargets) {
  replaceIn(p, [
    { re: /\b68 perms\b/, to: `${facts.permissions} perms` },
    { re: /\b68 permissions\b/, to: `${facts.permissions} permissions` },
    { re: /\b72 permissions\b/, to: `${facts.permissions} permissions` },
  ], "numbers");
}

/* ------------------------------------------------------------------ *
 * 3. Report.
 * ------------------------------------------------------------------ */
console.log("sync-docs.mjs — facts read from source:");
console.log(`  permissions = ${facts.permissions}`);
console.log(`  audit actions = ${facts.auditActions}`);
console.log(`  migrations = v1..v${facts.migrations}`);
console.log(`  host default = ${facts.host}`);
console.log(`  services = ${facts.services}`);
console.log(`  pages = ${facts.pages}`);
console.log(`  test files = ${facts.tests}`);
console.log("");
if (changed.length) {
  console.log("Updated files:");
  changed.forEach((f) => console.log(`  - ${f}`));
  log.forEach((l) => console.log(l));
} else {
  console.log("No value updates were needed; docs already in sync for all targeted values.");
}

/* Exit non-zero only on real errors (thrown above), not on "no changes". */
