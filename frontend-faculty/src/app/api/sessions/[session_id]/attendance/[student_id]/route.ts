import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP, recordAudit, syncFromDisk, syncToDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: { session_id: string; student_id: string } }
) {
  try {
    syncFromDisk();
    const body = await req.json();
    const { status, reason } = body;
    const studentId = params.student_id;

    const student = STUDENTS_MAP.get(studentId);
    if (!student) {
      return NextResponse.json({ detail: "Student not found in course roster" }, { status: 404 });
    }

    const prevStatus = student.attendance_status === "VERIFIED_PRESENT"
      ? "present"
      : student.attendance_status === "EXCUSED"
      ? "excused"
      : "absent";

    if (reason && reason.trim().length > 0 && reason.trim().length < 10) {
      return NextResponse.json({ detail: "Audit correction reason must be at least 10 characters." }, { status: 422 });
    }

    const newAttendanceStatus = status === "present"
      ? "VERIFIED_PRESENT"
      : status === "excused"
      ? "EXCUSED"
      : "ABSENT";

    student.attendance_status = newAttendanceStatus;
    student.marked_by = "teacher_confirmed";
    student.is_focused = status === "present";
    student.last_seen = Date.now() / 1000;
    if (status === "present" && !student.joined_at) {
      student.joined_at = Date.now() / 1000;
    }
    // Clear pending reason if resolved
    student.pending_reason = undefined;

    recordAudit({
      session_id: params.session_id,
      student_id: student.student_id,
      student_name: student.student_name,
      actor: "Dr. Sarah Jenkins",
      action: "teacher_confirmed",
      previous_status: prevStatus,
      new_status: status,
      reason: reason ? reason.trim() : "Teacher manual attendance confirmation",
      recorded_at: new Date().toISOString(),
    });

    syncToDisk();

    return NextResponse.json({
      student_id: student.student_id,
      status: status,
      method: "teacher_confirmed",
    });
  } catch (err: any) {
    return NextResponse.json({ detail: err.message }, { status: 500 });
  }
}
