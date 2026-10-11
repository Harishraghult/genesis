import { NextResponse } from "next/server";
import { SESSION_STATE, SESSIONS_LIST, computeMetrics, syncToDisk, recordAudit } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST() {
  SESSION_STATE.is_active = false;
  SESSION_STATE.ended_at = Date.now();
  
  for (const s of SESSIONS_LIST) {
    if (s.state === "active" || s.state === "checkin_pending" || s.state === "paused") {
      s.state = "ended";
      recordAudit({
        session_id: s.id,
        student_id: "ALL",
        student_name: "Instructor Action",
        actor: "Dr. Sarah Jenkins",
        action: "session_end",
        previous_status: null,
        new_status: "ended",
        reason: "Instructor closed and ended active lecture session",
        recorded_at: new Date().toISOString(),
      });
    }
  }

  syncToDisk();

  return NextResponse.json({
    ok: true,
    message: "Session ended. Student devices released and returned to idle check-in.",
    session: SESSION_STATE,
    summary: computeMetrics(),
  });
}
