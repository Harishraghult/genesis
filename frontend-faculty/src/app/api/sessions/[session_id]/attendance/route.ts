import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { session_id: string } }
) {
  syncFromDisk();
  const rows = Array.from(STUDENTS_MAP.values()).map((s) => ({
    student_id: s.student_id,
    student_name: s.student_name,
    email: s.email,
    status: s.attendance_status === "VERIFIED_PRESENT"
      ? "present"
      : s.attendance_status === "LEFT_MIDDLE"
      ? "present"
      : s.attendance_status === "EXCUSED"
      ? "excused"
      : "absent",
    method: s.marked_by || (s.attendance_status === "ABSENT" ? "none" : "qr"),
  }));

  return NextResponse.json(rows);
}
