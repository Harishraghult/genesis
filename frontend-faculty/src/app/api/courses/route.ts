import { NextResponse } from "next/server";
import { COURSES, syncFromDisk } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET() {
  syncFromDisk();
  return NextResponse.json(COURSES);
}
