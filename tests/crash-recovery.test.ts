import { describe, expect, it } from "vitest";
import { fork } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { NodeSqliteDriver } from "../server/driver";
import { Db } from "@/db/engine";
import { runMigrations } from "@/db/migrations";

describe("Test 4: Crash & Abrupt Kill Recovery Test", () => {
  it(
    "recovers cleanly with zero corruption when the process is killed abruptly (SIGKILL) mid-transaction",
    async () => {
      console.log("\n=======================================================");
      console.log("⚡ STARTING CRASH & ABRUPT KILL RECOVERY TEST (TEST 4)");
      console.log("=======================================================");

      // Create isolated test database file on disk in temp directory
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gym-crash-test-"));
      const dbFile = path.join(tmpDir, "gym.db");

      console.log(`1. Initializing real on-disk SQLite database at:\n   ${dbFile}`);
      const driver = new NodeSqliteDriver(dbFile);
      const db = new Db(driver);
      runMigrations(db);

      // Seed initial base data: owner and 10 base members
      db.run(
        "INSERT INTO users (id, username, password_hash, full_name, role_id, is_active, created_at, updated_at) VALUES ('usr-1', 'owner', 'hash', 'Owner', 'owner', 1, '2026-01-01', '2026-01-01')"
      );

      db.transaction(() => {
        for (let i = 1; i <= 10; i++) {
          db.run(
            `INSERT INTO members (id, member_code, full_name, phone, gender, department, status, registration_date, created_by, created_at, updated_at, branch_id)
             VALUES (?, ?, ?, ?, 'male', 'general', 'active', '2026-01-01', 'usr-1', '2026-01-01', '2026-01-01', 'main')`,
            [`mem-${i}`, `MEM-${i}`, `عضو أساسي ${i}`, `010000000${i}`]
          );
        }
      });

      const initialMemberCount = db.count("SELECT COUNT(*) FROM members");
      expect(initialMemberCount).toBe(10);
      console.log(`✓ Initial baseline committed: ${initialMemberCount} members.`);

      // Close handle so child worker can open it
      driver.close();

      // Create a standalone worker script that will begin a transaction, insert uncommitted rows, and report readiness
      const workerScript = path.join(tmpDir, "crash-worker.mjs");
      fs.writeFileSync(
        workerScript,
        `
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2]);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Begin transaction
db.exec("BEGIN IMMEDIATE;");

// Insert uncommitted members and uncommitted payments
for (let i = 100; i < 150; i++) {
  db.prepare(\`INSERT INTO members (id, member_code, full_name, phone, gender, department, status, registration_date, created_by, created_at, updated_at, branch_id)
   VALUES (?, ?, ?, ?, 'male', 'general', 'active', '2026-01-01', 'usr-1', '2026-01-01', '2026-01-01', 'main')\`).run(
    'mem-' + i, 'MEM-' + i, 'عضو غير مكتمل ' + i, '011000000' + i
  );
}

// Signal to parent process that we are actively holding an uncommitted transaction
if (process.send) {
  process.send("TRANSACTION_DIRTY_READY");
}

// Keep process hanging mid-transaction until forcefully killed
setInterval(() => {}, 10000);
`
      );

      console.log("\n2. Spawning child process to execute atomic write transaction...");
      const child = fork(workerScript, [dbFile], { stdio: ["inherit", "inherit", "inherit", "ipc"] });

      await new Promise<void>((resolve, reject) => {
        child.on("message", (msg) => {
          if (msg === "TRANSACTION_DIRTY_READY") {
            console.log("  -> Child process confirmed: actively holding uncommitted transaction in WAL.");
            resolve();
          }
        });
        child.on("error", reject);
      });

      // 3. Simulating sudden power loss / abrupt SIGKILL
      console.log("\n3. 💥 Simulating Sudden Power Loss (sending SIGKILL to crash worker immediately)...");
      const killSuccess = child.kill("SIGKILL");
      expect(killSuccess).toBe(true);

      await new Promise<void>((resolve) => {
        child.on("exit", (code, signal) => {
          console.log(`  -> Child process terminated abruptly. Exit signal: ${signal}`);
          resolve();
        });
      });

      // Verify that WAL or SHM files exist on disk
      const filesAfterKill = fs.readdirSync(tmpDir);
      console.log(`  -> Directory state immediately after crash: ${filesAfterKill.join(", ")}`);

      // 4. Re-opening Database via standard startup path (WAL recovery)
      console.log("\n4. 🔄 Booting system & re-opening database with NodeSqliteDriver...");
      const recoveredDriver = new NodeSqliteDriver(dbFile);
      const recoveredDb = new Db(recoveredDriver);

      // Run integrity check
      const integrity = recoveredDb.scalar<string>("PRAGMA integrity_check");
      console.log(`  -> PRAGMA integrity_check after recovery: ${integrity}`);
      expect(integrity).toBe("ok");

      // Verify total members: MUST be exactly 10 (uncommitted 50 members must be completely rolled back)
      const recoveredMemberCount = recoveredDb.count("SELECT COUNT(*) FROM members");
      console.log(`  -> Members count after crash recovery: ${recoveredMemberCount} (Expected: 10)`);
      expect(recoveredMemberCount).toBe(10);

      // Verify no partial or corrupt uncommitted records exist
      const uncommittedFound = recoveredDb.count("SELECT COUNT(*) FROM members WHERE full_name LIKE '%غير مكتمل%'");
      console.log(`  -> Uncommitted dirty records found: ${uncommittedFound} (Expected: 0)`);
      expect(uncommittedFound).toBe(0);

      // Verify database accepts new transactions smoothly after recovery
      console.log("\n5. ✍️ Verifying new write transactions after recovery...");
      recoveredDb.transaction(() => {
        recoveredDb.run(
          `INSERT INTO members (id, member_code, full_name, phone, gender, department, status, registration_date, created_by, created_at, updated_at, branch_id)
           VALUES ('mem-post-recovery', 'MEM-POST-1', 'عضو بعد التعافي', '01299999999', 'male', 'general', 'active', '2026-01-01', 'usr-1', '2026-01-01', '2026-01-01', 'main')`
        );
      });

      const countAfterNewWrite = recoveredDb.count("SELECT COUNT(*) FROM members");
      expect(countAfterNewWrite).toBe(11);
      console.log(`  -> Total members after post-recovery write: ${countAfterNewWrite}`);

      // Final integrity check
      const finalIntegrity = recoveredDb.scalar<string>("PRAGMA integrity_check");
      expect(finalIntegrity).toBe("ok");
      console.log(`  -> Final PRAGMA integrity_check: ${finalIntegrity}`);

      recoveredDriver.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });

      console.log("\n✓ CRASH & ABRUPT KILL RECOVERY DRILL PASSED WITH 100% INTEGRITY.");
      console.log("=======================================================\n");
    },
    20000
  );
});
