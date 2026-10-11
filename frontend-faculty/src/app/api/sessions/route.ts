import { NextRequest, NextResponse } from "next/server";
import { SESSIONS_LIST, SessionItem, syncFromDisk, syncToDisk, recordAudit } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  syncFromDisk();
  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("course_id");

  let result = SESSIONS_LIST;
  if (courseId) {
    result = result.filter((s) => s.course_id === courseId);
  }
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  try {
    syncFromDisk();
    const body = await req.json();
    const { course_id, title, starts_at, ends_at, room_code } = body;

    if (!course_id || !title || !starts_at || !ends_at) {
      return NextResponse.json({ detail: "Missing required session fields" }, { status: 400 });
    }

    const newSession: SessionItem = {
      id: "FL-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
      course_id: String(course_id),
      title: String(title).trim(),
      room_code: String(room_code || "UNASSIGNED").trim(),
      starts_at: new Date(starts_at).toISOString(),
      ends_at: new Date(ends_at).toISOString(),
      state: "ready",
    };

    SESSIONS_LIST.push(newSession);
    recordAudit({
      session_id: newSession.id,
      student_id: "ALL",
      student_name: "Instructor Scheduled",
      actor: "Dr. Sarah Jenkins",
      action: "session_created",
      previous_status: null,
      new_status: "ready",
      reason: `Session created: ${newSession.title} in Room ${newSession.room_code}`,
      recorded_at: new Date().toISOString(),
    });

    syncToDisk();
    return NextResponse.json(newSession, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ detail: err.message }, { status: 500 });
  }
}
