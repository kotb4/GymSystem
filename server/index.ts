import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { getDbContext, openDatabase, logLine, isMaintenanceMode, flushLogging } from "./context";
import { resolveHttpHost } from "./config";
import {
  SESSION_COOKIE,
  createSessionToken,
  resolveSessionUser,
  destroySession,
  pruneExpiredSessions,
} from "./sessions";
import { invokeRpc } from "./rpc";
import { licenseStateName, refreshLicenseClock } from "./license/session";
import { startBackupScheduler } from "./backup-scheduler";
import { createServerBackup, readSnapshotBytes, importDatabaseBytes } from "./backups";
import { toAppError, errValidation } from "../src/core/errors";
import type { ServiceActor } from "../src/core/permissions";
import { setup as svcSetup, login as svcLogin } from "../src/core/services/auth.service";
import { toPublicUser, getUserRowById } from "../src/core/services/users.service";
import {
  saveFile,
  readFileBytes,
  permissionForKind,
  getFileMeta,
} from "./files.service";
import { requirePermission } from "../src/core/permissions";

const PORT = Number(process.env.GYMSYSTEM_PORT ?? 8890);
/** Secure default: loopback-only (ADR-023). GYMSYSTEM_HOST still allows LAN exposure. */
const HOST = resolveHttpHost(process.env.GYMSYSTEM_HOST);
const MAX_BODY_BYTES = 256 * 1024 * 1024;
/** Default cap for JSON/small uploads; DB-sized transfers opt into MAX_BODY_BYTES explicitly. */
const DEFAULT_BODY_LIMIT = 8 * 1024 * 1024;
const FILE_UPLOAD_LIMIT = 3 * 1024 * 1024; // files service caps at 2 MB + envelope slack
/** Opt-in via GYMSYSTEM_SECURE_COOKIES=1 when an HTTPS terminator is in front. */
const SECURE_COOKIES = process.env.GYMSYSTEM_SECURE_COOKIES === "1";

/** Frontend build output; overridable, defaults to <cwd>/dist. */
const DIST_DIR = path.resolve(process.env.GYMSYSTEM_DIST ?? path.join(process.cwd(), "dist"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function errorBody(error: unknown): { status: number; body: unknown } {
  const appError = toAppError(error);
  if (!appError) throw error;
  const status =
    appError.code === "UNAUTHORIZED"
      ? 401
      : appError.code === "FORBIDDEN"
        ? 403
        : appError.code === "LOCKED"
          ? 423
          : appError.code === "INTERNAL"
            ? 500
            : 400;
  return {
    status,
    body: {
      ok: false,
      error: {
        name: "AppError",
        code: appError.code,
        messageKey: appError.messageKey,
        params: appError.params,
      },
    },
  };
}

function readBody(
  req: http.IncomingMessage,
  limit: number = DEFAULT_BODY_LIMIT,
  errorKey: string = "errors.backupInvalidFile",
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(errValidation(errorKey));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(
  req: http.IncomingMessage,
  limit?: number,
  errorKey: string = "errors.invalidJsonBody",
): Promise<Record<string, unknown>> {
  const raw = (await readBody(req, limit)).toString("utf8") || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw errValidation(errorKey);
  }
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    try {
      result[name] = decodeURIComponent(rawValue);
    } catch {
      result[name] = rawValue;
    }
  }
  return result;
}

function setSessionCookie(res: http.ServerResponse, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 60 * 60}${SECURE_COOKIES ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
        `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE_COOKIES ? "; Secure" : ""}`,
  );
}

/** Resolve the authenticated actor strictly from the server-side session table. */
function currentActor(ctx: Ctx): ServiceActor | null {
  const token = parseCookies(ctx.req)[SESSION_COOKIE];
  const session = resolveSessionUser(getDbContext().db, token);
  if (!session) return null;
  const row = getDbContext().db.first<{
    id: string;
    username: string;
    role_id: string;
    department: string | null;
  }>("SELECT id, username, role_id, department FROM users WHERE id = ? AND is_active = 1", [
    session.id,
  ]);
  if (!row) return null;
  return {
    userId: row.id,
    username: row.username,
    roleId: row.role_id as ServiceActor["roleId"],
    department: (row.department ?? "general") as ServiceActor["department"],
  };
}

interface AuthPayload {
  username: string;
  password: string;
}

function parseAuthPayload(input: unknown): AuthPayload {
  if (typeof input !== "object" || input === null) throw errValidation("errors.invalidCredentials");
  const raw = input as Record<string, unknown>;
  if (typeof raw.username !== "string" || typeof raw.password !== "string") {
    throw errValidation("errors.invalidCredentials");
  }
  return { username: raw.username, password: raw.password };
}

interface SetupPayload extends AuthPayload {
  gymName: string;
  ownerFullName: string;
}

