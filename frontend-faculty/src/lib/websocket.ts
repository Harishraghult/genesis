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
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        this.isConnected = true;
        // console.log("[WS] Connected to FocusLock backend gateway");
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
        setTimeout(() => this.connect(), this.reconnectInterval);
      };

      this.socket.onerror = (err) => {
        this.socket?.close();
      };
    } catch (e) {
      setTimeout(() => this.connect(), this.reconnectInterval);
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
