import { NextResponse } from "next/server";
import { SESSION_STATE, computeMetrics, syncFromDisk, FOCUS_ALERTS, STUDENTS_MAP } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET() {
  syncFromDisk();

  const summary = computeMetrics();

  // Combine explicit alerts with any students currently flagged as LEFT_MIDDLE or with leave_count > 0
  const combinedAlerts = [...FOCUS_ALERTS];
  const existingIds = new Set(FOCUS_ALERTS.map((a) => `${a.student_id}_${a.leave_count}`));

  for (const s of Array.from(STUDENTS_MAP.values())) {
    if ((s.leave_count && s.leave_count > 0) || s.attendance_status === "LEFT_MIDDLE") {
      const key = `${s.student_id}_${s.leave_count}`;
      if (!existingIds.has(key)) {
        combinedAlerts.push({
          id: `fa_${s.student_id}_${s.leave_count || 1}_${Date.now()}`,
          student_id: s.student_id,
          student_name: s.student_name,
          seat: s.seat,
          leave_count: s.leave_count || 1,
          timestamp: (s.last_seen || Date.now() / 1000) * 1000,
          detail: "App-switch violation: student navigated away from active lecture",
          type: "APP_SWITCH",
        });
      }
    }
  }

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
    recent_focus_alerts: combinedAlerts.slice(-10),
  });
}
