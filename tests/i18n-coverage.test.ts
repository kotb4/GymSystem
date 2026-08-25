import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ar } from "@/i18n/ar";

function flatten(obj: unknown, prefix = "", map = new Map<string, string>()) {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, map);
    }
  } else {
    map.set(prefix, String(obj));
  }
  return map;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (["node_modules", "dist", "dist-server", ".git"].includes(e)) continue;
      out.push(...walk(p));
    } else if (/\.(tsx?)$/.test(e) && !p.includes("i18n")) {
      out.push(p);
    }
  }
  return out;
}

const flat = flatten(ar);

describe("i18n coverage", () => {
  it("has every t() key used in frontend code", () => {
    const missing: string[] = [];
    for (const f of walk("src")) {
      const content = readFileSync(f, "utf8");
      const re = /\bt\("([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!flat.has(m[1])) missing.push(`${m[1]} (${f})`);
      }
    }
    expect(missing, `Missing translation keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("has every error key thrown by services and server", () => {
    const missing: string[] = [];
    for (const dir of ["src/core/services", "src/core", "server"]) {
      for (const f of walk(dir)) {
        const content = readFileSync(f, "utf8");
        const re = /err(?:Validation|NotFound|Conflict|Forbidden|Unauthorized|AccountLocked)\(\s*"([^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          if (!flat.has(m[1])) missing.push(`${m[1]} (${f})`);
        }
      }
    }
    expect(missing, `Missing error translations:\n${missing.join("\n")}`).toEqual([]);
  });

  it("has every permission label translated", () => {
    for (const perm of PERMS_LIST) {
      expect(flat.has(`perms.${perm}`), `missing perms.${perm}`).toBe(true);
    }
  });
});

import { PERMS } from "@/core/permissions";
const PERMS_LIST: readonly string[] = PERMS;
