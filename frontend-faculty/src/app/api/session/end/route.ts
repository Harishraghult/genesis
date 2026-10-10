import { NextResponse } from "next/server";
import { SESSION_STATE, computeMetrics, syncToDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST() {
  SESSION_STATE.is_active = false;
  SESSION_STATE.ended_at = Date.now() / 1000;
  syncToDisk();

  return NextResponse.json({
    ok: true,
    message: "Session ended. Student devices released and returned to idle check-in.",
    session: SESSION_STATE,
    summary: computeMetrics(),
  });
}
