"use client";

import React, { useMemo, useState } from "react";
import { UserCheck, UserX, ShieldAlert, Monitor, ShieldCheck, Search, Hand } from "lucide-react";

export interface StudentRosterItem {
  student_id: string;
  student_name: string;
  seat: string;
  joined_at: number;
  last_seen: number;
  attendance_status: string; // "VERIFIED_PRESENT" | "LEFT_MIDDLE" | "NETWORK_VERIFICATION_NEEDED" | "ABSENT"
  marked_by?: string; // "qr" | "instructor"
  leave_count?: number;
  quiz_submitted?: boolean;
  anomaly_flag?: string;
}

interface LiveMatrixProps {
  students: StudentRosterItem[];
  auditId?: string;
  onCloseRoster?: () => void;
  onOverrideStudent?: (studentId: string) => void;
  onMarkAttendance?: (studentId: string, status: "PRESENT" | "ABSENT") => void;
  busyId?: string | null;
}

type Filter = "ALL" | "PRESENT" | "LEFT_MIDDLE" | "ABSENT" | "FLAGGED";

export default function LiveMatrix({
  students,
  auditId,
  onCloseRoster,
  onOverrideStudent,
  onMarkAttendance,
  busyId,
}: LiveMatrixProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const present = students.filter((s) => s.attendance_status === "VERIFIED_PRESENT").length;
    const leftMiddle = students.filter((s) => s.attendance_status === "LEFT_MIDDLE").length;
    const flagged = students.filter((s) => s.attendance_status === "NETWORK_VERIFICATION_NEEDED").length;
    const absent = students.filter((s) => s.attendance_status === "ABSENT").length;
    return { present, leftMiddle, flagged, absent, total: students.length };
  }, [students]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...students]
      .filter((s) => {
        if (filter === "PRESENT") return s.attendance_status === "VERIFIED_PRESENT";
        if (filter === "LEFT_MIDDLE") return s.attendance_status === "LEFT_MIDDLE";
        if (filter === "ABSENT") return s.attendance_status === "ABSENT";
        if (filter === "FLAGGED") return s.attendance_status === "NETWORK_VERIFICATION_NEEDED";
        return true;
      })
      .filter((s) => !q || s.student_name.toLowerCase().includes(q) || s.student_id.toLowerCase().includes(q))
      .sort((a, b) => a.student_id.localeCompare(b.student_id));
  }, [students, filter, query]);

  const handleExportCSV = () => {
    const headers = ["Student ID", "Full Name", "Seat", "Attendance Status", "Violations / Leaves", "Joined At", "Marked By"];
    const rows = students.map((s) => [
      s.student_id,
      `"${s.student_name}"`,
      `"${s.seat}"`,
      s.attendance_status === "VERIFIED_PRESENT" ? "PRESENT" : s.attendance_status === "LEFT_MIDDLE" ? "LEFT IN MIDDLE" : s.attendance_status,
      s.leave_count || 0,
      s.joined_at ? new Date(s.joined_at * 1000).toLocaleTimeString() : "—",
      s.marked_by || "system",
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `attendance_log_CS402_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const chip = (f: Filter, label: string, n: number, cls: string) => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
        filter === f ? cls : "bg-[#FAF9F5] border-[#E5E3DC] text-[#64748B] hover:text-[#1E293B]"
      }`}
    >
      {label} <span className="font-mono ml-1">{n}</span>
    </button>
  );

  return (
    <div className="bg-white border border-[#E5E3DC] rounded-2xl p-6 shadow-sm flex flex-col h-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-[#F1F0EA]">
        <div>
          <h2 className="text-lg font-bold text-[#1E293B] flex items-center gap-2">
            <Monitor className="w-5 h-5 text-[#2E6B38]" />
            Classroom Attendance Log
          </h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Real-time verification log synced with enrolled mock roster.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-[#EEF8EE] hover:bg-[#E3F2E3] border border-[#C8E6C9] text-[#1B4D2E] rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 shadow-sm"
          >
            Download CSV
          </button>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#EEF8EE] border border-[#C8E6C9] rounded-full text-xs font-mono text-[#1B4D2E] font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            {counts.present}/{counts.total} present
          </div>
          {onCloseRoster && (
            <button
              onClick={onCloseRoster}
              className="px-3 py-1.5 bg-[#F1F0EA] hover:bg-[#E5E3DC] text-[#1E293B] rounded-lg text-xs font-semibold transition-colors"
            >
              Back to Projector
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {chip("ALL", "All", counts.total, "bg-[#E5E3DC] border-[#D5D2C8] text-[#1E293B]")}
          {chip("PRESENT", "Present", counts.present, "bg-[#EEF8EE] border-[#C8E6C9] text-[#1B4D2E]")}
          {chip("LEFT_MIDDLE", "Left in Middle", counts.leftMiddle, "bg-[#FEF3C7] border-[#FCD34D] text-[#92400E]")}
          {chip("ABSENT", "Absent", counts.absent, "bg-[#FEE2E2] border-[#FCA5A5] text-[#991B1B]")}
        </div>
        <div className="relative sm:ml-auto">
          <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-2.5" />
          <input
            id="roster-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or ID"
            className="pl-8 pr-3 py-2 bg-[#FAF9F5] border border-[#E5E3DC] rounded-lg text-xs text-[#1E293B] focus:outline-none focus:border-[#2E6B38] w-full sm:w-56"
          />
        </div>
      </div>

      <p className="mb-3 text-[11px] text-[#64748B]">
        Categorized attendance data: shows who is currently present, who left the lecture in the middle (tab switched), and who never checked in from the mock roster.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 overflow-y-auto max-h-[560px] pr-1">
        {visible.map((student) => {
          const status = student.attendance_status;
          const isFlagged = status === "NETWORK_VERIFICATION_NEEDED" || status === "PROXY_FLAGGED";
          const isLeftMiddle = status === "LEFT_MIDDLE";
          const isAbsent = status === "ABSENT";
          const isPresent = status === "VERIFIED_PRESENT";
          const busy = busyId === student.student_id;

          return (
            <div
              key={student.student_id}
              className={`rounded-xl p-4 border transition-all duration-300 shadow-sm ${
                isLeftMiddle
                  ? "bg-[#FFFBEB] border-[#FCD34D]"
                  : isFlagged
                  ? "bg-[#FFFBEB] border-[#FCD34D]"
                  : isAbsent
                  ? "bg-[#FAF9F5] border-[#E5E3DC] opacity-75"
                  : "bg-[#F6FAF6] border-[#C8E6C9]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[#1E293B] text-sm leading-tight truncate">{student.student_name}</h3>
                  <span className="text-xs font-mono text-[#64748B] block mt-0.5">
                    {student.student_id} · <span className="text-[#475569]">{student.seat}</span>
                  </span>
                </div>
                {isLeftMiddle ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FCD34D] px-2 py-0.5 rounded-md animate-pulse">
                    <ShieldAlert className="w-3 h-3" /> Left Middle ({student.leave_count || 1}×)
                  </span>
                ) : isFlagged ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FCD34D] px-2 py-0.5 rounded-md">
                    <ShieldAlert className="w-3 h-3" /> Verify
                  </span>
                ) : isAbsent ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#991B1B] bg-[#FEE2E2] border border-[#FCA5A5] px-2 py-0.5 rounded-md">
                    <UserX className="w-3 h-3" /> Absent
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B4D2E] bg-[#EEF8EE] border border-[#C8E6C9] px-2 py-0.5 rounded-md">
                    {student.marked_by === "instructor" ? <Hand className="w-3 h-3" /> : <UserCheck className="w-3 h-3 text-[#2E6B38]" />}
                    Present
                  </span>
                )}
              </div>

              <div className="mt-3 pt-2.5 border-t border-[#E5E3DC] text-[11px] text-[#64748B] flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span>{student.marked_by === "instructor" ? "Marked by you" : "Checked in:"}</span>
                  <span className="font-mono text-[#1E293B]">
                    {student.joined_at ? new Date(student.joined_at * 1000).toLocaleTimeString() : "—"}
                  </span>
                </div>

                {isFlagged && student.anomaly_flag && (
                  <div className="text-[10px] text-[#92400E] bg-[#FEF3C7] px-2 py-1 rounded border border-[#FCD34D] font-mono">
                    {student.anomaly_flag}
                  </div>
                )}

                <div className="flex gap-2 mt-1">
                  {isFlagged && onOverrideStudent && (
                    <button
                      disabled={busy}
                      onClick={() => onOverrideStudent(student.student_id)}
                      className="flex-1 py-1.5 px-2 bg-[#2E6B38] hover:bg-[#25572D] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Verify
                    </button>
                  )}
                  {!isPresent && !isFlagged && onMarkAttendance && (
                    <button
                      id={`mark-present-${student.student_id}`}
                      disabled={busy}
                      onClick={() => onMarkAttendance(student.student_id, "PRESENT")}
                      className="flex-1 py-1.5 px-2 bg-[#2E6B38] hover:bg-[#25572D] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Mark Present
                    </button>
                  )}
                  {!isAbsent && onMarkAttendance && (
                    <button
                      id={`mark-absent-${student.student_id}`}
                      disabled={busy}
                      onClick={() => onMarkAttendance(student.student_id, "ABSENT")}
                      className="flex-1 py-1.5 px-2 bg-[#F1F0EA] hover:bg-[#FEE2E2] hover:text-[#991B1B] border border-[#E5E3DC] hover:border-[#FCA5A5] text-[#64748B] text-xs font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                    >
                      <UserX className="w-3.5 h-3.5" /> Mark Absent
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="col-span-full text-center text-xs text-[#64748B] py-10 border-2 border-dashed border-[#E5E3DC] rounded-xl bg-[#FAF9F5]">
            No students match this filter.
          </div>
        )}
      </div>
    </div>
  );
}
