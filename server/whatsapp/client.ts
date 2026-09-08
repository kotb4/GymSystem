import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WhatsAppState, WhatsAppStatus } from "./types.js";
import { WHATSAPP_STATUS } from "./types.js";

/**
 * Pinned WhatsApp Web version. The library's bundled default (2.2346.52) is a
 * 2022 build whose cache-lookup path leads into LocalWebCache.persist(), which
 * crashes on today's WhatsApp Web HTML (the manifest is no longer versioned —
 * `manifest-<version>.json` became a fixed `/data/manifest.json`, so the
 * library's version regex matches null). Pinning our own version + strict local
 * cache makes the client serve WhatsApp Web from a pre-seeded local HTML file
 * (request interception) and never run persist() at all.
 */
const PINNED_WEB_VERSION = "2.3000.0";
const WHATSAPP_WEB_URL = "https://web.whatsapp.com/";

/**
 * Resolve the browser executable for the embedded puppeteer launcher.
 * The project targets Windows, where Edge is guaranteed present; the bundled
 * Chromium (puppeteer 13.7.0, 2022) is too old to run today's WhatsApp Web.
 * Falls back to puppeteer's bundled path when Edge is missing (dev machines).
 */
function resolveBrowserExecutable(): string | null {
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Ensure the pinned-version WhatsApp Web index.html exists in the local cache.
 * On first run (or after the cache dir is cleared) this downloads the page once
 * from the internet; afterwards this path is fully offline. When the download
 * fails (offline first boot) we return false — the client then skips request
 * interception and WhatsApp Web loads directly in the real browser.
 */
async function seedWebVersionCache(cacheDir: string): Promise<boolean> {
  try {
    const file = join(cacheDir, `${PINNED_WEB_VERSION}.html`);
    if (existsSync(file) && readFileSync(file, "utf8").length > 1000) return true;

    const res = await fetch(WHATSAPP_WEB_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    if (!res.ok) return false;
    const html = await res.text();
    if (html.length < 1000) return false;

    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, html, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Render a WhatsApp Web login QR string to a base64 PNG data URL, or null on
 * failure. Uses the project's existing `qrcode` dependency.
 */
async function qrStringToDataUrl(qr: string): Promise<string | null> {
  try {
    const { toDataURL } = await import("qrcode");
    return await toDataURL(qr, { margin: 1, width: 320 });
  } catch {
    return null;
  }
}

/**
 * Lightweight wrapper around the WhatsApp Web client. Holds runtime state and
 * emits "state" whenever it changes so the service layer can react.
 *
 * The actual whatsapp-web.js Client is created lazily inside `connect()` to keep
 * the module importable in tests without pulling in the heavy puppeteer dep.
 */
export class WhatsAppClient extends EventEmitter {
  private client: any = null;
  private state: WhatsAppState = {
    status: WHATSAPP_STATUS.DISCONNECTED,
    qrCode: null,
    connectedNumber: null,
    lastError: null,
    busy: false,
  };
  private puppeteerOptions: any;

  constructor(puppeteerOptions: any = {}) {
    super();
    this.puppeteerOptions = puppeteerOptions;
  }

  getState(): WhatsAppState {
    return { ...this.state };
  }

  private setStatus(status: WhatsAppStatus, patch: Partial<WhatsAppState> = {}) {
    this.state = { ...this.state, status, ...patch };
    this.emit("state", this.getState());
  }

  isReady(): boolean {
    return this.state.status === WHATSAPP_STATUS.READY && this.client != null;
  }

  /**
   * Lazily import whatsapp-web.js and create the client. We import inside the
   * function (not at module top) so `import "./client"` in tests never loads
   * puppeteer.
   */
  async connect(sessionDir: string): Promise<void> {
    if (this.client) return;
    this.setStatus(WHATSAPP_STATUS.CONNECTING);

    const { Client, LocalAuth } = await import("whatsapp-web.js");

    // Cache dir lives next to the session dir (app data), not the repo.
    const cacheDir = join(sessionDir, "..", "WhatsAppWebCache");
    const haveCachedPage = await seedWebVersionCache(cacheDir);
    const executablePath = resolveBrowserExecutable();

    const puppeteerOptions: Record<string, unknown> = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    };
    if (executablePath) puppeteerOptions.executablePath = executablePath;
    Object.assign(puppeteerOptions, this.puppeteerOptions);

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: sessionDir,
        clientId: "gym-system",
      }),
      // Pin the web version + strict local cache: request interception serves
      // the cached page, so LocalWebCache.persist() never runs. strict:true
      // means a missing cache file is a loud VersionResolveError we surface
      // as ERROR (not the misleading AUTH_FAILURE).
      ...(haveCachedPage
        ? {
            webVersion: PINNED_WEB_VERSION,
            webVersionCache: { type: "local", path: cacheDir, strict: true },
          }
        : {}),
      puppeteer: puppeteerOptions,
    });

    this.client.on("qr", async (qr: string) => {
      const dataUrl = await qrStringToDataUrl(qr);
      this.setStatus(WHATSAPP_STATUS.QR_REQUIRED, { qrCode: dataUrl, lastError: null });
    });

    this.client.on("ready", () => {
      const info = this.client?.info;
      this.setStatus(WHATSAPP_STATUS.READY, {
        qrCode: null,
        connectedNumber: info?.wid?.user ?? null,
        lastError: null,
      });
    });

    this.client.on("authenticated", () => {
      // "ready" fires shortly after; keep intermediate state for UX.
      this.setStatus(WHATSAPP_STATUS.AUTHENTICATED, { qrCode: null });
    });

    this.client.on("auth_failure", () => {
      this.setStatus(WHATSAPP_STATUS.AUTH_FAILURE, {
        lastError: "errors.whatsappAuthFailed",
      });
    });

    this.client.on("disconnected", () => {
      this.setStatus(WHATSAPP_STATUS.DISCONNECTED_ERROR, {
        lastError: "errors.whatsappDisconnected",
      });
      // allow reconnect
      this.client = null;
    });

    this.client.on("message", () => {
      /* not used — outbound only */
    });

    await this.client.initialize().catch((err: any) => {
      // An initialize() failure is NOT an authentication failure — it is a
      // browser/launch/network problem. Report it as ERROR so the UI stops
      // showing the misleading «خطأ في المصادقة» for e.g. a crashed browser.
      this.setStatus(WHATSAPP_STATUS.ERROR, {
        lastError: "errors.whatsappBrowserFailed",
      });
      throw err;
    });
  }

  /**
   * Send an image to a WhatsApp number. Returns the message id.
   * Throws on failure.
   */
  async sendImage(to: string, media: any, caption?: string): Promise<string> {
    if (!this.client) throw new Error("whatsapp client not initialized");
    this.setStatus(WHATSAPP_STATUS.SENDING, { busy: true });
    try {
      const msg = await this.client.sendMessage(`${to}@c.us`, media, {
        caption,
      });
      return msg.id.id;
    } catch (err: any) {
      this.setStatus(WHATSAPP_STATUS.ERROR, {
        lastError: "errors.whatsappSendFailed",
      });
      throw err;
    } finally {
      // restore ready state
      if (this.state.status === WHATSAPP_STATUS.SENDING) {
        this.setStatus(WHATSAPP_STATUS.READY, { busy: false });
      }
    }
  }

  async getQrCode(): Promise<string | null> {
    return this.state.qrCode;
  }

  async logout(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        /* ignore — session is being destroyed anyway */
      }
      this.client = null;
    }
    this.setStatus(WHATSAPP_STATUS.DISCONNECTED, {
      qrCode: null,
      connectedNumber: null,
      lastError: null,
      busy: false,
    });
  }

  async destroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.setStatus(WHATSAPP_STATUS.DISCONNECTED);
  }
}
