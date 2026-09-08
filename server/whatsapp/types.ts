export const WHATSAPP_STATUS = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  QR_REQUIRED: "QR_REQUIRED",
  READY: "READY",
  AUTHENTICATED: "AUTHENTICATED",
  AUTH_FAILURE: "AUTH_FAILURE",
  DISCONNECTED_ERROR: "DISCONNECTED_ERROR",
  SENDING: "SENDING",
  ERROR: "ERROR",
} as const;

export type WhatsAppStatus = (typeof WHATSAPP_STATUS)[keyof typeof WHATSAPP_STATUS];

export interface WhatsAppState {
  status: WhatsAppStatus;
  qrCode: string | null; // base64 data URL for login QR
  connectedNumber: string | null; // the linked phone number
  lastError: string | null; // i18n key for the last error
  busy: boolean; // a send operation in progress
}

export interface SendQrResult {
  ok: boolean;
  sent: boolean; // true if actually sent
  messageKey: string; // i18n key for the result message
  params?: Record<string, string | number>;
}

export interface WhatsAppSessionInfo {
  status: WhatsAppStatus;
  connectedNumber: string | null;
  lastError: string | null;
  busy: boolean;
}
