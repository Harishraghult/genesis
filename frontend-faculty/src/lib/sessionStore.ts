export interface StudentRecord {
  student_id: string;
  student_name: string;
  seat: string;
  email?: string;
  attendance_status: "VERIFIED_PRESENT" | "LEFT_MIDDLE" | "NETWORK_VERIFICATION_NEEDED" | "ABSENT" | "EXCUSED";
  is_focused: boolean;
  leave_count: number;
  joined_at: number;
  last_seen: number;
  marked_by?: string;
  anomaly_flag?: string;
  pending_reason?: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  term: string;
  instructor: string;
}

export interface SessionItem {
  id: string;
  course_id: string;
  title: string;
  room_code: string;
  starts_at: string;
  ends_at: string;
  state: "ready" | "checkin_pending" | "active" | "paused" | "ended";
}

export interface ResourceItem {
  id: string;
  session_id: string;
  title: string;
  url: string;
  kind: "pdf" | "text";
  downloadable: boolean;
  created_at: string;
}

export interface AuditItem {
  id: string;
  session_id: string;
  student_id: string;
  student_name: string;
  actor: string;
  action: string;
  previous_status: string | null;
  new_status: string;
  reason: string | null;
  recorded_at: string;
}

export interface FocusEventItem {
  id: string;
  session_id: string;
  student_id: string;
  student_name: string;
  action: "started" | "paused" | "resumed" | "exited" | "expired" | "backgrounded";
  detail: string;
  recorded_at: string;
}

export interface PrivacyRequestItem {
  id: string;
  student_id: string;
  student_name: string;
  session_id: string;
  kind: "correction" | "deletion";
  reason: string;
  status: "pending" | "accepted" | "declined";
  resolution?: string;
  recorded_at: string;
}

export interface FocusAlertItem {
  id: string;
  student_id: string;
  student_name: string;
  seat: string;
  leave_count: number;
  timestamp: number;
  detail: string;
  type: "APP_SWITCH" | "TAB_SWITCH" | "TAMPER_DETECTED" | "SPLIT_SCREEN";
}

export const INITIAL_COURSES: Course[] = [
  { id: "c_cs402", code: "CS-402", title: "Advanced Distributed Systems & Cyber-Physical Security", term: "Fall 2026", instructor: "Dr. Sarah Jenkins" },
  { id: "c_cs101", code: "CS-101", title: "Fundamentals of Computer Systems", term: "Fall 2026", instructor: "Dr. Sarah Jenkins" },
  { id: "c_cs301", code: "CS-301", title: "Operating Systems & Systems Programming", term: "Fall 2026", instructor: "Dr. Sarah Jenkins" },
  { id: "c_cy505", code: "CY-505", title: "Cryptography & Privacy Engineering", term: "Fall 2026", instructor: "Dr. Sarah Jenkins" },
];

export const INITIAL_SESSIONS: SessionItem[] = [
  {
    id: "FL-CS402-2026",
    course_id: "c_cs402",
    title: "Week 7 · Kiosk Attestation, DND & Hardware-Lock Security",
    room_code: "Hall 302 (North Tower)",
    starts_at: new Date(Date.now() - 1800000).toISOString(),
    ends_at: new Date(Date.now() + 5400000).toISOString(),
    state: "active",
  },
  {
    id: "FL-CS402-PREV",
    course_id: "c_cs402",
    title: "Week 6 · Cryptographic Token Rotation & Zero-Trust Replay Defense",
    room_code: "Hall 302 (North Tower)",
    starts_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    ends_at: new Date(Date.now() - 7 * 86400000 + 7200000).toISOString(),
    state: "ended",
  },
  {
    id: "FL-CS101-01",
    course_id: "c_cs101",
    title: "Lecture 1 · Introduction to Memory Hierarchy & CPU Architecture",
    room_code: "Auditorium A",
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 10800000).toISOString(),
    state: "ready",
  },
  {
    id: "FL-CS301-01",
    course_id: "c_cs301",
    title: "Lab 4 · Process Scheduling & Real-Time Kernel Mutexes",
    room_code: "Lab 104",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    ends_at: new Date(Date.now() + 86400000 + 7200000).toISOString(),
    state: "ready",
  },
];

