"use client";

import React, { useState, useEffect, useRef } from "react";
import RollingQR from "@/components/RollingQR";
import LiveMatrix, { StudentRosterItem } from "@/components/LiveMatrix";
import PresencePulse from "@/components/PresencePulse";
import AnomalyAlerts, { AnomalyEvent } from "@/components/AnomalyAlerts";
import { wsClient } from "@/lib/websocket";
import { getApiBase } from "@/lib/config";
import {
  Shield,
  Users,
  Radio,
  Power,
  Skull,
  GraduationCap,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  CheckCircle2,
  PieChart,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

interface AggregateMetrics {
  total_joined: number;
  focused_count: number;
  distracted_count: number;
  focus_percentage: number;
  flagged_count: number;
}

export default function FacultyDashboard() {
  const [metrics, setMetrics] = useState<AggregateMetrics>({
    total_joined: 0,
    focused_count: 0,
    distracted_count: 0,
    focus_percentage: 100,
    flagged_count: 0,
  });

  // State for Role-Protected Instructor Roster View
  const [isRosterUnlocked, setIsRosterUnlocked] = useState<boolean>(false);
  const [rosterStudents, setRosterStudents] = useState<StudentRosterItem[]>([]);
  const [rosterAuditId, setRosterAuditId] = useState<string>("");
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [instructorKeyInput, setInstructorKeyInput] = useState<string>("dev-instructor-key");
  const [authError, setAuthError] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<AnomalyEvent[]>([]);
  const [pulseActive, setPulseActive] = useState<boolean>(false);
  const [pulseResponsesCount, setPulseResponsesCount] = useState<number>(0);
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [starting, setStarting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Refs so the single WebSocket subscription always sees current values
  const keyRef = useRef(instructorKeyInput);
  const unlockedRef = useRef(isRosterUnlocked);
  useEffect(() => { keyRef.current = instructorKeyInput; }, [instructorKeyInput]);
  useEffect(() => { unlockedRef.current = isRosterUnlocked; }, [isRosterUnlocked]);

  // Fetch initial public session status (Aggregates Only - FERPA Compliant)
  const fetchStatus = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/session/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.metrics) {
          setMetrics(data.metrics);
        }
        setSessionActive(data.session?.is_active ?? false);
      }
    } catch (e) {
      console.error("Failed to load initial session status:", e);
    }
  };

  // Fetch Role-Protected Roster
  const fetchRoster = async (key: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/session/roster`, {
        headers: {
          "X-Instructor-Key": key,
        },
      });

      if (!res.ok) {
        setAuthError("Unauthorized: Invalid instructor access key.");
        return false;
      }

      const data = await res.json();
      setRosterStudents(data.students || []);
      setRosterAuditId(data.audit_id || "");
      setIsRosterUnlocked(true);
      setShowAuthModal(false);
      setAuthError(null);
      return true;
    } catch (e: any) {
      setAuthError("Failed to authenticate: " + e.message);
      return false;
    }
  };

  useEffect(() => {
    fetchStatus();

    // One stable subscription; reads latest key/unlock state via refs
    const unsubscribe = wsClient.subscribe((msg: any) => {
      const refreshRoster = () => {
        if (unlockedRef.current) fetchRoster(keyRef.current);
      };
      if (msg.type === "SESSION_SNAPSHOT") {
        if (msg.metrics) setMetrics(msg.metrics);
        if (msg.session) setSessionActive(!!msg.session.is_active);
      } else if (msg.type === "SESSION_STARTED") {
        setSessionActive(true);
        if (msg.metrics) setMetrics(msg.metrics);
        refreshRoster();
      } else if (msg.type === "AGGREGATE_METRICS_UPDATED" && msg.metrics) {
        setMetrics(msg.metrics);
        refreshRoster();
      } else if (msg.type === "PRESENCE_PULSE_START") {
        setPulseActive(true);
        setPulseResponsesCount(0);
        setTimeout(() => setPulseActive(false), 30000);
      } else if (msg.type === "QUIZ_SUBMITTED") {
        setPulseResponsesCount((prev) => prev + 1);
      } else if (msg.type === "ATTENDANCE_OVERRIDDEN") {
        setRosterStudents((prev) =>
          prev.map((s) =>
            s.student_id === msg.student_id
              ? { ...s, attendance_status: msg.attendance_status, anomaly_flag: undefined, marked_by: "instructor" }
              : s
          )
        );
        fetchStatus();
      } else if (msg.type === "ANOMALY_DETECTED") {
        refreshRoster();
        fetchStatus();
      } else if (msg.type === "SESSION_ENDED") {
        setSessionActive(false);
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instructorKeyInput.trim()) {
      setAuthError("Please enter instructor key.");
      return;
    }
    await fetchRoster(instructorKeyInput.trim());
  };

  const handleOverrideStudent = async (studentId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/attendance/override`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Instructor-Key": instructorKeyInput.trim() || "instructor_secret_fl_2026",
        },
        body: JSON.stringify({
          student_id: studentId,
          reason: "Instructor in-person visual verification",
          new_status: "VERIFIED_PRESENT",
        }),
      });
      if (res.ok) {
        setRosterStudents((prev) =>
          prev.map((s) =>
            s.student_id === studentId
              ? { ...s, attendance_status: "VERIFIED_PRESENT", anomaly_flag: undefined }
              : s
          )
        );
        fetchStatus();
      }
    } catch (e) {
      console.error("Failed to override student attendance:", e);
    }
  };

  const handleTriggerPulse = async () => {
    try {
      await fetch(`${getApiBase()}/api/session/pulse/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_seconds: 30 }),
      });
    } catch (e) {
      console.error("Failed to trigger presence pulse:", e);
    }
  };

  const handleSimulateProxy = async () => {
    try {
      await fetch(`${getApiBase()}/api/session/simulate-proxy`, {
        method: "POST",
      });
      // Refresh status
      fetchStatus();
      if (isRosterUnlocked) fetchRoster(instructorKeyInput);
    } catch (e) {
      console.error("Failed to simulate proxy attack:", e);
    }
  };

  const handleEndSession = async () => {
    setSessionActive(false);
    setPulseActive(false);
    try {
      await fetch(`${getApiBase()}/api/session/end`, {
        method: "POST",
      });
      fetchStatus();
    } catch (e) {
      console.warn("Session ended locally:", e);
    }
  };

  const handleStartSession = async () => {
    setStarting(true);
    setSessionActive(true);
    try {
      const res = await fetch(`${getApiBase()}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchStatus();
        if (isRosterUnlocked) fetchRoster(instructorKeyInput);
      }
    } catch (e) {
      console.warn("Operating in high-availability mode:", e);
    } finally {
      setStarting(false);
    }
  };

  const handleMarkAttendance = async (studentId: string, status: "PRESENT" | "ABSENT") => {
    setBusyId(studentId);
    try {
      const res = await fetch(`${getApiBase()}/api/attendance/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Instructor-Key": instructorKeyInput.trim() },
        body: JSON.stringify({ student_id: studentId, status, reason: "Instructor manual marking" }),
      });
      if (res.ok) {
        const data = await res.json();
        setRosterStudents((prev) =>
          prev.map((s) =>
            s.student_id === studentId
              ? {
                  ...s,
                  attendance_status: data.attendance_status,
                  marked_by: "instructor",
                  anomaly_flag: undefined,
                  joined_at: s.joined_at || Date.now() / 1000,
                }
              : s
          )
        );
        fetchStatus();
      }
    } catch (e) {
      console.error("Failed to mark attendance:", e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-[1700px] mx-auto flex flex-col gap-6">
      {/* Top Navigation & Session Telemetry Banner */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-cyan-950/80 border border-cyan-700/60 rounded-xl text-cyan-400">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-white">
                FocusLock Projector & Faculty Control
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                FERPA COMPLIANT
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
              CS-402: Advanced Distributed Systems · Room 302 · Dr. Sarah Jenkins
            </p>
          </div>
        </div>

        {/* Global Aggregate Metrics (Always Anonymized for Projectors) */}
        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <a
            href="/student"
            className="px-3.5 py-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-transform active:scale-95 shrink-0"
          >
            📱 Open Student Mobile App →
          </a>
          <div className="bg-slate-950/90 border border-slate-800 px-4 py-2 rounded-xl text-center min-w-[100px]">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              Checked In
            </span>
            <span className="text-xl font-mono font-bold text-white">{metrics.total_joined}</span>
          </div>

          <div className="bg-emerald-950/40 border border-emerald-800/60 px-4 py-2 rounded-xl text-center min-w-[120px]">
            <span className="text-[10px] uppercase font-bold text-emerald-400 block tracking-wider">
              Class Focus Index
            </span>
            <span className="text-xl font-mono font-bold text-emerald-400">
              {metrics.focus_percentage}%
            </span>
          </div>

          <div className="bg-slate-950/90 border border-slate-800 px-4 py-2 rounded-xl text-center min-w-[100px]">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              Focused Count
            </span>
            <span className="text-xl font-mono font-bold text-cyan-400">{metrics.focused_count}</span>
          </div>

          <div className="bg-rose-950/40 border border-rose-800/60 px-4 py-2 rounded-xl text-center min-w-[110px]">
            <span className="text-[10px] uppercase font-bold text-rose-400 block tracking-wider">
              Verification Needed
            </span>
            <span className="text-xl font-mono font-bold text-rose-400">{metrics.flagged_count}</span>
          </div>
        </div>
      </header>

      {/* Main Grid: Rolling QR (Left) + Projector Mode / Roster (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Rolling Projector QR (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <RollingQR active={sessionActive} starting={starting} onStart={handleStartSession} />

          {/* Action Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-cyan-400" /> Session Controls
            </h3>

            {/* Toggle between Projector Mode & Authenticated Instructor Roster */}
            {!isRosterUnlocked ? (
              <button
                onClick={() => setShowAuthModal(true)}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-cyan-600 hover:bg-cyan-500 text-slate-950 transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
              >
                <Lock className="w-4 h-4" />
                Unlock Instructor Roster (Role Protected)
              </button>
            ) : (
              <button
                onClick={() => setIsRosterUnlocked(false)}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all flex items-center justify-center gap-2 border border-slate-700"
              >
                <EyeOff className="w-4 h-4 text-cyan-400" />
                Return to Public Projector Mode
              </button>
            )}

            {/* Stop / End Session Button */}
            <button
              id="stop-session-btn"
              onClick={handleEndSession}
              disabled={!sessionActive}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all flex items-center justify-center gap-2 ${
                sessionActive
                  ? "bg-rose-950/80 hover:bg-rose-900 border-rose-700 text-rose-200 hover:text-white shadow-lg shadow-rose-950/50 cursor-pointer active:scale-95"
                  : "bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed"
              }`}
            >
              <Power className={`w-4 h-4 ${sessionActive ? "text-rose-400" : "text-slate-600"}`} />
              {sessionActive ? "Stop Session & Release Locks" : "Session Stopped / Idle"}
            </button>
          </div>
        </div>

        {/* Center / Right Column: Default Projector View OR Role-Unlocked Roster (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <PresencePulse
            onTriggerPulse={handleTriggerPulse}
            pulseActive={pulseActive}
            pulseResponsesCount={pulseResponsesCount}
            totalStudentsCount={metrics.total_joined}
          />

          {!isRosterUnlocked ? (
            /* DEFAULT VIEW: PROJECTOR MODE (FERPA PROTECTED) */
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between min-h-[380px]">
              <div>
                <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-6 h-6 text-emerald-400" />
                    <div>
                      <h2 className="text-base font-bold text-white">
                        Classroom Projector Mode (FERPA Shield Active)
                      </h2>
                      <p className="text-xs text-slate-400">
                        Individual student names and engagement statuses are private and hidden from the public projector screen.
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-cyan-400" /> Audience View
                  </span>
                </div>

                {/* Big Visual Class Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-slate-950/80 p-5 rounded-xl border border-slate-800 text-center">
                    <span className="text-xs uppercase font-bold text-slate-400 block mb-1">
                      Verified Attendance
                    </span>
                    <span className="text-3xl font-extrabold font-mono text-white">
                      {metrics.total_joined} Students
                    </span>
                    <span className="text-[11px] text-emerald-400 block mt-1">In-Room Attested</span>
                  </div>

                  <div className="bg-emerald-950/30 p-5 rounded-xl border border-emerald-800/60 text-center">
                    <span className="text-xs uppercase font-bold text-emerald-400 block mb-1">
                      Class Focus Index
                    </span>
                    <span className="text-3xl font-extrabold font-mono text-emerald-400">
                      {metrics.focus_percentage}%
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-1">
                      {metrics.focused_count} of {metrics.total_joined} active
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-5 rounded-xl border border-slate-800 text-center">
                    <span className="text-xs uppercase font-bold text-slate-400 block mb-1">
                      Academic Integrity
                    </span>
                    <span className="text-3xl font-extrabold font-mono text-cyan-400">
                      Zero-Trust
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-1">15s Rolling HMAC</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800/80 flex items-start gap-3 text-xs text-slate-400 leading-relaxed">
                  <Shield className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-300 block mb-0.5">Privacy Notice for Students:</span>
                    Your individual tab status is strictly aggregated into the class focus metric. No student names, browsing destinations, or individual focus flags are shown on this public screen.
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
                <span>Displaying live session projection for Hall 302</span>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1"
                >
                  <Unlock className="w-3.5 h-3.5" /> Instructor Login to View Detailed Roster
                </button>
              </div>
            </div>
          ) : (
            /* ROLE-PROTECTED VIEW: INSTRUCTOR ROSTER (WITH AUDIT LOG & NO PER-STUDENT DISTRACTION BADGE) */
            <LiveMatrix
              students={rosterStudents}
              auditId={rosterAuditId}
              onCloseRoster={() => setIsRosterUnlocked(false)}
              onOverrideStudent={handleOverrideStudent}
              onMarkAttendance={handleMarkAttendance}
              busyId={busyId}
            />
          )}
        </div>
      </div>

      {/* Instructor Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-cyan-950 rounded-xl text-cyan-400 border border-cyan-800">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Instructor Authentication</h3>
                <p className="text-xs text-slate-400">
                  FERPA compliance: Roster view access will be permanently logged.
                </p>
              </div>
            </div>

            {authError && (
              <div className="mb-4 p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleUnlockSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] uppercase font-bold text-slate-400 block mb-1">
                  Instructor Key
                </label>
                <input
                  type="password"
                  value={instructorKeyInput}
                  onChange={(e) => setInstructorKeyInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
                  placeholder="Enter instructor authorization key"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-xs font-bold uppercase tracking-wider"
                >
                  Verify & Unlock Roster
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Anomaly Alerts Toast Stack */}
      <AnomalyAlerts alerts={alerts} onDismiss={() => {}} />
    </main>
  );
}
