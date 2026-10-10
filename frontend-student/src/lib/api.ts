import { getApiBase } from "./config";

/**
 * Client API wrapper that injects FocusLock cryptographic headers (X-FL-*)
 *
 * Headers required by SignedRequestGateMiddleware:
 * - X-FL-Session
 * - X-FL-Ts
 * - X-FL-Nonce
 * - X-FL-Sig = HMAC-SHA256(session_secret, timestamp + nonce + path)
 */

async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  let keyBytes: Uint8Array;

  // Handle 64-character hex secret or plain string
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    const match = secret.match(/.{1,2}/g) || [];
    keyBytes = new Uint8Array(match.map((byte) => parseInt(byte, 16)));
  } else {
    keyBytes = enc.encode(secret);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fetchSigned(
  path: string,
  sessionId: string,
  sessionSecret: string,
  options: RequestInit = {}
): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.random().toString(36).substring(2, 12);
  const signature = await hmacSha256(sessionSecret, `${ts}${nonce}${path}`);

  const headers = new Headers(options.headers || {});
  headers.set("X-FL-Session", sessionId);
  headers.set("X-FL-Ts", ts);
  headers.set("X-FL-Nonce", nonce);
  headers.set("X-FL-Sig", signature);

  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });
}