export const MOCK_ENROLLED_STUDENTS: StudentRecord[] = [
  { student_id: "21CS204", student_name: "Harish Raghul", email: "harish.raghul@focuslock.test", seat: "Row 1, #01", attendance_status: "VERIFIED_PRESENT", is_focused: true, leave_count: 0, joined_at: Date.now() / 1000 - 1800, last_seen: Date.now() / 1000, marked_by: "qr" },
  { student_id: "21CS042", student_name: "Marcus Vance", email: "marcus.vance@focuslock.test", seat: "Row 2, #04", attendance_status: "VERIFIED_PRESENT", is_focused: true, leave_count: 1, joined_at: Date.now() / 1000 - 1500, last_seen: Date.now() / 1000, marked_by: "qr" },
  { student_id: "21CS089", student_name: "Aaliyah Chen", email: "aaliyah.chen@focuslock.test", seat: "Row 1, #08", attendance_status: "VERIFIED_PRESENT", is_focused: true, leave_count: 0, joined_at: Date.now() / 1000 - 1700, last_seen: Date.now() / 1000, marked_by: "qr" },
  { student_id: "21CS115", student_name: "Devon Miller", email: "devon.miller@focuslock.test", seat: "Row 4, #12", attendance_status: "ABSENT", is_focused: false, leave_count: 0, joined_at: 0, last_seen: 0, pending_reason: "Camera lens cracked; requesting manual instructor review" },
  { student_id: "21CS074", student_name: "Rohan Iyer", email: "rohan.iyer@focuslock.test", seat: "Row 3, #06", attendance_status: "VERIFIED_PRESENT", is_focused: true, leave_count: 0, joined_at: Date.now() / 1000 - 1600, last_seen: Date.now() / 1000, marked_by: "qr" },
  { student_id: "21CS150", student_name: "Priya Sharma", email: "priya.sharma@focuslock.test", seat: "Row 2, #10", attendance_status: "VERIFIED_PRESENT", is_focused: true, leave_count: 0, joined_at: Date.now() / 1000 - 1400, last_seen: Date.now() / 1000, marked_by: "qr" },
  { student_id: "21CS099", student_name: "Alex Rivera", email: "alex.rivera@focuslock.test", seat: "Row 5, #02", attendance_status: "ABSENT", is_focused: false, leave_count: 0, joined_at: 0, last_seen: 0 },
  { student_id: "21CS033", student_name: "Zara Patel", email: "zara.patel@focuslock.test", seat: "Row 3, #14", attendance_status: "VERIFIED_PRESENT", is_focused: true, leave_count: 0, joined_at: Date.now() / 1000 - 1200, last_seen: Date.now() / 1000, marked_by: "qr" },
];

export const INITIAL_RESOURCES: ResourceItem[] = [
  { id: "res_1", session_id: "FL-CS402-2026", title: "Distributed Consensus & Byzantine Fault Tolerance Notes.pdf", url: "https://faculty.genesis.edu/cs402/notes-w7.pdf", kind: "pdf", downloadable: true, created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: "res_2", session_id: "FL-CS402-2026", title: "Android Security & Hardware Kiosk Pinning Architecture.txt", url: "https://faculty.genesis.edu/cs402/kiosk-reference.txt", kind: "text", downloadable: false, created_at: new Date(Date.now() - 3500000).toISOString() },
  { id: "res_3", session_id: "FL-CS402-2026", title: "FERPA Regulatory Compliance & Anti-Tamper Guide.pdf", url: "https://faculty.genesis.edu/cs402/privacy-guidelines.pdf", kind: "pdf", downloadable: true, created_at: new Date(Date.now() - 3400000).toISOString() },
];

export const INITIAL_AUDIT_LOGS: AuditItem[] = [
  { id: "aud_01", session_id: "FL-CS402-2026", student_id: "21CS204", student_name: "Harish Raghul", actor: "Dr. Sarah Jenkins", action: "teacher_confirmed", previous_status: "ABSENT", new_status: "present", reason: "Student camera hardware issue; verified in person at desk", recorded_at: new Date(Date.now() - 1800000).toISOString() },
  { id: "aud_02", session_id: "FL-CS402-2026", student_id: "21CS089", student_name: "Aaliyah Chen", actor: "QR Engine", action: "qr_checkin", previous_status: null, new_status: "present", reason: "Cryptographic rotating challenge verified", recorded_at: new Date(Date.now() - 1700000).toISOString() },
  { id: "aud_03", session_id: "FL-CS402-2026", student_id: "21CS074", student_name: "Rohan Iyer", actor: "QR Engine", action: "qr_checkin", previous_status: null, new_status: "present", reason: "Cryptographic rotating challenge verified", recorded_at: new Date(Date.now() - 1600000).toISOString() },
];

