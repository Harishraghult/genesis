import { NextResponse } from "next/server";
import { SESSION_STATE, computeMetrics, syncFromDisk, FOCUS_ALERTS } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET() {
  syncFromDisk();

  const summary = computeMetrics();
  return NextResponse.json({
    session: {
      is_active: SESSION_STATE.is_active,
      session_id: SESSION_STATE.session_id,
      started_at: SESSION_STATE.started_at,
      ended_at: SESSION_STATE.ended_at,
      course_name: SESSION_STATE.course_name,
      instructor: SESSION_STATE.instructor,
      room: SESSION_STATE.room,
    },
    summary,
    metrics: summary,
    emergency_number: "112",
    recent_focus_alerts: FOCUS_ALERTS.slice(-10),
  });
}
