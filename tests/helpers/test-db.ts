import { Db } from "@/db/engine";
import { runMigrations } from "@/db/migrations";
import { NodeSqliteDriver } from "./node.driver";

export function createTestDb(): Db {
  const db = new Db(new NodeSqliteDriver());
  runMigrations(db);
  return db;
}
