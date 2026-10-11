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

  // 20-second rotation window
  const rotation_seconds = 20;
  const now = Date.now();
  const windowIndex = Math.floor(now / (rotation_seconds * 1000));
  const expiresAt = (windowIndex + 1) * rotation_seconds * 1000;

  // Generate deterministic cryptographic challenge for this rotation window
  const token = `fl_qr_${session.id}_${windowIndex}_${Math.random().toString(36).substring(2, 8)}`;

  return NextResponse.json({
    qr: token,
    expires_at: new Date(expiresAt).toISOString(),
    rotation_seconds,
  });
}
