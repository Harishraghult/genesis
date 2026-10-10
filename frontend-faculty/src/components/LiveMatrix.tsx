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
        filter === f ? cls : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
      }`}
    >
      {label} <span className="font-mono ml-1">{n}</span>
    </button>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col h-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Monitor className="w-5 h-5 text-cyan-400" />
            Classroom Attendance Log
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time verification log synced with enrolled mock roster.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
          >
            Download CSV
          </button>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-950/80 border border-emerald-800 rounded-full text-xs font-mono text-emerald-400 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            {counts.present}/{counts.total} present
          </div>
          {onCloseRoster && (
            <button
              onClick={onCloseRoster}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
            >
              Back to Projector
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {chip("ALL", "All", counts.total, "bg-slate-800 border-slate-600 text-white")}
          {chip("PRESENT", "Present", counts.present, "bg-emerald-950 border-emerald-700 text-emerald-300")}
          {chip("LEFT_MIDDLE", "Left in Middle", counts.leftMiddle, "bg-amber-950 border-amber-600 text-amber-300")}
          {chip("ABSENT", "Absent", counts.absent, "bg-rose-950 border-rose-700 text-rose-300")}
        </div>
        <div className="relative sm:ml-auto">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            id="roster-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or ID"
            className="pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500 w-full sm:w-56"
          />
        </div>
      </div>

      <p className="mb-3 text-[11px] text-slate-500">
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
              className={`rounded-xl p-4 border transition-all duration-300 ${
                isLeftMiddle
                  ? "bg-amber-950/30 border-amber-500/70 shadow-amber-950/40"
                  : isFlagged
                  ? "bg-amber-950/20 border-amber-600/60"
                  : isAbsent
                  ? "bg-slate-950/50 border-slate-800 opacity-80"
                  : "bg-emerald-950/10 border-emerald-800/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-100 text-sm leading-tight truncate">{student.student_name}</h3>
                  <span className="text-xs font-mono text-slate-400 block mt-0.5">
                    {student.student_id} · <span className="text-slate-300">{student.seat}</span>
                  </span>
                </div>
                {isLeftMiddle ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-950/90 border border-amber-600 px-2 py-0.5 rounded-md animate-pulse">
                    <ShieldAlert className="w-3 h-3" /> Left Middle ({student.leave_count || 1}×)
                  </span>
                ) : isFlagged ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-950/90 border border-amber-700/80 px-2 py-0.5 rounded-md">
                    <ShieldAlert className="w-3 h-3" /> Verify
                  </span>
                ) : isAbsent ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 bg-rose-950/80 border border-rose-800 px-2 py-0.5 rounded-md">
                    <UserX className="w-3 h-3" /> Absent
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded-md">
                    {student.marked_by === "instructor" ? <Hand className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                    Present
                  </span>
                )}
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span>{student.marked_by === "instructor" ? "Marked by you" : "Checked in:"}</span>
                  <span className="font-mono text-slate-300">
                    {student.joined_at ? new Date(student.joined_at * 1000).toLocaleTimeString() : "—"}
                  </span>
                </div>

                {isFlagged && student.anomaly_flag && (
                  <div className="text-[10px] text-amber-300 bg-amber-950/70 px-2 py-1 rounded border border-amber-800/70 font-mono">
                    {student.anomaly_flag}
                  </div>
                )}

                <div className="flex gap-2 mt-1">
                  {isFlagged && onOverrideStudent && (
                    <button
                      disabled={busy}
                      onClick={() => onOverrideStudent(student.student_id)}
                      className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Verify
                    </button>
                  )}
                  {!isPresent && !isFlagged && onMarkAttendance && (
                    <button
                      id={`mark-present-${student.student_id}`}
                      disabled={busy}
                      onClick={() => onMarkAttendance(student.student_id, "PRESENT")}
                      className="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Mark Present
                    </button>
                  )}
                  {!isAbsent && onMarkAttendance && (
                    <button
                      id={`mark-absent-${student.student_id}`}
                      disabled={busy}
                      onClick={() => onMarkAttendance(student.student_id, "ABSENT")}
                      className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-rose-900 border border-slate-700 hover:border-rose-700 text-slate-300 text-xs font-semibold rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
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
          <div className="col-span-full text-center text-xs text-slate-500 py-10 border-2 border-dashed border-slate-800 rounded-xl">
            No students match this filter.
          </div>
        )}
      </div>
    </div>
  );
}
