"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useRef } from "react";
import RollingQR from "@/components/RollingQR";
import LiveMatrix, { StudentRosterItem } from "@/components/LiveMatrix";
import PresencePulse from "@/components/PresencePulse";
import AnomalyAlerts, { AnomalyEvent } from "@/components/AnomalyAlerts";
import { wsClient } from "@/lib/websocket";
import { getApiBase } from "@/lib/config";
import {
  Shield,
  BookOpen,
  Calendar,
  Users,
  Radio,
  Power,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Volume2,
  VolumeX,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  FileText,
  History,
  Search,
  Filter,
  Trash2,
  Download,
  Eye,
  Check,
  X,
  Smartphone,
  Lock,
} from "lucide-react";

interface Course {
  id: string;
  code: string;
  title: string;
  term: string;
  instructor: string;
}

interface SessionItem {
  id: string;
  course_id: string;
  title: string;
  room_code: string;
  starts_at: string;
  ends_at: string;
  state: "ready" | "checkin_pending" | "active" | "paused" | "ended";
}

interface ResourceItem {
  id: string;
  session_id: string;
  title: string;
  url: string;
  kind: "pdf" | "text";
  downloadable: boolean;
  created_at: string;
}

interface AuditItem {
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

interface FocusEventItem {
  id: string;
  session_id: string;
  student_id: string;
  student_name: string;
  action: string;
  detail: string;
  recorded_at: string;
}

interface PrivacyRequestItem {
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

interface AttendanceRow {
  student_id: string;
  student_name: string;
  email?: string;
  status: "present" | "absent" | "excused";
  method: string;
}

export default function UnifiedFacultyDashboard() {
  // Navigation & Data States
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null);

  // Tabs: overview | projector | roster | resources | activity
  const [activeTab, setActiveTab] = useState<"overview" | "projector" | "roster" | "resources" | "activity">("overview");

  // Roster & Attendance
  const [roster, setRoster] = useState<StudentRosterItem[]>([]);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterFilter, setRosterFilter] = useState<"all" | "present" | "unrecorded" | "review">("all");
  const [confirmModal, setConfirmModal] = useState<{ studentId: string; studentName: string; status: "present" | "absent" | "excused" } | null>(null);
  const [confirmReason, setConfirmReason] = useState("");

  // Course Materials / Resources
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [newResTitle, setNewResTitle] = useState("");
  const [newResUrl, setNewResUrl] = useState("");
  const [newResKind, setNewResKind] = useState<"pdf" | "text">("pdf");
  const [newResDownloadable, setNewResDownloadable] = useState(false);

  // Activity & Audit Trail
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [focusEvents, setFocusEvents] = useState<FocusEventItem[]>([]);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequestItem[]>([]);
  const [privacyReviewModal, setPrivacyReviewModal] = useState<{ request: PrivacyRequestItem; status: "accepted" | "declined" } | null>(null);
  const [privacyResolution, setPrivacyResolution] = useState("");

  // Live Metrics & Pulse (Projector)
  const [metrics, setMetrics] = useState({
    total_joined: 0,
    focused_count: 0,
    distracted_count: 0,
    focus_percentage: 100,
    flagged_count: 0,
  });
  const [pulseActive, setPulseActive] = useState(false);
  const [pulseResponsesCount, setPulseResponsesCount] = useState(0);

