import { NextRequest, NextResponse } from "next/server";
import { SESSIONS_LIST, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { session_id: string } }
) {
  syncFromDisk();
  const session = SESSIONS_LIST.find((s) => s.id === params.session_id);
  if (!session) {
    return NextResponse.json({ detail: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(session);
}
