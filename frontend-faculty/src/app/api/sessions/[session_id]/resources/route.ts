import { NextRequest, NextResponse } from "next/server";
import { RESOURCES_LIST, ResourceItem, syncFromDisk, syncToDisk, recordAudit } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { session_id: string } }
) {
  syncFromDisk();
  const resources = RESOURCES_LIST.filter(
    (r) => r.session_id === params.session_id || r.session_id === "ALL"
  );
  return NextResponse.json(resources);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { session_id: string } }
) {
  try {
    syncFromDisk();
    const body = await req.json();
    const { title, url, kind, downloadable } = body;

    if (!title || !url) {
      return NextResponse.json({ detail: "Title and URL are required" }, { status: 400 });
    }

    const newResource: ResourceItem = {
      id: "res_" + Math.random().toString(36).substring(2, 9),
      session_id: params.session_id,
      title: String(title).trim(),
      url: String(url).trim(),
      kind: kind === "text" ? "text" : "pdf",
      downloadable: Boolean(downloadable),
      created_at: new Date().toISOString(),
    };

    RESOURCES_LIST.push(newResource);
    recordAudit({
      session_id: params.session_id,
      student_id: "ALL",
      student_name: "Course Resource",
      actor: "Dr. Sarah Jenkins",
      action: "resource_attached",
      previous_status: null,
      new_status: newResource.title,
      reason: `Attached ${newResource.kind.toUpperCase()} document: ${newResource.title}`,
      recorded_at: new Date().toISOString(),
    });

    syncToDisk();
    return NextResponse.json(newResource, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ detail: err.message }, { status: 500 });
  }
}
