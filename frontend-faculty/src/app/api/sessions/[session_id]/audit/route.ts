import { NextRequest, NextResponse } from "next/server";
import { AUDIT_LOGS, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { session_id: string } }
) {
  syncFromDisk();
  const logs = AUDIT_LOGS.filter(
    (a) => a.session_id === params.session_id || a.session_id === "ALL"
  );
  return NextResponse.json(logs);
}
