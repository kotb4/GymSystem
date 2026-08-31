import { describe, expect, it } from "vitest";
import { Db } from "@/db/engine";
import { runMigrations } from "@/db/migrations";
import { NodeSqliteDriver } from "./helpers/node.driver";

/**
 * Regression guard for the CRITICAL upgrade bug: migration v21 rebuilds
 * `products`/`stock_movements` (DROP + RENAME) which are referenced by other
 * tables. `PRAGMA foreign_keys = OFF` is a no-op inside a transaction, so the
 * original migration failed with "FOREIGN KEY constraint failed" whenever the
 * store tables contained data. Fix: toggle FK off at the connection level
 * around the migration (Migration.fkOff).
 *
 * This test seeds a v20-shaped schema WITH store data, then runs migrations
 * v21..v22 and asserts success + data preserved + FK re-enabled.
 */
describe("store migration v21 upgrade path", () => {
  it("rebuilds products/stock_movements with FK ON and preserves data", () => {
    const db = new Db(new NodeSqliteDriver());
    db.setForeignKeys(false); // build v20 skeleton without FK friction
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, full_name TEXT)");
    db.exec("CREATE TABLE members (id TEXT PRIMARY KEY, full_name TEXT)");
    db.exec("CREATE TABLE product_categories (id TEXT PRIMARY KEY, name_ar TEXT)");
    db.exec(
      "CREATE TABLE products (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL,\n  category_id TEXT REFERENCES product_categories(id),\n  sku TEXT UNIQUE,\n  barcode TEXT UNIQUE,\n  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),\n  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),\n  stock_qty REAL NOT NULL DEFAULT 0,\n  min_stock_qty REAL NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0),\n  supplier_name TEXT,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)",
    );
    db.exec(
      "CREATE TABLE stock_movements (\n  id TEXT PRIMARY KEY,\n  product_id TEXT NOT NULL REFERENCES products(id),\n  movement_type TEXT,\n  delta REAL NOT NULL,\n  result_qty REAL NOT NULL,\n  unit_cost_minor INTEGER,\n  ref_table TEXT,\n  ref_id TEXT,\n  notes TEXT,\n  created_by TEXT REFERENCES users(id),\n  created_at TEXT NOT NULL\n)",
    );
    db.exec(
      "CREATE TABLE store_sales (\n  id TEXT PRIMARY KEY,\n  sale_no TEXT,\n  member_id TEXT,\n  method_code TEXT,\n  status TEXT\n)",
    );
    db.exec(
      "CREATE TABLE store_sale_items (\n  id TEXT PRIMARY KEY,\n  sale_id TEXT NOT NULL REFERENCES store_sales(id),\n  product_id TEXT NOT NULL REFERENCES products(id),\n  qty REAL NOT NULL,\n  unit_price_minor INTEGER,\n  unit_cost_minor INTEGER,\n  line_total_minor INTEGER\n)",
    );
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
    db.exec("CREATE TABLE permissions (code TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE role_permissions (role_id TEXT, permission_code TEXT)");
    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");

    // Claim versions 1..20 are already applied so runMigrations only applies 21..24.
    for (let v = 1; v <= 20; v++) {
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, '2026-01-01 00:00:00')", [v]);
    }

    // Seed store data (the thing that used to break the rebuild).
    db.run("INSERT INTO products (id, name, cost_minor, price_minor, stock_qty, min_stock_qty, is_active, created_at, updated_at) VALUES ('p1','منتج',5000,10000,20,5,1,'2026-01-01','2026-01-01')", []);
    db.run("INSERT INTO store_sales (id, sale_no, status) VALUES ('s1','SO-0001','completed')", []);
    db.run("INSERT INTO store_sale_items (id, sale_id, product_id, qty, unit_price_minor, unit_cost_minor, line_total_minor) VALUES ('si1','s1','p1',2,10000,5000,20000)", []);
    db.run("INSERT INTO stock_movements (id, product_id, movement_type, delta, result_qty, created_at) VALUES ('m1','p1','stock_in',20,20,'2026-01-01')", []);
    db.setForeignKeys(true); // simulate real boot (FK ON)

    // This must NOT throw anymore.
    expect(() => runMigrations(db)).not.toThrow();

    // Data preserved through the rebuild.
    expect(db.count("SELECT COUNT(*) FROM products WHERE id = 'p1'")).toBe(1);
    expect(db.count("SELECT COUNT(*) FROM store_sale_items WHERE id = 'si1'")).toBe(1);
    expect(db.count("SELECT COUNT(*) FROM stock_movements WHERE id = 'm1'")).toBe(1);
    // Product stock preserved.
    expect(Number(db.scalar("SELECT stock_qty FROM products WHERE id = 'p1'"))).toBe(20);

    // Store schema pieces landed.
    expect(db.count("SELECT COUNT(*) FROM store_returns")).toBe(0);
    const returnCols = db.all<{ name: string }>("PRAGMA table_info(store_returns)").map((c) => c.name);
    expect(returnCols).toContain("return_no");
    const itemCols = db.all<{ name: string }>("PRAGMA table_info(store_return_items)").map((c) => c.name);
    expect(itemCols).toContain("return_id");
    expect(itemCols).toContain("sale_item_id");
    expect(itemCols).toContain("product_id");

    // FK still enforced after the rebuild (v21 fkOff toggles back ON).
    expect(() => db.run("INSERT INTO store_sale_items (id, sale_id, product_id, qty) VALUES ('bad','s1','missing',1)")).toThrow();
    expect(() => db.run("INSERT INTO store_sale_items (id, sale_id, product_id, qty) VALUES ('bad2','nope','p1',1)")).toThrow();
  });
});
