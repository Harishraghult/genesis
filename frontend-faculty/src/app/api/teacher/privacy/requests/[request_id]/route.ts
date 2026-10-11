import { NextRequest, NextResponse } from "next/server";
import { PRIVACY_REQUESTS_LIST, recordAudit, syncFromDisk, syncToDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: { request_id: string } }
) {
  try {
    syncFromDisk();
    const body = await req.json();
    const { status, resolution } = body;

    const request = PRIVACY_REQUESTS_LIST.find((r) => r.id === params.request_id);
    if (!request) {
      return NextResponse.json({ detail: "Privacy request not found" }, { status: 404 });
    }

    if (!resolution || resolution.trim().length < 10) {
      return NextResponse.json({ detail: "Review resolution must be at least 10 characters." }, { status: 422 });
    }

    request.status = status === "accepted" ? "accepted" : "declined";
    request.resolution = resolution.trim();

    recordAudit({
      session_id: request.session_id,
      student_id: request.student_id,
      student_name: request.student_name,
      actor: "Dr. Sarah Jenkins",
      action: `privacy_request_${request.status}`,
      previous_status: request.kind,
      new_status: request.status,
      reason: request.resolution,
      recorded_at: new Date().toISOString(),
    });

    syncToDisk();
    return NextResponse.json(request);
  } catch (err: any) {
    return NextResponse.json({ detail: err.message }, { status: 500 });
  }
}