export const INITIAL_FOCUS_EVENTS: FocusEventItem[] = [
  { id: "foc_01", session_id: "FL-CS402-2026", student_id: "21CS042", student_name: "Marcus Vance", action: "backgrounded", detail: "App left foreground · review only", recorded_at: new Date(Date.now() - 600000).toISOString() },
  { id: "foc_02", session_id: "FL-CS402-2026", student_id: "21CS115", student_name: "Devon Miller", action: "backgrounded", detail: "App left foreground · review only", recorded_at: new Date(Date.now() - 300000).toISOString() },
];

export const INITIAL_PRIVACY_REQUESTS: PrivacyRequestItem[] = [
  { id: "pr_01", student_id: "21CS042", student_name: "Marcus Vance", session_id: "FL-CS402-2026", kind: "correction", reason: "Device rebooted during check-in, marked as absent initially", status: "pending", recorded_at: new Date(Date.now() - 3600000).toISOString() },
  { id: "pr_02", student_id: "21CS115", student_name: "Devon Miller", session_id: "FL-CS402-2026", kind: "deletion", reason: "Accidental test scan while visiting another classroom", status: "pending", recorded_at: new Date(Date.now() - 7200000).toISOString() },
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
  fl_courses?: Course[];
  fl_sessions?: SessionItem[];
  fl_resources?: ResourceItem[];
  fl_audit?: AuditItem[];
  fl_focus_events?: FocusEventItem[];
  fl_privacy_requests?: PrivacyRequestItem[];
  fl_focus_alerts?: FocusAlertItem[];
};

import fs from "fs";
import path from "path";
import os from "os";

const STATE_FILE = path.join(os.tmpdir(), "focuslock_session_state.json");

export const SESSION_STATE = globalForSession.fl_session ?? {
  is_active: true,
  session_id: "FL-CS402-2026",
  started_at: Date.now() - 1800000,
  ended_at: Date.now() + 5400000,
  course_name: "CS-402: Advanced Distributed Systems & Cyber-Physical Security",
  instructor: "Dr. Sarah Jenkins",
  room: "Hall 302 (North Tower)",
};
globalForSession.fl_session = SESSION_STATE;

export const COURSES: Course[] = globalForSession.fl_courses ?? [...INITIAL_COURSES];
globalForSession.fl_courses = COURSES;

export const SESSIONS_LIST: SessionItem[] = globalForSession.fl_sessions ?? [...INITIAL_SESSIONS];
globalForSession.fl_sessions = SESSIONS_LIST;

export const RESOURCES_LIST: ResourceItem[] = globalForSession.fl_resources ?? [...INITIAL_RESOURCES];
globalForSession.fl_resources = RESOURCES_LIST;

export const STUDENTS_MAP: Map<string, StudentRecord> = globalForSession.fl_students ?? new Map();
globalForSession.fl_students = STUDENTS_MAP;

export const AUDIT_LOGS: AuditItem[] = globalForSession.fl_audit ?? [...INITIAL_AUDIT_LOGS];
globalForSession.fl_audit = AUDIT_LOGS;

export const FOCUS_EVENTS_LIST: FocusEventItem[] = globalForSession.fl_focus_events ?? [...INITIAL_FOCUS_EVENTS];
globalForSession.fl_focus_events = FOCUS_EVENTS_LIST;

export const PRIVACY_REQUESTS_LIST: PrivacyRequestItem[] = globalForSession.fl_privacy_requests ?? [...INITIAL_PRIVACY_REQUESTS];
globalForSession.fl_privacy_requests = PRIVACY_REQUESTS_LIST;

export const FOCUS_ALERTS: FocusAlertItem[] = globalForSession.fl_focus_alerts ?? [];
globalForSession.fl_focus_alerts = FOCUS_ALERTS;

// Try to hydrate from disk if file exists
syncFromDisk();

// Initialize roster if empty
if (STUDENTS_MAP.size === 0) {
  for (const s of MOCK_ENROLLED_STUDENTS) {
    STUDENTS_MAP.set(s.student_id, { ...s });
  }
}

export function recordFocusAlert(alert: Omit<FocusAlertItem, "id">): FocusAlertItem {
  const item: FocusAlertItem = {
    ...alert,
    id: "fa_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
  };
  FOCUS_ALERTS.push(item);
  if (FOCUS_ALERTS.length > 50) {
    FOCUS_ALERTS.splice(0, FOCUS_ALERTS.length - 50);
  }

  // Also record in Genesis v2 FocusEvents list
  recordFocusEvent({
    session_id: SESSION_STATE.session_id,
    student_id: alert.student_id,
    student_name: alert.student_name,
    action: "backgrounded",
    detail: alert.detail,
    recorded_at: new Date(alert.timestamp).toISOString(),
  });

  syncToDisk();
  return item;
}

