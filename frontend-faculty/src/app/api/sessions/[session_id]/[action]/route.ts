import { NextRequest, NextResponse } from "next/server";
import { SESSIONS_LIST, SESSION_STATE, syncFromDisk, syncToDisk, recordAudit } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { session_id: string; action: string } }
) {
  syncFromDisk();
  const session = SESSIONS_LIST.find((s) => s.id === params.session_id);
  if (!session) {
    return NextResponse.json({ detail: "Session not found" }, { status: 404 });
  }

  const action = params.action;
  let newState = session.state;

  if (action === "start") {
    newState = "checkin_pending";
    SESSION_STATE.is_active = true;
    SESSION_STATE.session_id = session.id;
    SESSION_STATE.started_at = Date.now();
  } else if (action === "activate") {
    newState = "active";
    SESSION_STATE.is_active = true;
    SESSION_STATE.session_id = session.id;
  } else if (action === "pause") {
    newState = "paused";
  } else if (action === "resume") {
    newState = "active";
    SESSION_STATE.is_active = true;
    SESSION_STATE.session_id = session.id;
  } else if (action === "end") {
    newState = "ended";
    session.state = "ended";
    const anyOtherActive = SESSIONS_LIST.some((s) => s.id !== session.id && (s.state === "active" || s.state === "checkin_pending"));
    SESSION_STATE.is_active = anyOtherActive;
    SESSION_STATE.ended_at = Date.now();
  } else {
    return NextResponse.json({ detail: `Invalid session action: ${action}` }, { status: 400 });
  }

  session.state = newState;
  recordAudit({
    session_id: session.id,
    student_id: "ALL",
    student_name: "Instructor Action",
    actor: "Dr. Sarah Jenkins",
    action: `session_${action}`,
    previous_status: null,
    new_status: newState,
    reason: `Instructor transitioned session state to ${newState}`,
    recorded_at: new Date().toISOString(),
  });

  syncToDisk();
  return NextResponse.json(session);
}
