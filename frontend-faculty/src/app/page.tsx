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
  Loader2,
  Play,
  Volume2,
  VolumeX,
  Smartphone,
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
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Refs so the single WebSocket subscription & poll always see current values
  const keyRef = useRef(instructorKeyInput);
  const unlockedRef = useRef(isRosterUnlocked);
  const soundEnabledRef = useRef(soundEnabled);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { keyRef.current = instructorKeyInput; }, [instructorKeyInput]);
  useEffect(() => { unlockedRef.current = isRosterUnlocked; }, [isRosterUnlocked]);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  // Dual-tone high-contrast alert chime synthesized through Web Audio API
  const playFacultyAlertChime = () => {
    try {
      if (typeof window === "undefined" || !soundEnabledRef.current) return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      // High urgency 2-tone alarm chime: 880Hz -> 659Hz -> 880Hz
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.24);

      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.42);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.42);
    } catch {}
  };

  const handleDismissAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  // Fetch initial public session status & real-time focus violation alerts
  const fetchStatus = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/session/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.metrics) {
          setMetrics(data.metrics);
        }
        setSessionActive(data.session?.is_active ?? false);

        // Process real-time student app-switch / focus violation alerts
        if (Array.isArray(data.recent_focus_alerts)) {
          let hasNewViolation = false;
          for (const fa of data.recent_focus_alerts) {
            if (!seenAlertIdsRef.current.has(fa.id)) {
              seenAlertIdsRef.current.add(fa.id);
              hasNewViolation = true;
              const newAlert: AnomalyEvent = {
                id: fa.id,
                student_id: fa.student_id,
                student_name: fa.student_name,
                timestamp: fa.timestamp,
                message: fa.detail || "App switch or focus lost violation",
                title: fa.type === "TAMPER_DETECTED"
                  ? "Security Tamper Attempt"
                  : fa.type === "SPLIT_SCREEN"
                  ? "Split-Screen Focus Lost"
                  : "App Switch Violation",
                type: fa.type === "TAMPER_DETECTED" ? "TAMPER_DETECTED" : "APP_SWITCH",
                leave_count: fa.leave_count,
              };
              setAlerts((prev) => [newAlert, ...prev.slice(0, 4)]);
            }
          }
          if (hasNewViolation) {
            playFacultyAlertChime();
            if (unlockedRef.current) {
              fetchRoster(keyRef.current);
            }
          }
        }
      }
    } catch (e) {
      console.error("Failed to load initial session status:", e);
    }
  };

  // Poll session metrics every 4s — primary update mechanism on Vercel (no WebSocket)
  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 4000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh roster every 5s when it is unlocked
  useEffect(() => {
    if (!isRosterUnlocked) return;
    const rosterPoll = setInterval(() => {
      fetchRoster(keyRef.current);
    }, 5000);
    return () => clearInterval(rosterPoll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRosterUnlocked]);

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
    // WebSocket subscription as bonus real-time enhancement (works locally, gracefully fails on Vercel)
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
      localStorage.setItem("fl_session_active", "false");
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("focuslock-session-sync");
        bc.postMessage({ type: "SESSION_ENDED" });
        bc.close();
      }
    } catch {}

    try {
      await fetch(`${getApiBase()}/api/session/end`, {
        method: "POST",
      });
      fetchStatus();
      // Automatically unlock/show the roster so teacher sees the final attendance log
      setIsRosterUnlocked(true);
      fetchRoster(instructorKeyInput);
    } catch (e) {
      console.warn("Session ended locally:", e);
    }
  };

  const handleStartSession = async () => {
    setStarting(true);
    setSessionActive(true);
    try {
      localStorage.setItem("fl_session_active", "true");
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("focuslock-session-sync");
        bc.postMessage({ type: "SESSION_STARTED" });
        bc.close();
      }
    } catch {}
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
    <main className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-[1700px] mx-auto flex flex-col gap-6 bg-[#FAF9F5]">
      {/* Top Navigation & Session Telemetry Banner */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white border border-[#E5E3DC] p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#EEF8EE] border border-[#C8E6C9] rounded-xl text-[#1B4D2E]">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-[#1E293B]">
                FocusLock Projector &amp; Faculty Control
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-[#EEF8EE] text-[#1B4D2E] border border-[#C8E6C9]">
                FERPA COMPLIANT
              </span>
            </div>
            <p className="text-xs text-[#64748B] mt-0.5 flex items-center gap-2">
              <GraduationCap className="w-3.5 h-3.5 text-[#64748B]" />
              CS-402: Advanced Distributed Systems · Room 302 · Dr. Sarah Jenkins
            </p>
          </div>
        </div>

        {/* Global Aggregate Metrics (Always Anonymized for Projectors) */}
        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <a
            href="/student"
            className="px-3.5 py-2 bg-[#2E6B38] hover:bg-[#25572D] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-transform active:scale-95 shrink-0"
          >
            📱 Open Student Mobile App →
          </a>

          {/* Real-time Alert Chime Toggle */}
          <button
            onClick={() => {
              setSoundEnabled((prev) => {
                const nextVal = !prev;
                if (nextVal) {
                  setTimeout(() => playFacultyAlertChime(), 50);
                }
                return nextVal;
              });
            }}
            title={soundEnabled ? "Violations audio alarm is ON (click to mute)" : "Violations audio alarm is MUTED (click to enable)"}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all shrink-0 ${
              soundEnabled
                ? "bg-[#FEF3C7] border-[#FCD34D] text-[#92400E] shadow-sm"
                : "bg-[#F1F0EA] border-[#E5E3DC] text-[#64748B]"
            }`}
          >
            {soundEnabled ? (
              <>
                <Volume2 className="w-4 h-4 text-[#92400E] animate-pulse" />
                <span>Chime ON</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-[#64748B]" />
                <span>Chime OFF</span>
              </>
            )}
          </button>

          <div className="bg-[#FAF9F5] border border-[#E5E3DC] px-4 py-2 rounded-xl text-center min-w-[100px] shadow-sm">
            <span className="text-[10px] uppercase font-bold text-[#64748B] block tracking-wider">
              Checked In
            </span>
            <span className="text-xl font-mono font-bold text-[#1E293B]">{metrics.total_joined}</span>
          </div>

          <div className="bg-[#EEF8EE] border border-[#C8E6C9] px-4 py-2 rounded-xl text-center min-w-[120px] shadow-sm">
            <span className="text-[10px] uppercase font-bold text-[#1B4D2E] block tracking-wider">
              Class Focus Index
            </span>
            <span className="text-xl font-mono font-bold text-[#1B4D2E]">
              {metrics.focus_percentage}%
            </span>
          </div>

          <div className="bg-[#FAF9F5] border border-[#E5E3DC] px-4 py-2 rounded-xl text-center min-w-[100px] shadow-sm">
            <span className="text-[10px] uppercase font-bold text-[#64748B] block tracking-wider">
              Focused Count
            </span>
            <span className="text-xl font-mono font-bold text-[#2E6B38]">{metrics.focused_count}</span>
          </div>

          <div className="bg-[#FFFBEB] border border-[#FCD34D] px-4 py-2 rounded-xl text-center min-w-[110px] shadow-sm">
            <span className="text-[10px] uppercase font-bold text-[#92400E] block tracking-wider">
              Verification Needed
            </span>
            <span className="text-xl font-mono font-bold text-[#92400E]">{metrics.flagged_count}</span>
          </div>
        </div>
      </header>

      {/* Main Grid: Rolling QR (Left) + Projector Mode / Roster (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Rolling Projector QR (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <RollingQR active={sessionActive} starting={starting} onStart={handleStartSession} />

          {/* Action Controls */}
          <div className="bg-white border border-[#E5E3DC] rounded-2xl p-5 shadow-sm flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-[#2E6B38]" /> Session Controls
            </h3>

            {/* Toggle between Projector Mode & Authenticated Instructor Roster */}
            {!isRosterUnlocked ? (
              <button
                onClick={() => setShowAuthModal(true)}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-[#F1F0EA] hover:bg-[#E5E3DC] text-[#1E293B] border border-[#E5E3DC] transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <Lock className="w-4 h-4 text-[#2E6B38]" />
                Unlock Instructor Roster (Role Protected)
              </button>
            ) : (
              <button
                onClick={() => setIsRosterUnlocked(false)}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-[#F1F0EA] hover:bg-[#E5E3DC] text-[#1E293B] transition-all flex items-center justify-center gap-2 border border-[#E5E3DC]"
              >
                <EyeOff className="w-4 h-4 text-[#2E6B38]" />
                Return to Public Projector Mode
              </button>
            )}

            {/* Session Controls: Start or Stop Button */}
            {!sessionActive ? (
              <button
                id="start-session-controls-btn"
                onClick={handleStartSession}
                disabled={starting}
                className="w-full py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-[#2E6B38] hover:bg-[#25572D] text-white transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-900/10 active:scale-95 cursor-pointer disabled:opacity-60"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {starting ? "Starting..." : "Start Session & Show QR"}
              </button>
            ) : (
              <button
                id="stop-session-btn"
                onClick={handleEndSession}
                className="w-full py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-[#FEE2E2] hover:bg-[#FECACA] border border-[#FCA5A5] text-[#991B1B] shadow-sm cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Power className="w-4 h-4 text-[#991B1B]" />
                Stop Session &amp; Release Locks
              </button>
            )}
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
            <div className="bg-white border border-[#E5E3DC] rounded-2xl p-6 shadow-sm flex flex-col justify-between min-h-[380px]">
              <div>
                <div className="flex items-center justify-between pb-4 mb-5 border-b border-[#F1F0EA]">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-6 h-6 text-[#2E6B38]" />
                    <div>
                      <h2 className="text-base font-bold text-[#1E293B]">
                        Classroom Projector Mode (FERPA Shield Active)
                      </h2>
                      <p className="text-xs text-[#64748B]">
                        Individual student names and engagement statuses are private and hidden from the public projector screen.
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-[#FAF9F5] border border-[#E5E3DC] text-[#64748B] flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-[#2E6B38]" /> Audience View
                  </span>
                </div>

                {/* Big Visual Class Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-[#FAF9F5] p-5 rounded-xl border border-[#E5E3DC] text-center">
                    <span className="text-xs uppercase font-bold text-[#64748B] block mb-1">
                      Verified Attendance
                    </span>
                    <span className="text-3xl font-extrabold font-mono text-[#1E293B]">
                      {metrics.total_joined} Students
                    </span>
                    <span className="text-[11px] text-[#2E6B38] font-semibold block mt-1">In-Room Attested</span>
                  </div>

                  <div className="bg-[#EEF8EE] p-5 rounded-xl border border-[#C8E6C9] text-center">
                    <span className="text-xs uppercase font-bold text-[#1B4D2E] block mb-1">
                      Class Focus Index
                    </span>
                    <span className="text-3xl font-extrabold font-mono text-[#1B4D2E]">
                      {metrics.focus_percentage}%
                    </span>
                    <span className="text-[11px] text-[#64748B] block mt-1">
                      {metrics.focused_count} of {metrics.total_joined} active
                    </span>
                  </div>

                  <div className="bg-[#FAF9F5] p-5 rounded-xl border border-[#E5E3DC] text-center">
                    <span className="text-xs uppercase font-bold text-[#64748B] block mb-1">
                      Academic Integrity
                    </span>
                    <span className="text-3xl font-extrabold font-mono text-[#2E6B38]">
                      Zero-Trust
                    </span>
                    <span className="text-[11px] text-[#64748B] block mt-1">15s Rolling HMAC</span>
                  </div>
                </div>

                <div className="p-4 bg-[#FAF9F5] rounded-xl border border-[#E5E3DC] flex items-start gap-3 text-xs text-[#64748B] leading-relaxed">
                  <Shield className="w-5 h-5 text-[#2E6B38] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-[#1E293B] block mb-0.5">Privacy Notice for Students:</span>
                    Your individual tab status is strictly aggregated into the class focus metric. No student names, browsing destinations, or individual focus flags are shown on this public screen.
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-[#F1F0EA] flex items-center justify-between text-xs text-[#64748B]">
                <span>Displaying live session projection for Hall 302</span>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="text-[#2E6B38] hover:underline font-semibold flex items-center gap-1"
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E3DC] rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-[#EEF8EE] rounded-xl text-[#1B4D2E] border border-[#C8E6C9]">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1E293B]">Instructor Authentication</h3>
                <p className="text-xs text-[#64748B]">
                  FERPA compliance: Roster view access will be permanently logged.
                </p>
              </div>
            </div>

            {authError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleUnlockSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] uppercase font-bold text-[#64748B] block mb-1">
                  Instructor Key
                </label>
                <input
                  type="password"
                  value={instructorKeyInput}
                  onChange={(e) => setInstructorKeyInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#FAF9F5] border border-[#E5E3DC] rounded-xl text-sm font-mono text-[#1E293B] focus:outline-none focus:border-[#2E6B38]"
                  placeholder="Enter instructor authorization key"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(false)}
                  className="px-4 py-2 bg-[#F1F0EA] hover:bg-[#E5E3DC] text-[#64748B] rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#2E6B38] hover:bg-[#25572D] text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm"
                >
                  Verify &amp; Unlock Roster
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Anomaly Alerts Toast Stack */}
      <AnomalyAlerts alerts={alerts} onDismiss={handleDismissAlert} />
    </main>
  );
}
