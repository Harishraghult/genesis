import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { session_id: string } }
) {
  syncFromDisk();
  const pending = Array.from(STUDENTS_MAP.values())
    .filter((s) => s.pending_reason && s.pending_reason.length > 0)
    .map((s) => ({
      student_id: s.student_id,
      student_name: s.student_name,
      reason: s.pending_reason,
      created_at: new Date(Date.now() - 1800000).toISOString(),
    }));

  return NextResponse.json(pending);
}
