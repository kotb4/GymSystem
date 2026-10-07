import { Db } from "../src/db/engine";
import { runMigrations } from "../src/db/migrations";
import { NodeSqliteDriver } from "./driver";
import { seedDemoData } from "../src/db/seed";
import { loadPermissionsCache } from "../src/core/services/permissions.service";
import { setup as svcSetup } from "../src/core/services/auth.service";
import { createSessionToken } from "./sessions";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SandboxInstance {
  id: string;
  dbPath: string;
  driver: NodeSqliteDriver;
  db: Db;
  ownerToken: string;
  createdAt: number;
  lastActiveAt: number;
}

/** Active sandbox instances keyed by sandboxId (or cookie token) */
const activeSandboxes = new Map<string, SandboxInstance>();
const tokenToSandbox = new Map<string, SandboxInstance>();

/** Sandbox idle timeout: 30 minutes of inactivity before auto-destruction */
const SANDBOX_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Hard maximum lifespan: 2 hours */
const SANDBOX_MAX_LIFESPAN_MS = 2 * 60 * 60 * 1000;

let cleanupInterval: NodeJS.Timeout | null = null;

function ensureSandboxTempDir(): string {
  const root = path.join(os.tmpdir(), "gymsystem-sandboxes");
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

/**
 * Initializes and starts the background sweeping loop for expired sandboxes.
 */
export function startSandboxReaper(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    reapExpiredSandboxes();
  }, 60 * 1000); // Check every minute
}

/**
 * Creates an isolated SQLite database instance populated with demo data.
 */
export async function createSandbox(): Promise<{
  sandboxId: string;
  ownerToken: string;
  user: import("../src/core/services/users.service").PublicUser;
  instance: SandboxInstance;
}> {
  const sandboxId = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const tempDir = ensureSandboxTempDir();
  const instanceDir = path.join(tempDir, sandboxId);
  mkdirSync(instanceDir, { recursive: true });

  const dbPath = path.join(instanceDir, "gym.db");
  const driver = new NodeSqliteDriver(dbPath);
  const db = new Db(driver);

  // 1. Run migrations v1..v49
  runMigrations(db);

  // 2. Setup initial Owner account
  const ownerUser = await svcSetup(db, {
    gymName: "GymPro Demo — نادي تجريبي",
    ownerFullName: "مروان عبد الرحمن (ديمو)",
    username: "demo",
    password: "DemoPassword@2026",
  });

  // 3. Populate realistic Arabic gym demo data (members, subscriptions, attendance, pos, etc.)
  await seedDemoData(db);
  loadPermissionsCache(db);
  db.onDirty(() => loadPermissionsCache(db));

  // 4. Generate persistent session token for this visitor
  const ownerToken = createSessionToken(db, ownerUser.id);

  const instance: SandboxInstance = {
    id: sandboxId,
    dbPath,
    driver,
    db,
    ownerToken,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  activeSandboxes.set(sandboxId, instance);
  tokenToSandbox.set(ownerToken, instance);

  return { sandboxId, ownerToken, user: ownerUser, instance };
}

/**
 * Resolves the sandbox instance corresponding to a given session token or request cookie.
 */
export function resolveSandboxByToken(token: string | undefined): SandboxInstance | null {
  if (!token) return null;
  const instance = tokenToSandbox.get(token);
  if (!instance) return null;

  // Touch lastActiveAt
  instance.lastActiveAt = Date.now();
  return instance;
}

/**
 * Destroys a sandbox instance and wipes its SQLite file from disk immediately.
 */
export function destroySandbox(sandboxId: string): void {
  const instance = activeSandboxes.get(sandboxId);
  if (!instance) return;

  try {
    instance.driver.close();
  } catch {
    /* ignore close error */
  }

  try {
    const instanceDir = path.dirname(instance.dbPath);
    if (existsSync(instanceDir)) {
      rmSync(instanceDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore deletion errors */
  }

  tokenToSandbox.delete(instance.ownerToken);
  activeSandboxes.delete(sandboxId);
}

/**
 * Purges all stale sandboxes that exceeded idle or maximum lifetime.
 */
export function reapExpiredSandboxes(): number {
  const now = Date.now();
  let count = 0;

  for (const [id, instance] of activeSandboxes.entries()) {
    const isIdle = now - instance.lastActiveAt > SANDBOX_IDLE_TIMEOUT_MS;
    const isExpired = now - instance.createdAt > SANDBOX_MAX_LIFESPAN_MS;

    if (isIdle || isExpired) {
      destroySandbox(id);
      count++;
    }
  }

  return count;
}

/**
 * Returns diagnostic stats about currently active demo sandboxes.
 */
export function getSandboxStats(): { activeCount: number; instances: string[] } {
  return {
    activeCount: activeSandboxes.size,
    instances: Array.from(activeSandboxes.keys()),
  };
}
