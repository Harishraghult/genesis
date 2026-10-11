import { NextResponse } from "next/server";
import { STUDENTS_MAP, SESSION_STATE, AUDIT_LOGS } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const auditId = `aud_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).slice(2, 6)}`;
  AUDIT_LOGS.unshift({
    id: auditId,
    session_id: SESSION_STATE.session_id,
    student_id: "ALL",
    student_name: "Instructor Roster View",
    actor: "Instructor",
    action: "AUDIT_ROSTER_VIEWED",
    previous_status: null,
    new_status: "inspected",
    reason: `Instructor inspected attendance records of ${STUDENTS_MAP.size} students`,
    recorded_at: new Date().toISOString(),
  });

  const students = Array.from(STUDENTS_MAP.values()).map((s) => ({
    student_id: s.student_id,
    student_name: s.student_name,
    seat: s.seat,
    attendance_status: s.attendance_status,
    is_focused: s.is_focused,
    leave_count: s.leave_count,
    joined_at: s.joined_at,
    last_seen: s.last_seen,
    marked_by: s.marked_by || (s.attendance_status === "ABSENT" ? "none" : "qr"),
    anomaly_flag: s.anomaly_flag,
  }));

  return NextResponse.json({
    session_id: SESSION_STATE.session_id,
    audit_id: auditId,
    students,
  });
}
