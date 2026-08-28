import { DatabaseSync } from "node:sqlite";
import type { DbDriver, DriverRunResult, Row, SqlParams } from "@/db/engine";

export class NodeSqliteDriver implements DbDriver {
  private database: DatabaseSync;

  constructor(path = ":memory:") {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  run(sql: string, params: SqlParams = []): DriverRunResult {
    const statement = this.database.prepare(sql);
    const info = statement.run(...(params as never[]));
    return { changes: Number(info.changes), lastId: Number(info.lastInsertRowid) };
  }

  all(sql: string, params: SqlParams = []): Row[] {
    const statement = this.database.prepare(sql);
    return statement.all(...(params as never[])) as Row[];
  }

  get(sql: string, params: SqlParams = []): Row | null {
    const statement = this.database.prepare(sql);
    return (statement.get(...(params as never[])) as Row | undefined) ?? null;
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  exportBytes(): Uint8Array | null {
    return null;
  }

  close(): void {
    this.database.close();
  }
}
