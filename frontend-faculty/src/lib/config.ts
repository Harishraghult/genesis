export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    // On Vercel or any HTTPS origin, use same-origin Next.js API routes directly
    if (window.location.hostname.endsWith(".vercel.app") || window.location.protocol === "https:") {
      return "";
    }
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "";
}

export function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    const base = process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    const wsBase = base.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    return `${wsBase}/ws/session`;
  }
  if (typeof window !== "undefined") {
    // On Vercel (HTTPS), there's no WebSocket server — return empty to skip WS connection
    if (window.location.hostname.endsWith(".vercel.app") || window.location.protocol === "https:") {
      return "";
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:8000/ws/session`;
  }
  return "";
}

