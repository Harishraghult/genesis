import { getWsUrl } from "./config";

export type WSListener = (data: any) => void;

class StudentWebSocketClient {
  private socket: WebSocket | null = null;
  private url: string = getWsUrl();
  private listeners: Set<WSListener> = new Set();
  private reconnectInterval: number = 3000;

  constructor() {
    if (typeof window !== "undefined") {
      this.url = getWsUrl();
      this.connect();
    }
  }

  public connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.listeners.forEach((listener) => listener(data));
        } catch (err) {
          console.error("[Student WS] Parse error:", err);
        }
      };

      this.socket.onclose = () => {
        setTimeout(() => this.connect(), this.reconnectInterval);
      };

      this.socket.onerror = () => {
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

  public publish(payload: any) {
    this.send(payload);
  }
}

export const studentWsClient = new StudentWebSocketClient();
