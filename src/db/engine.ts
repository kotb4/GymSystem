export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlParams = ReadonlyArray<SqlValue>;
export type Row = Record<string, SqlValue>;

export interface DriverRunResult {
  changes: number;
  lastId: number;
}

export interface DbDriver {
  run(sql: string, params?: SqlParams): DriverRunResult;
  all(sql: string, params?: SqlParams): Row[];
  get?(sql: string, params?: SqlParams): Row | null;
  exec(sql: string): void;
  exportBytes(): Uint8Array | null;
  close(): void;
}

export class Db {
  private driver: DbDriver;
  private txDepth = 0;
  private dirty = false;
  private dirtyListeners = new Set<() => void>();

  constructor(driver: DbDriver) {
    this.driver = driver;
  }

  run(sql: string, params?: SqlParams): DriverRunResult {
    const result = this.driver.run(sql, params);
    this.touch();
    return result;
  }

  insert(sql: string, params?: SqlParams): number {
    const result = this.driver.run(sql, params);
    this.touch();
    return result.lastId;
  }

  all<T = Row>(sql: string, params?: SqlParams): T[] {
    return this.driver.all(sql, params) as T[];
  }

  first<T = Row>(sql: string, params?: SqlParams): T | null {
    const row = this.driver.get
      ? this.driver.get(sql, params)
      : this.driver.all(sql, params)[0] ?? null;
    return (row as T | undefined) ?? null;
  }

  scalar(sql: string, params?: SqlParams): SqlValue | null {
    const row = this.first(sql, params);
    if (!row) return null;
    const value = Object.values(row)[0];
    return value === undefined ? null : value;
  }

  count(sql: string, params?: SqlParams): number {
    const value = this.scalar(sql, params);
    return value == null ? 0 : Number(value);
  }

  exec(sql: string): void {
    this.driver.exec(sql);
    this.touch();
  }

  /**
   * Toggles the connection-level FOREIGN KEYS pragma. Must be called OUTSIDE a
   * transaction — SQLite ignores `PRAGMA foreign_keys` inside a transaction.
   * Used by table-rebuild migrations that must DROP/RENAME a referenced table.
   */
  setForeignKeys(enabled: boolean): void {
    this.driver.exec(`PRAGMA foreign_keys = ${enabled ? "ON" : "OFF"}`);
  }

  transaction<TResult>(fn: () => TResult | Promise<TResult>): Awaited<TResult> {
    this.txDepth += 1;
    if (this.txDepth === 1) this.driver.exec("BEGIN IMMEDIATE");
    let result: TResult | Promise<TResult>;
    try {
      result = fn();
    } catch (error) {
      this.finishTransaction(true);
      throw error;
    }
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          this.finishTransaction(false);
          return value;
        },
        (error) => {
          this.finishTransaction(true);
          throw error;
        },
      ) as Awaited<TResult>;
    }
    this.finishTransaction(false);
    return result as Awaited<TResult>;
  }

  private finishTransaction(failed: boolean): void {
    this.txDepth -= 1;
    if (this.txDepth > 0) return;
    if (failed) {
      try {
        this.driver.exec("ROLLBACK");
      } finally {
        this.dirty = false;
      }
      return;
    }
    this.driver.exec("COMMIT");
    this.emitDirty();
  }

  exportBytes(): Uint8Array | null {
    if (this.txDepth > 0) {
      throw new Error("cannot export database bytes inside a transaction");
    }
    return this.driver.exportBytes();
  }

  close(): void {
    this.driver.close();
    this.dirtyListeners.clear();
  }

  onDirty(listener: () => void): () => void {
    this.dirtyListeners.add(listener);
    return () => {
      this.dirtyListeners.delete(listener);
    };
  }

  private touch(): void {
    this.dirty = true;
    if (this.txDepth === 0) this.emitDirty();
  }

  private emitDirty(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const listener of [...this.dirtyListeners]) listener();
  }
}
