import { NextResponse } from "next/server";
import { SESSION_STATE, computeMetrics, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET() {
  syncFromDisk();

  // If session has not been explicitly ended, ensure it remains active
  if (!SESSION_STATE.is_active && SESSION_STATE.ended_at === 0) {
    SESSION_STATE.is_active = true;
  }

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
  });
}
