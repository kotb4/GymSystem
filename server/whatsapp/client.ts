import { EventEmitter } from "node:events";
import type { WhatsAppState, WhatsAppStatus } from "./types.js";
import { WHATSAPP_STATUS } from "./types.js";

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

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: sessionDir,
        clientId: "gym-system",
      }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        ...this.puppeteerOptions,
      },
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
        lastError: "whatsappAuthFailed",
      });
    });

    this.client.on("disconnected", () => {
      this.setStatus(WHATSAPP_STATUS.DISCONNECTED_ERROR, {
        lastError: "whatsappDisconnected",
      });
      // allow reconnect
      this.client = null;
    });

    this.client.on("message", () => {
      /* not used — outbound only */
    });

    await this.client.initialize().catch((err: any) => {
      this.setStatus(WHATSAPP_STATUS.AUTH_FAILURE, {
        lastError: "errors.whatsappAuthFailed",
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
        lastError: "whatsappSendFailed",
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
