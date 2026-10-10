import { getWsUrl } from "./config";

export type WSListener = (data: any) => void;

class WebSocketClient {
  private socket: WebSocket | null = null;
  private listeners: Set<WSListener> = new Set();
  private reconnectInterval: number = 3000;
  private isConnected: boolean = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.connect();
    }
  }

  private get url(): string {
    return getWsUrl();
  }

  public connect() {
    const url = this.url;
    if (!url) {
      // No WebSocket server available (e.g., on Vercel) — polling handles sync instead
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        this.isConnected = true;
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.listeners.forEach((listener) => listener(data));
        } catch (err) {
          console.error("[WS] Parse error:", err);
        }
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        // Only reconnect if we have a valid URL
        if (this.url) {
          setTimeout(() => this.connect(), this.reconnectInterval);
        }
      };

      this.socket.onerror = () => {
        this.socket?.close();
      };
    } catch (e) {
      if (this.url) {
        setTimeout(() => this.connect(), this.reconnectInterval);
      }
    }
  }


  public subscribe(listener: WSListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public send(payload: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}

export const wsClient = new WebSocketClient();
export const studentWsClient = wsClient;
