declare module "whatsapp-web.js" {
  export class Client {
    constructor(options: any);
    on(event: string, listener: (...args: any[]) => void): void;
    initialize(): Promise<void>;
    logout(): Promise<void>;
    destroy(): Promise<void>;
    sendMessage(to: string, content: any, options?: any): Promise<any>;
    info?: { wid?: { user?: string } };
  }
  export class LocalAuth {
    constructor(options?: any);
  }
  export const MessageMedia: {
    fromFilePath(path: string): any;
  };
}