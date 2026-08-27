#!/usr/bin/env node
/**
 * git-a.mjs — one-shot commit + push for the GymSystem fork.
 *
 * Usage (git alias `a`, configured repo-local):
 *   git a "commit message"
 *
 * Steps, mirroring AGENTS.md §2: add all → commit "msg" → push.
 * The pre-commit hook runs scripts/sync-docs.mjs automatically before the
 * commit, so value-level doc facts stay in sync on every push.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error("Usage: git a \"commit message\"");
  process.exit(1);
}

run("git", ["add", "-A"]);
run("git", ["commit", "-m", message]);
run("git", ["push"]);
console.log(`\nPushed with message: ${message}`);
