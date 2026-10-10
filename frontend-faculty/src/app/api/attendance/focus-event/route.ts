import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studentId = String(body.student_id || "").trim().toUpperCase();
    const eventType = body.event_type;

    const student = STUDENTS_MAP.get(studentId);
    if (student) {
      student.last_seen = Date.now() / 1000;
      if (eventType === "EVENT_FOCUS_LOST") {
        student.is_focused = false;
        student.attendance_status = "LEFT_MIDDLE";
        student.leave_count = (student.leave_count || 0) + 1;
      } else if (eventType === "EVENT_FOCUS_RESTORED") {
        student.is_focused = true;
        // Restore back to present — the leave_count already records the violation
        if (student.attendance_status === "LEFT_MIDDLE") {
          student.attendance_status = "VERIFIED_PRESENT";
        }
      }
    }

    return NextResponse.json({ ok: true, focus_state: "registered" });
  } catch (err: any) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