function parseSetupPayload(input: unknown): SetupPayload {
  const base = parseAuthPayload(input);
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof raw.gymName !== "string" || typeof raw.ownerFullName !== "string") {
    throw errValidation("errors.gymNameRequired");
  }
  return { ...base, gymName: raw.gymName, ownerFullName: raw.ownerFullName };
}

async function handleApi(ctx: Ctx): Promise<void> {
  const { req, res, url } = ctx;
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/ping") {
    return sendJson(res, 200, { ok: true });
  }

  // Liveness/readiness probe; reports 503 while the DB is mid-swap so a
  // supervisor/healthcheck knows not to consider the process ready.
  if (route === "GET /api/health") {
    const healthy = !isMaintenanceMode() && getDbContext().db != null;
    const status = healthy && !isMaintenanceMode() ? 200 : 503;
    return sendJson(res, status, { ok: healthy, maintenance: isMaintenanceMode() });
  }

  if (route === "POST /api/auth/setup") {
    const body = await readJsonBody(req);
    try {
      const user = await svcSetup(getDbContext().db, parseSetupPayload(body.input));
      setSessionCookie(res, createSessionToken(getDbContext().db, user.id));
      logLine(`setup completed for "${user.username}"`);
      return sendJson(res, 200, { ok: true, result: user });
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  if (route === "POST /api/auth/login") {
    const body = await readJsonBody(req);
    try {
      const user = await svcLogin(getDbContext().db, parseAuthPayload(body.input));
      pruneExpiredSessions(getDbContext().db);
      setSessionCookie(res, createSessionToken(getDbContext().db, user.id));
      return sendJson(res, 200, { ok: true, result: user });
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  if (route === "POST /api/auth/logout") {
    destroySession(getDbContext().db, parseCookies(req)[SESSION_COOKIE]);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  // /api/auth/me works WITHOUT a session so the frontend can detect needsSetup
  if (route === "GET /api/auth/me" || route === "POST /api/auth/me") {
    const { db } = getDbContext();
    const owners = db.count(
      "SELECT COUNT(*) FROM users WHERE role_id = 'owner' AND is_active = 1",
    );
    let actor = currentActor(ctx);
    let fullUser = null;
    if (actor && actor.userId !== "legacy-import") {
      fullUser = toPublicUser(getUserRowById(db, actor.userId) ?? (actor as never));
    }
    return sendJson(res, 200, {
      ok: true,
      result: { user: fullUser, needsSetup: owners === 0 },
    });
  }

  // ---- everything below requires a valid session ---------------------------
  let actor = currentActor(ctx);

  // One-time legacy import may run unauthenticated ONLY while the system is
  // still uninitialized (no active owner) so old browser data can be adopted
  // during first-run (spec section 18).
  if (!actor && route === "POST /api/system/import-legacy") {
    const owners = getDbContext().db.count(
      "SELECT COUNT(*) FROM users WHERE role_id = 'owner' AND is_active = 1",
    );
    if (owners === 0) {
      actor = { userId: "legacy-import", username: "system", roleId: "owner" };
    }
  }

  if (!actor) {
    return sendJson(res, 401, {
      ok: false,
      error: {
        name: "AppError",
        code: "UNAUTHORIZED",
        messageKey: "errors.forbidden",
        params: {},
      },
    });
  }

  if (route === "POST /api/rpc") {
    try {
      const body = await readJsonBody(req);
      const outcome = await invokeRpc(
        actor,
        String(body.service ?? ""),
        String(body.fn ?? ""),
        Array.isArray(body.args) ? (body.args as unknown[]) : [],
      );
      return sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  if (route === "POST /api/backups/create") {
    const body = await readJsonBody(req);
    try {
      const kind = body.kind === "auto" ? "auto" : "manual";
      const result = await createServerBackup(actor, kind);
      return sendJson(res, 200, { ok: true, result });
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  if (route === "GET /api/backups/download") {
    try {
      const fileName = url.searchParams.get("file") ?? "";
      const bytes = readSnapshotBytes(actor, fileName);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      });
      res.end(Buffer.from(bytes));
      return;
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  if (route === "POST /api/system/restore" || route === "POST /api/system/import-legacy") {
    const kind = route.endsWith("/restore") ? "restore" : "legacy_import";
    try {
      requirePermission(actor, "backup.restore");
      const raw = await readBody(req, MAX_BODY_BYTES);
      // Encrypted snapshots carry their password via a request header so the
      // password never leaks into session storage or the URL.
      const backupPassword = req.headers["x-backup-password"] ? String(req.headers["x-backup-password"]) : undefined;
      const report = await importDatabaseBytes(actor, new Uint8Array(raw), {
        kind,
        ...(backupPassword ? { password: backupPassword } : {}),
      });
      return sendJson(res, 200, { ok: true, result: report });
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  // ---- file storage (photos / reports) -------------------------------------
  if (route === "POST /api/files") {
    try {
      const kind = url.searchParams.get("kind") ?? "";
      const name = url.searchParams.get("name") ?? "file.bin";
      const mime = url.searchParams.get("mime") ?? "application/octet-stream";
      const raw = await readBody(req, FILE_UPLOAD_LIMIT);
      const saved = saveFile(getDbContext().db, actor, {
        kind: kind as "member_photo" | "inbody_report" | "expense_attachment" | "other",
        originalName: name,
        mimeType: mime,
        content: new Uint8Array(raw),
      });
      return sendJson(res, 200, { ok: true, result: saved });
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  const fileGet = url.pathname.match(/^\/api\/files\/([\w-]+)$/);
  if (req.method === "GET" && fileGet) {
    try {
      requirePermission(actor, "members.view"); // baseline; per-kind check below
      const { meta, bytes } = readFileBytes(getDbContext().db, fileGet[1]);
      requirePermission(actor, permissionForKind(meta.kind));
      res.writeHead(200, {
        "Content-Type": meta.mimeType,
        "Content-Length": bytes.length,
        "Cache-Control": "private, max-age=86400",
      });
      res.end(Buffer.from(bytes));
      return;
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/files-meta/")) {
    try {
      const id = url.pathname.split("/").pop()!;
      requirePermission(actor, "members.view");
      const meta = getFileMeta(getDbContext().db, id);
      requirePermission(actor, permissionForKind(meta.kind));
      return sendJson(res, 200, { ok: true, result: meta });
    } catch (error) {
      const mapped = errorBody(error);
      return sendJson(res, mapped.status, mapped.body);
    }
  }

  return sendJson(res, 404, {
    ok: false,
    error: { name: "AppError", code: "NOT_FOUND", messageKey: "errors.unexpected", params: {} },
  });
}

/**
 * Static assets: hashed files are immutable (safe to cache forever);
 * index.html is never cached so new versions load without any manual
 * cache clearing (spec section 11).
 */
function serveStatic(ctx: Ctx): void {
  const { res, url } = ctx;
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const candidate = path.normalize(path.join(DIST_DIR, pathname));
  const isInsideDist = candidate.startsWith(DIST_DIR + path.sep) || candidate === DIST_DIR;
  const fileExists = fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  const filePath = !isInsideDist || !fileExists ? path.join(DIST_DIR, "index.html") : candidate;

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  const isHashedAsset = pathname.startsWith("/assets/");
  const headers: Record<string, string> = {
    "Content-Type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": isHashedAsset
      ? "public, max-age=31536000, immutable"
      : "no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  });
  stream.pipe(res);
}

export function startHttpServer(): void {
  openDatabase();
  try { pruneExpiredSessions(getDbContext().db); } catch { /* first boot: table just created */ }
  // Prune expired sessions hourly so the session table never grows unbounded
  // (login also prunes opportunistically with each successful login).
  setInterval(() => {
    try {
      pruneExpiredSessions(getDbContext().db);
    } catch {
      /* logged below if it recurs; never crash the loop */
    }
  }, 60 * 60 * 1000).unref();
  // ADR-019: advance the monotonic last-active clock periodically so the
  // anti-rollback guard has a reference point even with no RPC traffic.
    setInterval(() => {
    try {
      refreshLicenseClock();
      logLine(`license clock: ${licenseStateName()}`);
    } catch (error) {
      logLine(`license: clock refresh failed: ${String(error)}`);
    }
  }, 15 * 60 * 1000).unref();
  startBackupScheduler();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const ctx: Ctx = { req, res, url };
    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(ctx);
      } else {
        serveStatic(ctx);
      }
    } catch (error) {
      logLine(`request error ${url.pathname}: ${String(error)}`);
      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          error: {
            name: "AppError",
            code: "INTERNAL",
            messageKey: "errors.unexpected",
            params: {},
          },
        });
      } else {
        res.end();
      }
    }
  });
  server.listen(PORT, HOST, () => {
    logLine(`GymSystem backend listening on http://${HOST}:${PORT}`);
    logLine(`serving frontend from ${DIST_DIR}`);
    logLine(`authoritative database: ${getDbContext().dirs.dbFile}`);
  });
}

process.on("uncaughtException", (error) => {
  logLine(`uncaught exception: ${error.stack ?? String(error)}`);
  // Log the crash, then exit so a supervisor can restart a possibly-corrupted process.
  flushLogging(() => process.exit(1));
  setTimeout(() => process.exit(1), 100);
});
process.on("unhandledRejection", (reason) => {
  logLine(`unhandled rejection: ${String(reason)}`);
  flushLogging();
});

startHttpServer();
