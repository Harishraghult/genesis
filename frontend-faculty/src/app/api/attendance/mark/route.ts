import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studentId = String(body.student_id || "").trim().toUpperCase();
    const status = body.status === "PRESENT" ? "VERIFIED_PRESENT" : "ABSENT";

    const student = STUDENTS_MAP.get(studentId);
    if (student) {
      student.attendance_status = status;
      student.marked_by = "instructor";
      student.is_focused = status === "VERIFIED_PRESENT";
      if (status === "VERIFIED_PRESENT") {
        student.joined_at = student.joined_at || Date.now() / 1000;
      }
      student.last_seen = Date.now() / 1000;
    }

    return NextResponse.json({
      ok: true,
      student_id: studentId,
      attendance_status: status,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
