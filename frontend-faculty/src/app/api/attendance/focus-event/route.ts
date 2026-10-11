import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP, recordFocusAlert, syncToDisk, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    syncFromDisk();
    const body = await req.json();
    const studentId = String(body.student_id || "").trim().toUpperCase();
    const eventType = body.event_type;
    const detail = String(body.detail || "App switch / focus lost").trim();

    const student = STUDENTS_MAP.get(studentId);
    let alertCreated = null;

    if (student) {
      student.last_seen = Date.now() / 1000;
      if (eventType === "EVENT_FOCUS_LOST") {
        student.is_focused = false;
        student.attendance_status = "LEFT_MIDDLE";
        student.leave_count = (student.leave_count || 0) + 1;

        const alertType = detail.toLowerCase().includes("tamper")
          ? ("TAMPER_DETECTED" as const)
          : detail.toLowerCase().includes("split")
          ? ("SPLIT_SCREEN" as const)
          : detail.toLowerCase().includes("tab")
          ? ("TAB_SWITCH" as const)
          : ("APP_SWITCH" as const);

        alertCreated = recordFocusAlert({
          student_id: student.student_id,
          student_name: student.student_name,
          seat: student.seat,
          leave_count: student.leave_count,
          timestamp: Date.now(),
          detail,
          type: alertType,
        });
      } else if (eventType === "EVENT_FOCUS_RESTORED") {
        student.is_focused = true;
        // Keep present — leave_count preserves violation audit trail
        if (student.attendance_status === "LEFT_MIDDLE") {
          student.attendance_status = "VERIFIED_PRESENT";
        }
        syncToDisk();
      }
    }

    return NextResponse.json({
      ok: true,
      focus_state: "registered",
      alert: alertCreated,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
