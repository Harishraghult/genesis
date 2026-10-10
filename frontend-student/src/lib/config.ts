export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
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
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:8000/ws/session`;
  }
  return "ws://localhost:8000/ws/session";
}
