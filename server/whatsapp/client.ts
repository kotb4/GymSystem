import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type { WhatsAppState, WhatsAppStatus } from "./types.js";
import { WHATSAPP_STATUS } from "./types.js";

/**
 * Resolve the browser executable for the puppeteer launcher.
 * The project targets Windows, where Edge is guaranteed present. Falls back to
 * puppeteer's own Chrome-for-Testing when Edge is missing.
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

    // Normalize the CJS namespace: under the ESM loader the named exports may
    // only be reachable via `default` — destructuring `await import(...)` can
    // yield undefined and blow up with «LocalAuth is not a constructor».
    const mod: any = await import("whatsapp-web.js");
    const Lib = mod?.default ?? mod;
    const Client = Lib?.Client ?? mod?.Client;
    const LocalAuth = Lib?.LocalAuth ?? mod?.LocalAuth;

    const executablePath = resolveBrowserExecutable();
    // A modern user-agent is REQUIRED in BOTH places: as a launch arg (which
    // makes the library skip pushing its ancient Chrome/101 default) AND as
    // the client `userAgent` option — the library calls
    // `page.setUserAgent(this.options.userAgent)` after launch, so without the
    // option the page reverts to the 2022 UA and WhatsApp Web never finishes
    // loading (initialize() hangs in CONNECTING forever).
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const puppeteerOptions: Record<string, unknown> = {
      headless: true,
      // remote-allow-origins: Chromium 111+ rejects the DevTools WebSocket of
      // older puppeteer versions otherwise — initialize() then hangs forever.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--remote-allow-origins=*",
        `--user-agent=${userAgent}`,
      ],
    };
    if (executablePath) puppeteerOptions.executablePath = executablePath;
    Object.assign(puppeteerOptions, this.puppeteerOptions);

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: sessionDir,
        clientId: "gym-system",
      }),
      userAgent,
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
