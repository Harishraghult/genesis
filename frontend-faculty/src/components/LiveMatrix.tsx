"use client";

import React from "react";
import { UserCheck, ShieldAlert, Monitor, Sparkles, ShieldCheck, Lock } from "lucide-react";

export interface StudentRosterItem {
  student_id: string;
  student_name: string;
  seat: string;
  joined_at: number;
  last_seen: number;
  attendance_status: string; // "VERIFIED_PRESENT" or "NETWORK_VERIFICATION_NEEDED"
  quiz_submitted?: boolean;
  anomaly_flag?: string;
}

interface LiveMatrixProps {
  students: StudentRosterItem[];
  auditId?: string;
  onCloseRoster?: () => void;
  onOverrideStudent?: (studentId: string) => void;
}

export default function LiveMatrix({ students, auditId, onCloseRoster, onOverrideStudent }: LiveMatrixProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col h-full">
      {/* Header with FERPA & Audit Log Warning */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Monitor className="w-5 h-5 text-cyan-400" />
              Instructor Student Roster (Authenticated View)
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            FERPA Protected: Access logged under audit record <span className="font-mono text-cyan-400">{auditId || "active"}</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-950/80 border border-emerald-800 rounded-full text-xs font-mono text-emerald-400 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Audit Trail Active</span>
          </div>
          {onCloseRoster && (
            <button
              onClick={onCloseRoster}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
            >
              Back to Projector Mode
            </button>
          )}
        </div>
      </div>

      {/* Note: Per-student distraction labels are hidden to protect students */}
      <div className="mb-4 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
        <span>Attendance records display verified check-in presence. Flags are advisory only and never affect grades automatically.</span>
        <span className="text-[11px] font-mono text-emerald-400 font-medium">FERPA Compliant</span>
      </div>

      {students.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-xl p-8 text-center text-slate-500">
          <Sparkles className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-sm font-medium">Waiting for classroom participants...</p>
          <p className="text-xs text-slate-600 mt-1">Students checking in will appear on the instructor roster.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 overflow-y-auto max-h-[540px] pr-1">
          {students.map((student) => {
            const isVerificationNeeded =
              student.attendance_status === "NETWORK_VERIFICATION_NEEDED" ||
              student.attendance_status === "PROXY_FLAGGED";

            return (
              <div
                key={student.student_id}
                className={`relative rounded-xl p-4 border transition-all duration-300 shadow-md ${
                  isVerificationNeeded
                    ? "bg-amber-950/20 border-amber-600/60 hover:border-amber-500"
                    : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                }`}
              >
                {/* Header row: Name & Attendance Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-100 text-sm leading-tight">
                      {student.student_name}
                    </h3>
                    <span className="text-xs font-mono text-slate-400 block mt-0.5">
                      {student.student_id} · <span className="text-slate-300">{student.seat}</span>
                    </span>
                  </div>

                  {/* Attendance Presence Badge */}
                  {isVerificationNeeded ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-950/90 border border-amber-700/80 px-2 py-0.5 rounded-md">
                      <ShieldAlert className="w-3 h-3 text-amber-400" /> Verification Needed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded-md">
                      <UserCheck className="w-3 h-3" /> Attending
                    </span>
                  )}
                </div>

                {/* Subnet / Timestamp metadata */}
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[11px] text-slate-400 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span>Joined:</span>
                    <span className="font-mono text-slate-300">
                      {new Date(student.joined_at * 1000).toLocaleTimeString()}
                    </span>
                  </div>

                  {isVerificationNeeded && student.anomaly_flag && (
                    <div className="mt-1 text-[10px] text-amber-300 bg-amber-950/70 px-2 py-1 rounded border border-amber-800/70 font-mono">
                      {student.anomaly_flag}
                    </div>
                  )}

                  {isVerificationNeeded && (
                    <div className="mt-1 text-[10px] text-slate-400 italic">
                      Advisory only — automated network verification does not affect grades.
                    </div>
                  )}

                  {/* Instructor Override Button */}
                  {isVerificationNeeded && onOverrideStudent && (
                    <button
                      onClick={() => onOverrideStudent(student.student_id)}
                      className="mt-2 w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Override & Verify Attendance
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
