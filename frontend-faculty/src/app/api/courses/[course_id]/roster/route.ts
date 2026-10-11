import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { course_id: string } }
) {
  syncFromDisk();
  const students = Array.from(STUDENTS_MAP.values()).map((s) => ({
    id: s.student_id,
    name: s.student_name,
    email: s.email || `${s.student_id.toLowerCase()}@focuslock.test`,
    seat: s.seat,
    role: "student",
  }));

  return NextResponse.json(students);
}
