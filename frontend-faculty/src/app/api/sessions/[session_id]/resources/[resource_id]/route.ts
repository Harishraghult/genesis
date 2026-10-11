import { NextRequest, NextResponse } from "next/server";
import { RESOURCES_LIST, syncFromDisk, syncToDisk, recordAudit } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { session_id: string; resource_id: string } }
) {
  syncFromDisk();
  const idx = RESOURCES_LIST.findIndex((r) => r.id === params.resource_id);
  if (idx !== -1) {
    const removed = RESOURCES_LIST.splice(idx, 1)[0];
    recordAudit({
      session_id: params.session_id,
      student_id: "ALL",
      student_name: "Course Resource",
      actor: "Dr. Sarah Jenkins",
      action: "resource_removed",
      previous_status: removed.title,
      new_status: "removed",
      reason: `Removed resource link ${removed.title}`,
      recorded_at: new Date().toISOString(),
    });
    syncToDisk();
  }
  return NextResponse.json({ ok: true });
}
