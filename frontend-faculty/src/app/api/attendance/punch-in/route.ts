import { NextRequest, NextResponse } from "next/server";
import { STUDENTS_MAP, SESSION_STATE } from "@/lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studentId = String(body.student_id || "").trim().toUpperCase();
    const studentName = String(body.student_name || "").trim();
    const token = String(body.totp_token || "").trim();

    if (!SESSION_STATE.is_active) {
      return NextResponse.json({
        status: "ERROR",
        message: "The instructor has not started the session yet. Please wait for the QR code on the projector.",
      }, { status: 400 });
    }

    let record = STUDENTS_MAP.get(studentId);
    if (!record) {
      // Find case-insensitive or name match
      for (const v of Array.from(STUDENTS_MAP.values())) {
        if (v.student_id.toUpperCase() === studentId || v.student_name.toLowerCase() === studentName.toLowerCase()) {
          record = v;
          break;
        }
      }
    }

    const now = Date.now() / 1000;
    if (record) {
      record.attendance_status = "VERIFIED_PRESENT";
      record.is_focused = true;
      record.joined_at = record.joined_at || now;
      record.last_seen = now;
      record.marked_by = "qr";
    } else {
      // Guest or custom student record
      const guest = {
        student_id: studentId,
        student_name: studentName,
        seat: "Guest",
        attendance_status: "VERIFIED_PRESENT" as const,
        is_focused: true,
        leave_count: 0,
        joined_at: now,
        last_seen: now,
        marked_by: "qr",
      };
      STUDENTS_MAP.set(studentId, guest);
      record = guest;
    }

    return NextResponse.json({
      status: "FOCUSED",
      student_id: record.student_id,
      student_name: record.student_name,
      session_id: SESSION_STATE.session_id,
      session_token: "st_tok_" + record.student_id,
      session_secret: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      message: "Attendance attested and verified. Welcome to Lecture Mode.",
    });
  } catch (err: any) {
    return NextResponse.json({ status: "ERROR", message: err.message }, { status: 500 });
  }
}
