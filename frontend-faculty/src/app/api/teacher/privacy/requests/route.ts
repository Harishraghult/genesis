import { NextResponse } from "next/server";
import { PRIVACY_REQUESTS_LIST, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET() {
  syncFromDisk();
  return NextResponse.json(PRIVACY_REQUESTS_LIST);
}