export function recordFocusEvent(event: Omit<FocusEventItem, "id">): FocusEventItem {
  const item: FocusEventItem = {
    ...event,
    id: "fe_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
  };
  FOCUS_EVENTS_LIST.unshift(item);
  if (FOCUS_EVENTS_LIST.length > 100) {
    FOCUS_EVENTS_LIST.splice(100, FOCUS_EVENTS_LIST.length - 100);
  }
  syncToDisk();
  return item;
}

export function recordAudit(entry: Omit<AuditItem, "id">): AuditItem {
  const item: AuditItem = {
    ...entry,
    id: "aud_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
  };
  AUDIT_LOGS.unshift(item);
  if (AUDIT_LOGS.length > 100) {
    AUDIT_LOGS.splice(100, AUDIT_LOGS.length - 100);
  }
  syncToDisk();
  return item;
}

export function syncToDisk() {
  try {
    const data = {
      session: SESSION_STATE,
      courses: COURSES,
      sessions_list: SESSIONS_LIST,
      resources_list: RESOURCES_LIST,
      students: Array.from(STUDENTS_MAP.entries()),
      audit_logs: AUDIT_LOGS.slice(0, 50),
      focus_events: FOCUS_EVENTS_LIST.slice(0, 50),
      privacy_requests: PRIVACY_REQUESTS_LIST,
      focus_alerts: FOCUS_ALERTS.slice(-20),
      savedAt: Date.now(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data), "utf8");
  } catch {}
}

export function syncFromDisk() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.session) {
        Object.assign(SESSION_STATE, parsed.session);
      }
      if (Array.isArray(parsed.courses) && parsed.courses.length > 0) {
        COURSES.length = 0;
        COURSES.push(...parsed.courses);
      }
      if (Array.isArray(parsed.sessions_list) && parsed.sessions_list.length > 0) {
        SESSIONS_LIST.length = 0;
        SESSIONS_LIST.push(...parsed.sessions_list);
        const active = SESSIONS_LIST.find((s) => s.state === "active" || s.state === "checkin_pending");
        if (active) {
          SESSION_STATE.is_active = true;
          SESSION_STATE.session_id = active.id;
        }
      }
      if (Array.isArray(parsed.resources_list)) {
        RESOURCES_LIST.length = 0;
        RESOURCES_LIST.push(...parsed.resources_list);
      }
      if (Array.isArray(parsed.students)) {
        for (const [id, rec] of parsed.students) {
          STUDENTS_MAP.set(id, rec);
        }
      }
      if (Array.isArray(parsed.audit_logs)) {
        AUDIT_LOGS.length = 0;
        AUDIT_LOGS.push(...parsed.audit_logs);
      }
      if (Array.isArray(parsed.focus_events)) {
        FOCUS_EVENTS_LIST.length = 0;
        FOCUS_EVENTS_LIST.push(...parsed.focus_events);
      }
      if (Array.isArray(parsed.privacy_requests)) {
        PRIVACY_REQUESTS_LIST.length = 0;
        PRIVACY_REQUESTS_LIST.push(...parsed.privacy_requests);
      }
      if (Array.isArray(parsed.focus_alerts)) {
        const existingIds = new Set(FOCUS_ALERTS.map((a) => a.id));
        for (const fa of parsed.focus_alerts) {
          if (!existingIds.has(fa.id)) {
            FOCUS_ALERTS.push(fa);
            existingIds.add(fa.id);
          }
        }
        if (FOCUS_ALERTS.length > 50) {
          FOCUS_ALERTS.splice(0, FOCUS_ALERTS.length - 50);
        }
      }
    }
  } catch {}
}

export function resetRoster() {
  STUDENTS_MAP.clear();
  for (const s of MOCK_ENROLLED_STUDENTS) {
    STUDENTS_MAP.set(s.student_id, { ...s });
  }
  AUDIT_LOGS.length = 0;
  FOCUS_ALERTS.length = 0;
  syncToDisk();
}

export function safeResetRoster() {
  const anyCheckedIn = Array.from(STUDENTS_MAP.values()).some(
    (s) => s.attendance_status !== "ABSENT"
  );
  if (!anyCheckedIn) {
    resetRoster();
  }
}

export function computeMetrics() {
  syncFromDisk();
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
