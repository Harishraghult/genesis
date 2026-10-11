import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP, recordFocusAlert, syncToDisk, syncFromDisk, FOCUS_ALERTS } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    syncFromDisk();
    const body = await req.json();
    const studentId = String(body.student_id || "").trim().toUpperCase();
    const studentName = String(body.student_name || "").trim() || studentId;
    const eventType = body.event_type;
    const detail = String(body.detail || "App switch / focus lost").trim();

    let student = STUDENTS_MAP.get(studentId);
    if (!student && studentId) {
      student = {
        student_id: studentId,
        student_name: studentName,
        seat: "General",
        attendance_status: "VERIFIED_PRESENT",
        is_focused: true,
        leave_count: 0,
        joined_at: Date.now() / 1000,
        last_seen: Date.now() / 1000,
      };
      STUDENTS_MAP.set(studentId, student);
    }
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
        student.attendance_status = "VERIFIED_PRESENT";

        const isCallManager =
          detail.toLowerCase().includes("call manager") ||
          detail.toLowerCase().includes("telephony") ||
          detail.toLowerCase().includes("call");

        if (isCallManager) {
          // Authorized call manager return: pardon violation and clear flag
          student.leave_count = Math.max(0, (student.leave_count || 1) - 1);
          student.anomaly_flag = undefined;

          // Remove the active violation alert for this student
          const alertIdx = FOCUS_ALERTS.findIndex((a) => a.student_id === student.student_id);
          if (alertIdx !== -1) {
            FOCUS_ALERTS.splice(alertIdx, 1);
          }
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
