import { NextResponse } from "next/server";
import { SESSION_STATE, resetRoster, safeResetRoster, syncToDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!SESSION_STATE.is_active) {
    // Full reset only on fresh start (not already active)
    resetRoster();
  } else {
    // Session already active (reconnect) — don't wipe checked-in students
    safeResetRoster();
  }
  SESSION_STATE.is_active = true;
  SESSION_STATE.started_at = Date.now() / 1000;
  SESSION_STATE.ended_at = 0;
  syncToDisk();

  return NextResponse.json({
    ok: true,
    message: "Lecture session started. Rolling QR code active.",
    session: SESSION_STATE,
  });
}
