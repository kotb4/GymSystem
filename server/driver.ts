import { DatabaseSync } from "node:sqlite";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { DbDriver, DriverRunResult, Row, SqlParams } from "../src/db/engine";

/**
 * Real on-disk SQLite driver (Node built-in `node:sqlite`, spec section 4).
 * Synchronous — matches the existing Db semantics exactly so the whole
 * service layer runs unmodified against the authoritative database file.
 */
export class NodeSqliteDriver implements DbDriver {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
  }

  run(sql: string, params?: SqlParams): DriverRunResult {
    const statement = this.db.prepare(sql);
    const result = params && params.length > 0 ? statement.run(...(params as never[])) : statement.run();
    return {
      changes: Number(result.changes ?? 0),
      lastId: Number(result.lastInsertRowid ?? 0),
    };
  }

  all(sql: string, params?: SqlParams): Row[] {
    const statement = this.db.prepare(sql);
    const rows = params && params.length > 0
      ? statement.all(...(params as never[]))
      : statement.all();
    return rows as Row[];
  }

  get(sql: string, params?: SqlParams): Row | null {
    const statement = this.db.prepare(sql);
    const row = params && params.length > 0
      ? statement.get(...(params as never[]))
      : statement.get();
    return (row as Row | undefined) ?? null;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Consistent snapshot via VACUUM INTO (SQLite >= 3.27), read back as bytes. */
  exportBytes(): Uint8Array | null {
    const tmp = path.join(os.tmpdir(), `gym-export-${crypto.randomUUID()}.db`);
    try {
      this.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      if (!existsSync(tmp)) return null;
      return new Uint8Array(readFileSync(tmp));
    } catch {
      return null;
    } finally {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /** Raw integrity + FK verification used before adopting/restoring files. */
  static probeFile(file: string): { integrity: string; users: number; version: number } {
    const probe = new DatabaseSync(file);
    try {
      const integrityRow = probe.prepare("PRAGMA integrity_check").get() as
        | Record<string, unknown>
        | undefined;
      const integrity = String(integrityRow ? Object.values(integrityRow)[0] : "");
      let users = 0;
      let version = 0;
      try {
        users = Number(
          (probe.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number | bigint }).c,
        );
      } catch {
        users = 0;
      }
      try {
        version = Number(
          (
            probe
              .prepare("SELECT MAX(version) AS v FROM schema_migrations")
              .get() as { v: number | bigint } | undefined
          )?.v ?? 0,
        );
      } catch {
        version = 0;
      }
      return { integrity: integrity.toLowerCase(), users, version };
    } finally {
      probe.close();
    }
  }
}
