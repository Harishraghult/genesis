import { NextResponse } from "next/server";
import { SESSION_STATE, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET() {
  syncFromDisk();

  if (!SESSION_STATE.is_active) {
    return NextResponse.json({
      is_active: false,
      totp_token: "",
      expires_in: 0,
      session_id: SESSION_STATE.session_id,
      qr_payload: "",
      message: "Session has not been started by the instructor yet.",
    });
  }

  // 30-second rolling interval (industry standard RFC 6238 TOTP window)
  const stepSeconds = 30;
  const now = Math.floor(Date.now() / 1000);
  const epochWindow = Math.floor(now / stepSeconds);
  const expiresIn = stepSeconds - (now % stepSeconds);

  let h = 0x811c9dc5;
  const s = `fl_salt_2026_${epochWindow}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const token = String(Math.abs(h) % 1000000).padStart(6, "0");
  const payload = JSON.stringify({
    session_id: SESSION_STATE.session_id,
    totp: token,
    ts: now,
    room: "Hall 302",
    salt: "fl_salt_2026",
  });

  return NextResponse.json({
    is_active: true,
    totp_token: token,
    expires_in: expiresIn,
    session_id: SESSION_STATE.session_id,
    timestamp: now,
    step_interval: stepSeconds,
    qr_payload: payload,
  });
}
