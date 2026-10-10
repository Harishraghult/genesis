export interface StudentRecord {
  student_id: string;
  student_name: string;
  seat: string;
  attendance_status: "VERIFIED_PRESENT" | "LEFT_MIDDLE" | "NETWORK_VERIFICATION_NEEDED" | "ABSENT";
  is_focused: boolean;
  leave_count: number;
  joined_at: number;
  last_seen: number;
  marked_by?: string;
  anomaly_flag?: string;
}

export const MOCK_ENROLLED_STUDENTS: StudentRecord[] = [
  { student_id: "21CS204", student_name: "Harish Raghul", seat: "Row 1, #01", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS042", student_name: "Marcus Vance", seat: "Row 2, #04", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS089", student_name: "Aaliyah Chen", seat: "Row 1, #08", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS115", student_name: "Devon Miller", seat: "Row 4, #12", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS074", student_name: "Rohan Iyer", seat: "Row 3, #06", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS150", student_name: "Priya Sharma", seat: "Row 2, #10", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS099", student_name: "Alex Rivera", seat: "Row 5, #02", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS033", student_name: "Zara Patel", seat: "Row 3, #14", attendance_status: "ABSENT", is_focused: true, leave_count: 0, joined_at: 0, last_seen: 0 },
];

// Persistent global store across Vercel warm lambdas
const globalForSession = globalThis as unknown as {
  fl_session?: {
    is_active: boolean;
    session_id: string;
    started_at: number;
    ended_at: number;
    course_name: string;
    instructor: string;
    room: string;
  };
  fl_students?: Map<string, StudentRecord>;
  fl_audit?: Array<any>;
};

export const SESSION_STATE = globalForSession.fl_session ?? {
  is_active: false,
  session_id: "FL-CS402-2026",
  started_at: 0,
  ended_at: 0,
  course_name: "CS-402: Advanced Distributed Systems & Cyber-Physical Security",
  instructor: "Dr. Sarah Jenkins",
  room: "Hall 302 (North Tower)",
};
globalForSession.fl_session = SESSION_STATE;

export const STUDENTS_MAP: Map<string, StudentRecord> =
  globalForSession.fl_students ?? new Map();
globalForSession.fl_students = STUDENTS_MAP;

export const AUDIT_LOGS = globalForSession.fl_audit ?? [];
globalForSession.fl_audit = AUDIT_LOGS;

// Initialize roster if empty
if (STUDENTS_MAP.size === 0) {
  for (const s of MOCK_ENROLLED_STUDENTS) {
    STUDENTS_MAP.set(s.student_id, { ...s });
  }
}

export function resetRoster() {
  STUDENTS_MAP.clear();
  for (const s of MOCK_ENROLLED_STUDENTS) {
    STUDENTS_MAP.set(s.student_id, { ...s });
  }
  // Also clear audit logs on session reset
  AUDIT_LOGS.length = 0;
}

export function safeResetRoster() {
  // Only reset if no students have checked in yet (idempotent for already-active sessions)
  const anyCheckedIn = Array.from(STUDENTS_MAP.values()).some(
    (s) => s.attendance_status !== "ABSENT"
  );
  if (!anyCheckedIn) {
    resetRoster();
  }
}

export function computeMetrics() {
  const all = Array.from(STUDENTS_MAP.values());
  const checkedIn = all.filter((s) => s.attendance_status !== "ABSENT");
  const present = all.filter((s) => s.attendance_status === "VERIFIED_PRESENT");
  const leftMiddle = all.filter((s) => s.attendance_status === "LEFT_MIDDLE");
  const flagged = all.filter((s) => s.attendance_status === "NETWORK_VERIFICATION_NEEDED");
  const focused = present.length;
  const pct = checkedIn.length > 0 ? Math.round((focused / checkedIn.length) * 100) : 100;

  return {
    total_joined: checkedIn.length,
    focused_count: focused,
    distracted_count: leftMiddle.length,
    focus_percentage: pct,
    flagged_count: flagged.length,
    present_count: present.length,
    left_middle_count: leftMiddle.length,
    absent_count: all.filter((s) => s.attendance_status === "ABSENT").length,
  };
}