  // Alert System
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [focusAlertPopup, setFocusAlertPopup] = useState<string | null>(null);
  const [recentAnomalyAlerts, setRecentAnomalyAlerts] = useState<AnomalyEvent[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Create Session Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [newSessionRoom, setNewSessionRoom] = useState("Hall 302");
  const [newSessionStarts, setNewSessionStarts] = useState(() => new Date().toISOString().slice(0, 16));
  const [newSessionEnds, setNewSessionEnds] = useState(() => new Date(Date.now() + 7200000).toISOString().slice(0, 16));

  const audioCtxRef = useRef<AudioContext | null>(null);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const isInitialStatusLoadRef = useRef<boolean>(true);

  // Dual-tone high-contrast alert chime synthesized through Web Audio API
  const playAlertSound = () => {
    try {
      if (typeof window === "undefined" || !soundEnabled) return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = audioCtxRef.current || new AudioCtx();
      audioCtxRef.current = ctx;

      // Two-tone alert tone: 880Hz -> 660Hz
      const now = ctx.currentTime;
      [880, 660].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        const at = now + idx * 0.18;
        gain.gain.setValueAtTime(0.001, at);
        gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
        osc.start(at);
        osc.stop(at + 0.17);
      });
    } catch {}
  };

  const toggleSound = () => {
    if (!soundEnabled) {
      setSoundEnabled(true);
      playAlertSound();
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
      setStatusMessage("Sound alerts enabled for focus interruptions.");
    } else {
      setSoundEnabled(false);
      setStatusMessage("Sound alerts muted.");
    }
  };

  // 1. Initial Load: Fetch Courses
  useEffect(() => {
    fetch(`${getApiBase()}/api/courses`)
      .then((res) => res.json())
      .then((data: Course[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setCourses(data);
          setSelectedCourse(data[0]);
        }
      })
      .catch((err) => setErrorMessage("Could not load courses: " + err.message));
  }, []);

  // 2. Load Sessions when Course changes
  useEffect(() => {
    if (!selectedCourse) return;
    fetch(`${getApiBase()}/api/sessions?course_id=${selectedCourse.id}`)
      .then((res) => res.json())
      .then((data: SessionItem[]) => {
        if (Array.isArray(data)) {
          setSessions(data);
          const activeOrFirst = data.find((s) => s.state === "active") || data[0] || null;
          setSelectedSession(activeOrFirst);
        }
      })
      .catch(() => {});
  }, [selectedCourse]);

  // 3. Load Session Details & Poll Roster / Alerts
  const refreshSessionData = async () => {
    if (!selectedSession) return;
    try {
      const [resRoster, resResources, resAudit, resFocus, resPrivacy, resStatus] = await Promise.all([
        fetch(`${getApiBase()}/api/session/roster`).then((r) => r.json()).catch(() => ({})),
        fetch(`${getApiBase()}/api/sessions/${selectedSession.id}/resources`).then((r) => r.json()).catch(() => []),
        fetch(`${getApiBase()}/api/sessions/${selectedSession.id}/audit`).then((r) => r.json()).catch(() => []),
        fetch(`${getApiBase()}/api/sessions/${selectedSession.id}/focus-events`).then((r) => r.json()).catch(() => []),
        fetch(`${getApiBase()}/api/teacher/privacy/requests`).then((r) => r.json()).catch(() => []),
        fetch(`${getApiBase()}/api/session/status`).then((r) => r.json()).catch(() => ({})),
      ]);

      if (Array.isArray(resRoster.students)) {
        setRoster(resRoster.students);
      }
      if (Array.isArray(resResources)) setResources(resResources);
      if (Array.isArray(resAudit)) setAuditLogs(resAudit);
      if (Array.isArray(resFocus)) setFocusEvents(resFocus);
      if (Array.isArray(resPrivacy)) setPrivacyRequests(resPrivacy);
      if (resStatus.metrics) setMetrics(resStatus.metrics);

      // Check for new focus alerts
      if (Array.isArray(resStatus.recent_focus_alerts)) {
        if (isInitialStatusLoadRef.current) {
          // On first load, seed seen alerts so pre-existing alerts do not trigger an immediate popup
          for (const fa of resStatus.recent_focus_alerts) {
            seenAlertIdsRef.current.add(fa.id);
          }
          isInitialStatusLoadRef.current = false;
        } else {
          let hasNewAlert = false;
          let newestAlertDetail = "";
          for (const fa of resStatus.recent_focus_alerts) {
            if (!seenAlertIdsRef.current.has(fa.id)) {
              seenAlertIdsRef.current.add(fa.id);
              hasNewAlert = true;
              newestAlertDetail = `${fa.student_name}: ${fa.detail || "Student left foreground"}`;
              const event: AnomalyEvent = {
                id: fa.id,
                student_id: fa.student_id,
                student_name: fa.student_name,
                timestamp: fa.timestamp,
                message: fa.detail || "Student left foreground",
                title: fa.type === "TAMPER_DETECTED" ? "Tamper Attempt" : "Focus Lost Violation",
                type: fa.type || "APP_SWITCH",
                leave_count: fa.leave_count,
              };
              setRecentAnomalyAlerts((prev) => [event, ...prev.slice(0, 4)]);
            }
          }
          if (hasNewAlert) {
            playAlertSound();
            setFocusAlertPopup(newestAlertDetail || "New focus interruption for review. Cause unknown; attendance unchanged.");
            if (soundEnabled && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              try {
                new Notification("FocusLock · Focus Event for Review", {
                  body: "A student moved away from the active lecture window.",
                });
              } catch {}
            }
          }
        }
      }
    } catch {}
  };

  useEffect(() => {
    refreshSessionData();
    const interval = setInterval(refreshSessionData, 3500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession]);

  // Session State Transitions (start, activate, pause, resume, end)
  const handleSessionAction = async (action: "start" | "activate" | "pause" | "resume" | "end") => {
    if (!selectedSession) return;
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${selectedSession.id}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        const updated: SessionItem = await res.json();
        setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSelectedSession(updated);
        setStatusMessage(
          action === "start"
            ? "Check-in is now OPEN. Rotating QR challenge is live."
            : action === "end"
            ? "Session ENDED. Students are released immediately."
            : `Session state changed to ${updated.state.toUpperCase()}.`
        );
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.detail || "Action failed");
      }
    } catch (e: any) {
      setErrorMessage("Network error: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Create New Session
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch(`${getApiBase()}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: selectedCourse.id,
          title: newSessionTitle.trim(),
          room_code: newSessionRoom.trim(),
          starts_at: newSessionStarts,
          ends_at: newSessionEnds,
        }),
      });
      if (res.ok) {
        const created: SessionItem = await res.json();
        setSessions((prev) => [...prev, created]);
        setSelectedSession(created);
        setShowCreateModal(false);
        setNewSessionTitle("");
        setStatusMessage(`Session "${created.title}" scheduled successfully.`);
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.detail || "Failed to schedule session");
      }
    } catch (e: any) {
      setErrorMessage("Error: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Confirm / Correct Attendance
  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !confirmModal) return;
    if (confirmReason.trim().length > 0 && confirmReason.trim().length < 10) {
      setErrorMessage("Audit reason must be at least 10 characters long.");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${selectedSession.id}/attendance/${confirmModal.studentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: confirmModal.status,
          reason: confirmReason.trim() || undefined,
        }),
      });
      if (res.ok) {
        setStatusMessage(`Attendance record updated for ${confirmModal.studentName}.`);
        setConfirmModal(null);
        setConfirmReason("");
        refreshSessionData();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.detail || "Failed to update attendance");
      }
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Add Resource
  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !newResTitle.trim() || !newResUrl.trim()) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${selectedSession.id}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newResTitle.trim(),
          url: newResUrl.trim(),
          kind: newResKind,
          downloadable: newResDownloadable,
        }),
      });
      if (res.ok) {
        const created: ResourceItem = await res.json();
        setResources((prev) => [...prev, created]);
        setNewResTitle("");
        setNewResUrl("");
        setStatusMessage("Learning material attached successfully.");
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.detail || "Failed to attach resource");
      }
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Delete Resource
  const handleDeleteResource = async (id: string) => {
    if (!selectedSession) return;
    try {
      await fetch(`${getApiBase()}/api/sessions/${selectedSession.id}/resources/${id}`, { method: "DELETE" });
      setResources((prev) => prev.filter((r) => r.id !== id));
      setStatusMessage("Resource link removed.");
    } catch {}
  };

  // Review Privacy Request
  const handleReviewPrivacy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privacyReviewModal) return;
    if (privacyResolution.trim().length < 10) {
      setErrorMessage("Resolution note must be at least 10 characters long.");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch(`${getApiBase()}/api/teacher/privacy/requests/${privacyReviewModal.request.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: privacyReviewModal.status,
          resolution: privacyResolution.trim(),
        }),
      });
      if (res.ok) {
        setPrivacyRequests((prev) => prev.filter((r) => r.id !== privacyReviewModal.request.id));
        setPrivacyReviewModal(null);
        setPrivacyResolution("");
        setStatusMessage("Student privacy request decision recorded.");
        refreshSessionData();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.detail || "Failed to submit decision");
      }
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Filtered Roster
  const filteredRoster = roster.filter((student) => {
    const matchesText = `${student.student_name} ${student.student_id}`.toLowerCase().includes(rosterQuery.toLowerCase().trim());
    const isPresent = student.attendance_status === "VERIFIED_PRESENT" || student.attendance_status === "LEFT_MIDDLE";
    const matchesFilter =
      rosterFilter === "all" ||
      (rosterFilter === "present" && isPresent) ||
      (rosterFilter === "unrecorded" && student.attendance_status === "ABSENT") ||
      (rosterFilter === "review" && (student.leave_count > 0 || student.attendance_status === "LEFT_MIDDLE"));
    return matchesText && matchesFilter;
  });

  const presentCount = roster.filter((s) => s.attendance_status === "VERIFIED_PRESENT" || s.attendance_status === "LEFT_MIDDLE").length;
  const unrecordedCount = roster.filter((s) => s.attendance_status === "ABSENT").length;
  const reviewCount = roster.filter((s) => s.leave_count > 0 || s.attendance_status === "LEFT_MIDDLE").length;

  return (
    <div className="min-h-screen bg-[#f5f7f3] text-[#173a36] flex flex-col font-sans selection:bg-[#dff1dc]">
      {/* Top Header - White & Soft Green with Elegant Accents */}
      <header className="bg-white border-b border-[#dce4df] px-6 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#173f37] text-white flex items-center justify-center font-bold tracking-tight shadow-md">
            FL
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-[#173f37]">FocusLock</h1>
              <span className="text-[11px] font-semibold bg-[#e9f3e7] text-[#1b734d] px-2.5 py-0.5 rounded-full border border-[#d1ded6]">
                FACULTY CONTROL
              </span>
            </div>
            <p className="text-xs text-[#5b6e68]">Privacy-Preserving Attendance & Hardware-Level Attestation</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Audio Chime Button */}
          <button
            type="button"
            onClick={toggleSound}
            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-all ${
              soundEnabled
                ? "bg-[#e9f3e7] border-[#b9d7c5] text-[#174b37] hover:bg-[#ddede0]"
                : "bg-white border-[#cfdbd4] text-[#5b6e68] hover:bg-[#f5f7f3]"
            }`}
            title="Toggle focus interruption alert sounds"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-[#1b734d]" /> : <VolumeX className="w-4 h-4" />}
            {soundEnabled ? "Alert Sound ON" : "Alert Sound MUTED"}
          </button>

          {/* Direct Link to Student Portal */}
          <a
            href="/student"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#eef5ec] flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Smartphone className="w-4 h-4 text-[#217554]" />
            Student View
            <ExternalLink className="w-3.5 h-3.5 text-[#5b6e68]" />
          </a>

          {/* Instructor badge */}
          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-[#dce4df] text-xs">
            <div className="w-7 h-7 rounded-full bg-[#e5eee4] text-[#173f37] font-bold flex items-center justify-center border border-[#cfdbd4]">
              SJ
            </div>
            <div>
              <p className="font-semibold text-[#173f37]">Dr. Sarah Jenkins</p>
              <p className="text-[10px] text-[#5b6e68]">Lead Faculty</p>
            </div>
          </div>
        </div>
      </header>

      {/* Notifications / Feedback Toasts */}
      {statusMessage && (
        <div className="bg-[#e9f3e7] border-b border-[#c8e2d0] text-[#1c5a35] px-6 py-2.5 text-xs font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#217554]" />
            {statusMessage}
          </span>
          <button onClick={() => setStatusMessage("")} className="hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {errorMessage && (
        <div className="bg-[#fff0ed] border-b border-[#fadad5] text-[#942f23] px-6 py-2.5 text-xs font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#942f23]" />
            {errorMessage}
          </span>
          <button onClick={() => setErrorMessage("")} className="hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Courses & Scheduler (3 cols) */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border border-[#dce4df] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#5b6e68]">Your Courses</span>
              <span className="text-xs font-bold bg-[#e9f3e7] text-[#174b37] px-2 py-0.5 rounded-full border border-[#d1ded6]">
                {courses.length}
              </span>
            </div>

            <div className="space-y-2">
              {courses.map((c) => {
                const isSelected = selectedCourse?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCourse(c)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-[#e9f3e7] border-[#8cb59a] shadow-sm ring-1 ring-[#8cb59a]"
                        : "bg-white border-[#e6ece7] hover:bg-[#f7faf4] text-[#334e47]"
                    }`}
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#1b734d] block">
                      {c.code}
                    </span>
                    <strong className="text-sm font-semibold text-[#173f37] block mt-0.5 leading-snug">
                      {c.title}
                    </strong>
                    <small className="text-xs text-[#5b6e68] block mt-1">{c.term}</small>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowCreateModal(true)}
              className="w-full mt-4 py-2.5 px-3 rounded-xl border border-dashed border-[#8cb59a] text-[#174b37] hover:bg-[#e9f3e7] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            >
              <Plus className="w-4 h-4 text-[#1b734d]" />
              Schedule New Session
            </button>
          </div>

          {/* Quick Anomaly / Realtime Violations Card */}
          <div className="bg-white rounded-2xl border border-[#dce4df] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#5b6e68]">Live Tamper Alerts</span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            {recentAnomalyAlerts.length === 0 ? (
              <p className="text-xs text-[#687b73] py-2">No active focus violations reported.</p>
            ) : (
              <div className="space-y-2.5">
                {recentAnomalyAlerts.slice(0, 3).map((a) => (
                  <div key={a.id} className="p-2.5 rounded-xl bg-[#fff6f4] border border-[#fbd8d3] text-xs">
                    <div className="flex items-center justify-between font-semibold text-[#942f23]">
                      <span>{a.student_name}</span>
                      <span className="text-[10px] bg-red-100 px-1.5 py-0.5 rounded">
                        Switch #{a.leave_count || 1}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#783c34] mt-1">{a.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Right Column: Main Content (9 cols) */}
        <main className="lg:col-span-9 space-y-6">
          {/* Top Session Banner with Lifecycle Controls */}
          <div className="bg-white rounded-2xl border border-[#dce4df] p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#edf0eb]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#1b734d] tracking-wide uppercase">
                    {selectedCourse?.code || "COURSE"}
                  </span>
                  <span
                    className={`text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
                      selectedSession?.state === "active"
                        ? "bg-[#dff1dc] text-[#1c5a35] border-[#b6e3b0]"
                        : selectedSession?.state === "paused"
                        ? "bg-[#fff2d6] text-[#7a5518] border-[#fae2b1]"
                        : selectedSession?.state === "ended"
                        ? "bg-[#eff1ee] text-[#556860] border-[#d5ded8]"
                        : "bg-[#eaf1fb] text-[#1d4ed8] border-[#bfdbfe]"
                    }`}
                  >
                    {selectedSession?.state.replace("_", " ") || "READY"}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-[#173f37] mt-1 tracking-tight">
                  {selectedSession?.title || "No Session Selected"}
                </h2>
                <p className="text-xs text-[#5b6e68] mt-1">
                  Room {selectedSession?.room_code || "UNASSIGNED"} · Starts{" "}
                  {selectedSession ? new Date(selectedSession.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} · Ends{" "}
                  {selectedSession ? new Date(selectedSession.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </p>
              </div>

              {/* State Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedSession?.state === "ready" && (
                  <button
                    onClick={() => handleSessionAction("start")}
                    disabled={busy}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] shadow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Play className="w-3.5 h-3.5" /> Open Check-In
                  </button>
                )}
                {selectedSession?.state === "checkin_pending" && (
                  <button
                    onClick={() => handleSessionAction("activate")}
                    disabled={busy}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] shadow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Play className="w-3.5 h-3.5" /> Begin Active Class
                  </button>
                )}
                {selectedSession?.state === "active" && (
                  <button
                    onClick={() => handleSessionAction("pause")}
                    disabled={busy}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#fff7e8] border border-[#e6be68] text-[#795b29] hover:bg-[#faebd1] flex items-center gap-1.5 transition-all"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause Session
                  </button>
                )}
                {selectedSession?.state === "paused" && (
                  <button
                    onClick={() => handleSessionAction("resume")}
                    disabled={busy}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] flex items-center gap-1.5 transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Resume Session
                  </button>
                )}
                {selectedSession && selectedSession.state !== "ended" && (
                  <button
                    onClick={() => handleSessionAction("end")}
                    disabled={busy}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#942f23] hover:bg-[#fff0ed] flex items-center gap-1.5 transition-all"
                  >
                    <Power className="w-3.5 h-3.5" /> End Session
                  </button>
                )}
              </div>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5">
              <div className="p-3.5 rounded-xl bg-[#f7faf4] border border-[#e1ebe2]">
                <strong className="text-2xl font-bold text-[#173f37] block leading-none">{presentCount}</strong>
                <span className="text-xs text-[#5b6e68] block mt-1">Verified Present</span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#f7faf4] border border-[#e1ebe2]">
                <strong className="text-2xl font-bold text-[#173f37] block leading-none">{unrecordedCount}</strong>
                <span className="text-xs text-[#5b6e68] block mt-1">Unrecorded / Absent</span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#f7faf4] border border-[#e1ebe2]">
                <strong className="text-2xl font-bold text-[#b47d20] block leading-none">{reviewCount}</strong>
                <span className="text-xs text-[#5b6e68] block mt-1">Pending Review</span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#f7faf4] border border-[#e1ebe2]">
                <strong className="text-2xl font-bold text-[#173f37] block leading-none">{resources.length}</strong>
                <span className="text-xs text-[#5b6e68] block mt-1">Attached Materials</span>
              </div>
            </div>

            {/* Section Tabs */}
            <nav className="flex items-center gap-2 mt-6 border-b border-[#e0e8e1] overflow-x-auto text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className={`pb-3 px-3.5 border-b-2 transition-all whitespace-nowrap ${
                  activeTab === "overview"
                    ? "border-[#1b734d] text-[#173f37]"
                    : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
                }`}
              >
                Overview & Live QR
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("projector")}
                className={`pb-3 px-3.5 border-b-2 transition-all whitespace-nowrap ${
                  activeTab === "projector"
                    ? "border-[#1b734d] text-[#173f37]"
                    : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
                }`}
              >
                Classroom Projector Matrix
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("roster")}
                className={`pb-3 px-3.5 border-b-2 transition-all whitespace-nowrap ${
                  activeTab === "roster"
                    ? "border-[#1b734d] text-[#173f37]"
                    : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
                }`}
              >
                Class Roster ({roster.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("resources")}
                className={`pb-3 px-3.5 border-b-2 transition-all whitespace-nowrap ${
                  activeTab === "resources"
                    ? "border-[#1b734d] text-[#173f37]"
                    : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
                }`}
              >
                Course Materials ({resources.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("activity")}
                className={`pb-3 px-3.5 border-b-2 transition-all whitespace-nowrap ${
                  activeTab === "activity"
                    ? "border-[#1b734d] text-[#173f37]"
                    : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
                }`}
              >
                Audit Trail & Review ({auditLogs.length})
              </button>
            </nav>
          </div>

          {/* TAB 1: OVERVIEW & ROTATING QR */}
          {activeTab === "overview" && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-7 bg-white rounded-2xl border border-[#dce4df] p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#1b734d]">Live Check-in</span>
                    <h3 className="text-base font-bold text-[#173f37] mt-0.5">Rotating Classroom Challenge</h3>
                  </div>
                  <span className="text-xs font-semibold bg-[#e9f3e7] text-[#174b37] px-2.5 py-1 rounded-full border border-[#d1ded6]">
                    Rotates every 20s
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center p-4 bg-[#f8fbf7] rounded-xl border border-[#e1ebe2]">
                  <RollingQR
                    active={selectedSession?.state === "active" || selectedSession?.state === "checkin_pending"}
                    starting={busy}
                    onStart={() => handleSessionAction("start")}
                  />
                  <p className="text-xs text-[#5b6e68] text-center mt-3 max-w-sm">
                    A QR check-in is evidence of voluntary participation. Rotating cryptographic challenges reject
                    photographed codes or forwarded tokens.
                  </p>
                </div>
              </div>

              <div className="md:col-span-5 space-y-4">
                <div className="bg-white rounded-2xl border border-[#dce4df] p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#173f37] mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#1b734d]" />
                    Hardware Anti-Tamper Policy
                  </h3>
                  <p className="text-xs text-[#5b6e68] leading-relaxed">
                    Student devices run in full-screen containment. Android companion utilizes{" "}
                    <code className="text-[#173f37] font-semibold">startLockTask()</code> and{" "}
                    <code className="text-[#173f37] font-semibold">FLAG_SECURE</code> to physically pin FocusLock and
                    suppress task switching.
                  </p>
                  <button
                    onClick={() => setActiveTab("roster")}
                    className="mt-3 text-xs font-semibold text-[#1b734d] hover:underline"
                  >
                    Review Roster & Attendance →
                  </button>
                </div>

                <div className="bg-white rounded-2xl border border-[#dce4df] p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#173f37] mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#1b734d]" />
                    Authorized Course Materials
                  </h3>
                  <p className="text-xs text-[#5b6e68] leading-relaxed">
                    Students can safely access allowed course documents and reference slides without exiting kiosk
                    lockdown mode.
                  </p>
                  <button
                    onClick={() => setActiveTab("resources")}
                    className="mt-3 text-xs font-semibold text-[#1b734d] hover:underline"
                  >
                    Manage Course Materials →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CLASSROOM PROJECTOR MATRIX */}
          {activeTab === "projector" && (
            <div className="bg-white rounded-2xl border border-[#dce4df] p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-[#173f37]">Projector-Safe Live Matrix</h3>
                  <p className="text-xs text-[#5b6e68]">
                    Anonymous desk grid displayed in front of the classroom. Real names are hidden to protect privacy.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PresencePulse
                    onTriggerPulse={async () => {
                      setPulseActive(true);
                      setPulseResponsesCount(0);
                      setTimeout(() => setPulseActive(false), 30000);
                    }}
                    pulseActive={pulseActive}
                    pulseResponsesCount={pulseResponsesCount}
                    totalStudentsCount={roster.length}
                  />
                </div>
              </div>

              <LiveMatrix students={roster} />
            </div>
          )}

          {/* TAB 3: CLASS ROSTER & AUDITED CORRECTIONS */}
          {activeTab === "roster" && (
            <div className="bg-white rounded-2xl border border-[#dce4df] p-6 shadow-sm space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-[#173f37]">Enrolled Class Roster</h3>
                  <p className="text-xs text-[#5b6e68]">
                    Manual overrides require an audited reason. Changes are preserved with non-repudiation timestamps.
                  </p>
                </div>

                {/* Search & Filter Toolbar */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#5b6e68] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      placeholder="Search name or ID…"
                      value={rosterQuery}
                      onChange={(e) => setRosterQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-[#cfdbd4] text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#8cb59a]"
                    />
                  </div>

                  <div className="flex items-center gap-1 bg-[#f5f7f3] p-1 rounded-lg border border-[#e1ebe2]">
                    {(["all", "present", "unrecorded", "review"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setRosterFilter(f)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-all ${
                          rosterFilter === f
                            ? "bg-white text-[#173f37] shadow-sm"
                            : "text-[#5b6e68] hover:text-[#173f37]"
                        }`}
                      >
                        {f === "review" ? "Needs Review" : f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Roster Table */}
              <div className="overflow-x-auto rounded-xl border border-[#edf0eb]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#f8fbf7] border-b border-[#edf0eb] text-[#5b6e68] uppercase text-[10px] tracking-wider font-bold">
                    <tr>
                      <th className="py-3 px-4">Student</th>
                      <th className="py-3 px-4">Seat</th>
                      <th className="py-3 px-4">Attendance Status</th>
                      <th className="py-3 px-4">Focus Activity</th>
                      <th className="py-3 px-4 text-right">Instructor Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf0eb]">
                    {filteredRoster.map((s) => {
                      const isPresent = s.attendance_status === "VERIFIED_PRESENT" || s.attendance_status === "LEFT_MIDDLE";
                      return (
                        <tr key={s.student_id} className="hover:bg-[#fbfcfb] transition-colors">
                          <td className="py-3.5 px-4">
                            <strong className="text-sm font-semibold text-[#173f37] block">{s.student_name}</strong>
                            <span className="text-[11px] text-[#5b6e68]">{s.student_id}</span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[11px] text-[#5b6e68]">{s.seat}</td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase border ${
                                isPresent
                                  ? "bg-[#e0f0e4] text-[#235e32] border-[#b6e3b0]"
                                  : "bg-[#eff1ee] text-[#556860] border-[#d5ded8]"
                              }`}
                            >
                              {s.attendance_status.replace("_", " ")}
                            </span>
                            <small className="block text-[10px] text-[#687b73] mt-0.5">
                              Method: {s.marked_by || "None"}
                            </small>
                          </td>
                          <td className="py-3.5 px-4">
                            {s.leave_count > 0 ? (
                              <span className="text-[#942f23] font-semibold text-[11px] flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {s.leave_count} app switches
                              </span>
                            ) : (
                              <span className="text-[#235e32] text-[11px] flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Focused
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setConfirmModal({ studentId: s.student_id, studentName: s.student_name, status: "present" })}
                                className="px-2.5 py-1 rounded bg-[#e9f3e7] text-[#174b37] border border-[#cfdbd4] hover:bg-[#ddede0] text-[11px] font-semibold"
                              >
                                Present
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmModal({ studentId: s.student_id, studentName: s.student_name, status: "absent" })}
                                className="px-2.5 py-1 rounded bg-white text-[#942f23] border border-[#fadad5] hover:bg-[#fff0ed] text-[11px] font-semibold"
                              >
                                Absent
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmModal({ studentId: s.student_id, studentName: s.student_name, status: "excused" })}
                                className="px-2.5 py-1 rounded bg-white text-[#51477f] border border-[#e2e0f0] hover:bg-[#f3f2fb] text-[11px] font-semibold"
                              >
                                Excused
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: COURSE MATERIALS / RESOURCES */}
          {activeTab === "resources" && (
            <div className="bg-white rounded-2xl border border-[#dce4df] p-6 shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-bold text-[#173f37]">Course Materials & Reference Documents</h3>
                <p className="text-xs text-[#5b6e68]">
                  Attach authorized college documents (PDF or plain text). Students can read these inside the secure
                  focus viewer without violating lockdown policy.
                </p>
              </div>

              {/* Add Resource Form */}
              <form onSubmit={handleAddResource} className="p-4 rounded-xl bg-[#f7faf4] border border-[#e1ebe2] space-y-3">
                <span className="text-xs font-bold text-[#173f37] block">Attach New Document</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="Document Title (e.g., Week 7 Lecture Slides)"
                    value={newResTitle}
                    onChange={(e) => setNewResTitle(e.target.value)}
                    className="p-2 rounded-lg border border-[#cfdbd4] text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#8cb59a]"
                  />
                  <input
                    type="url"
                    required
                    placeholder="HTTPS Document URL"
                    value={newResUrl}
                    onChange={(e) => setNewResUrl(e.target.value)}
                    className="p-2 rounded-lg border border-[#cfdbd4] text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#8cb59a]"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-4 text-xs text-[#5b6e68]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <select
                        value={newResKind}
                        onChange={(e) => setNewResKind(e.target.value as "pdf" | "text")}
                        className="p-1 rounded border border-[#cfdbd4] text-xs bg-white"
                      >
                        <option value="pdf">PDF Document</option>
                        <option value="text">Plain Text</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newResDownloadable}
                        onChange={(e) => setNewResDownloadable(e.target.checked)}
                        className="rounded text-[#1b734d]"
                      />
                      Allow private offline reading copy
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] shadow-sm transition-all"
                  >
                    Attach Document
                  </button>
                </div>
              </form>

              {/* Active Resources List */}
              <div className="space-y-2.5">
                {resources.length === 0 ? (
                  <p className="text-xs text-[#687b73] text-center py-6 border border-dashed border-[#cfdbd4] rounded-xl">
                    No learning materials attached to this session yet.
                  </p>
                ) : (
                  resources.map((r) => (
                    <div
                      key={r.id}
                      className="p-3.5 rounded-xl border border-[#edf0eb] bg-white flex items-center justify-between gap-4 hover:border-[#8cb59a] transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#e9f3e7] text-[#1b734d] flex items-center justify-center font-bold text-xs uppercase">
                          {r.kind}
                        </div>
                        <div>
                          <strong className="text-sm font-semibold text-[#173f37] block">{r.title}</strong>
                          <span className="text-xs text-[#5b6e68] truncate max-w-md block">{r.url}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDeleteResource(r.id)}
                          className="p-2 rounded-lg text-[#942f23] hover:bg-[#fff0ed] transition-all"
                          title="Remove resource"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: AUDIT TRAIL, FOCUS EVENTS & PRIVACY REQUESTS */}
          {activeTab === "activity" && (
            <div className="bg-white rounded-2xl border border-[#dce4df] p-6 shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-bold text-[#173f37]">Activity, Audit Trail & Privacy Requests</h3>
                <p className="text-xs text-[#5b6e68]">
                  Cryptographic verification history, student correction requests, and attendance override log.
                </p>
              </div>

              {/* Privacy Requests Queue */}
              {privacyRequests.length > 0 && (
                <div className="p-4 rounded-xl bg-[#fffaf0] border border-[#fae2b1] space-y-3">
                  <span className="text-xs font-bold text-[#7a5518] block uppercase tracking-wider">
                    Pending Student Privacy Requests ({privacyRequests.length})
                  </span>
                  <div className="space-y-2">
                    {privacyRequests.map((req) => (
                      <div
                        key={req.id}
                        className="p-3 bg-white rounded-lg border border-[#f0debe] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <strong className="text-[#173f37] block">
                            {req.student_name} ({req.student_id}) · {req.kind.toUpperCase()}
                          </strong>
                          <p className="text-[#5b6e68] mt-0.5">{req.reason}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPrivacyReviewModal({ request: req, status: "accepted" })}
                            className="px-2.5 py-1 rounded bg-[#e9f3e7] text-[#174b37] border border-[#cfdbd4] text-[11px] font-semibold"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => setPrivacyReviewModal({ request: req, status: "declined" })}
                            className="px-2.5 py-1 rounded bg-white text-[#942f23] border border-[#fadad5] text-[11px] font-semibold"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Two Column Log Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Attendance Audit Log */}
                <div className="p-4 rounded-xl border border-[#edf0eb] bg-[#fbfcfb] space-y-3">
                  <span className="text-xs font-bold text-[#173f37] block">Attendance Audit Trail</span>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {auditLogs.length === 0 ? (
                      <p className="text-xs text-[#687b73]">No attendance alterations recorded.</p>
                    ) : (
                      auditLogs.map((item) => (
                        <div key={item.id} className="p-2.5 bg-white rounded-lg border border-[#e6ece7] text-xs">
                          <div className="flex items-center justify-between font-semibold text-[#173f37]">
                            <span>{item.student_name}</span>
                            <span className="text-[10px] text-[#5b6e68]">
                              {new Date(item.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#244b42] mt-0.5">
                            {item.action}: {item.previous_status || "None"} → <strong>{item.new_status}</strong>
                          </div>
                          {item.reason && <p className="text-[10px] text-[#687b73] mt-1 italic">Reason: {item.reason}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Voluntary Focus Events Log */}
                <div className="p-4 rounded-xl border border-[#edf0eb] bg-[#fbfcfb] space-y-3">
                  <span className="text-xs font-bold text-[#173f37] block">Voluntary Focus Events</span>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {focusEvents.length === 0 ? (
                      <p className="text-xs text-[#687b73]">No focus interruptions detected.</p>
                    ) : (
                      focusEvents.map((item) => (
                        <div key={item.id} className="p-2.5 bg-white rounded-lg border border-[#e6ece7] text-xs">
                          <div className="flex items-center justify-between font-semibold text-[#173f37]">
                            <span>{item.student_name}</span>
                            <span className="text-[10px] text-[#5b6e68]">
                              {new Date(item.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#783c34] mt-0.5">{item.detail || item.action}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL 1: Focus Interruption Alert Pop-up */}
      {focusAlertPopup && (
        <div className="fixed inset-0 z-50 bg-[#112c28]/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border-2 border-[#e6be68] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-[#b47d20]">
              <AlertTriangle className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-wider">New Focus Interruption</span>
            </div>
            <h3 className="text-lg font-bold text-[#173f37]">Review a Focus Event</h3>
            <p className="text-xs text-[#5b6e68] leading-relaxed">
              {focusAlertPopup} The reason and destination application are unknown. Focus status does not revoke attendance.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setFocusAlertPopup(null);
                  setActiveTab("activity");
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c]"
              >
                View Activity
              </button>
              <button
                type="button"
                onClick={() => setFocusAlertPopup(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68] hover:bg-[#f5f7f3]"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Create Session Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-[#112c28]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSession}
            className="bg-white rounded-2xl border border-[#dce4df] max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#edf0eb]">
              <h3 className="text-base font-bold text-[#173f37]">Schedule New Class Session</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-[#5b6e68] hover:text-[#173f37]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-[#173f37] block mb-1">Session Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Week 8 · Zero-Trust & Hardware Kiosk Pinning"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#cfdbd4] focus:outline-none focus:ring-1 focus:ring-[#8cb59a]"
                />
              </div>

              <div>
                <label className="font-semibold text-[#173f37] block mb-1">Room Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Hall 302"
                  value={newSessionRoom}
                  onChange={(e) => setNewSessionRoom(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#cfdbd4] focus:outline-none focus:ring-1 focus:ring-[#8cb59a]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-[#173f37] block mb-1">Starts At</label>
                  <input
                    type="datetime-local"
                    required
                    value={newSessionStarts}
                    onChange={(e) => setNewSessionStarts(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#cfdbd4]"
                  />
                </div>
                <div>
                  <label className="font-semibold text-[#173f37] block mb-1">Ends At</label>
                  <input
                    type="datetime-local"
                    required
                    value={newSessionEnds}
                    onChange={(e) => setNewSessionEnds(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#cfdbd4]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#edf0eb]">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c]"
              >
                Create Session
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: Confirm / Correct Attendance with Reason */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-[#112c28]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAttendance}
            className="bg-white rounded-2xl border border-[#dce4df] max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-[#173f37]">
              Mark {confirmModal.studentName} as {confirmModal.status.toUpperCase()}
            </h3>
            <p className="text-xs text-[#5b6e68]">
              Corrections are audited with your instructor signature. Please supply a reason of at least 10 characters.
            </p>
            <div>
              <label className="text-xs font-semibold text-[#173f37] block mb-1">Audit Reason (min 10 chars)</label>
              <textarea
                required
                minLength={10}
                rows={3}
                placeholder="Explain the reason for this manual change (e.g., student camera broken, verified in person)"
                value={confirmReason}
                onChange={(e) => setConfirmReason(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-[#cfdbd4] text-xs focus:outline-none focus:ring-1 focus:ring-[#8cb59a]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c]"
              >
                Save Attendance
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: Review Student Privacy Request */}
      {privacyReviewModal && (
        <div className="fixed inset-0 z-50 bg-[#112c28]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleReviewPrivacy}
            className="bg-white rounded-2xl border border-[#dce4df] max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-[#173f37]">
              {privacyReviewModal.status.toUpperCase()} Privacy Request #{privacyReviewModal.request.id}
            </h3>
            <p className="text-xs text-[#5b6e68]">
              Student: {privacyReviewModal.request.student_name} ({privacyReviewModal.request.student_id})
              <br />
              Reason: {privacyReviewModal.request.reason}
            </p>
            <div>
              <label className="text-xs font-semibold text-[#173f37] block mb-1">Review Decision Justification (min 10 chars)</label>
              <textarea
                required
                minLength={10}
                rows={3}
                placeholder="Explain your review decision for the audit log..."
                value={privacyResolution}
                onChange={(e) => setPrivacyResolution(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-[#cfdbd4] text-xs focus:outline-none focus:ring-1 focus:ring-[#8cb59a]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPrivacyReviewModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c]"
              >
                Save Decision
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto py-5 px-6 border-t border-[#dce4df] bg-white text-xs text-[#738278] flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
        <div>
          FocusLock v0.6.0 · Monorepo Merged (Genesis v2 & FocusLock Attestation Engine)
        </div>
        <div>
          QR check-in provides participation evidence; teacher confirmation remains available at all times.
        </div>
      </footer>
    </div>
  );
}
