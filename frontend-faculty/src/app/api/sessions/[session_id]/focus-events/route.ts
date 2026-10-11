import { NextRequest, NextResponse } from "next/server";
import { FOCUS_EVENTS_LIST, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { session_id: string } }
) {
  syncFromDisk();
  const events = FOCUS_EVENTS_LIST.filter(
    (e) => e.session_id === params.session_id || e.session_id === "ALL"
  );
  return NextResponse.json(events);
}
