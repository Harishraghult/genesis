"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useRef, useCallback } from "react";
import QRScanner from "@/components/QRScanner";
import { studentWsClient } from "@/lib/websocket";
import { getApiBase } from "@/lib/config";
import {
  Calendar,
  Clock,
  Shield,
  CheckCircle2,
  AlertTriangle,
  FileText,
  History,
  PhoneCall,
  X,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  ExternalLink,
  ChevronRight,
  Download,
  Eye,
  Check,
  Smartphone,
  LogOut,
  Volume2,
  VolumeX,
  Lock,
  ArrowLeft,
  RefreshCw,
  Bell,
  BellOff,
  UserCheck,
  Send,
  MessageSquare,
} from "lucide-react";

interface CourseSession {
  id: string;
  course_id: string;
  course_code?: string;
  course_title?: string;
  title: string;
  room_code: string;
  starts_at: string;
  ends_at: string;
  state: "ready" | "checkin_pending" | "active" | "paused" | "ended";
  status?: string;
  pending_review?: boolean;
}

interface CourseResource {
  id: string;
  session_id: string;
  title: string;
  url: string;
  kind: "pdf" | "text";
  downloadable: boolean;
  created_at: string;
}

interface PrivacyRequest {
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

export default function StudentPage() {
  // Navigation: 'today' | 'detail' | 'focus' | 'history'
  const [activeTab, setActiveTab] = useState<"today" | "focus" | "history">("today");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("FL-CS402-2026");
  const [showDetailView, setShowDetailView] = useState<boolean>(false);

  // Student Profile
  const [studentId, setStudentId] = useState<string>("21CS204");
  const [studentName, setStudentName] = useState<string>("Harish Raghul");

  // Sessions and Resources Data
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [resources, setResources] = useState<CourseResource[]>([]);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // DND / Quiet Mode
  const [quietOpted, setQuietOpted] = useState<boolean>(false);
  const [showQuietDisclosure, setShowQuietDisclosure] = useState<boolean>(false);
  const [quietMessage, setQuietMessage] = useState<string>("");

  // Focus Session State
  const [focusState, setFocusState] = useState<"idle" | "ready" | "active" | "paused" | "ended">("idle");
  const [focusStartTime, setFocusStartTime] = useState<number | null>(null);
  const [focusElapsedSeconds, setFocusElapsedSeconds] = useState<number>(0);
  const [maxPolicySeconds] = useState<number>(45 * 60); // 45-min signed policy limit
  const [isKioskLocked, setIsKioskLocked] = useState<boolean>(false);
  const [tabSwitchesCount, setTabSwitchesCount] = useState<number>(0);
  const [callManagerActive, setCallManagerActive] = useState<boolean>(false);
  const [callGraceRemaining, setCallGraceRemaining] = useState<number>(60);

  // Modals
  const [showScanner, setShowScanner] = useState<boolean>(false);
  const [showTeacherReviewModal, setShowTeacherReviewModal] = useState<boolean>(false);
  const [reviewReason, setReviewReason] = useState<string>("");
  const [privacyModalKind, setPrivacyModalKind] = useState<"correction" | "deletion" | null>(null);
  const [privacyModalSessionId, setPrivacyModalSessionId] = useState<string | null>(null);
  const [privacyReason, setPrivacyReason] = useState<string>("");
  const [viewingResource, setViewingResource] = useState<CourseResource | null>(null);
  const [resourcePage, setResourcePage] = useState<number>(1);
  const [resourceSavedOffline, setResourceSavedOffline] = useState<boolean>(false);
  const [sessionEndedAlert, setSessionEndedAlert] = useState<string | null>(null);

  // References to prevent stale closures
  const focusStateRef = useRef(focusState);
  useEffect(() => {
    focusStateRef.current = focusState;
  }, [focusState]);

  // Load Sessions and Data
  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      // 1. Fetch sessions
      const sRes = await fetch(`${getApiBase()}/api/sessions`, { cache: "no-store" });
      if (sRes.ok) {
        const sData: CourseSession[] = await sRes.json();
        setSessions(sData);

        // Check active session
        const currentActive = sData.find((s) => s.state === "active" || s.state === "checkin_pending");
        if (currentActive && focusStateRef.current === "idle") {
          // Keep selected session synced
          setSelectedSessionId(currentActive.id);
        }
      }

      // 2. Fetch resources for current session
      const rRes = await fetch(`${getApiBase()}/api/sessions/${selectedSessionId}/resources`, { cache: "no-store" });
      if (rRes.ok) {
        const rData = await rRes.json();
        setResources(rData);
      }

      // 3. Fetch privacy requests
      const prRes = await fetch(`${getApiBase()}/api/teacher/privacy/requests`, { cache: "no-store" });
      if (prRes.ok) {
        const prData: PrivacyRequest[] = await prRes.json();
        setPrivacyRequests(prData.filter((r) => r.student_id === studentId || r.student_id === "ALL"));
      }
    } catch (e: any) {
      console.warn("Error loading student data:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSessionId, studentId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Termination Handler — immediately ends focus, releases kiosk, and resets UI
  const handleSessionTermination = useCallback((reasonMsg?: string) => {
    const msg = reasonMsg || "The instructor has ended the class session. Your attendance record has been finalized.";
    setSessionEndedAlert(msg);
    setFocusState("ended");
    setIsKioskLocked(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    try {
      sessionStorage.removeItem("fl_active_student_session");
      localStorage.setItem("fl_session_active", "false");
    } catch {}

    // Reload latest attendance from server
    loadData();
  }, [loadData]);

  // Session Quit Synchronization (WebSockets, BroadcastChannel, LocalStorage, and 1s Polling)
  useEffect(() => {
    // 1. WebSocket Listener
    const unsubscribe = studentWsClient.subscribe((msg: any) => {
      if (msg.type === "SESSION_ENDED") {
        handleSessionTermination("The instructor Dr. Sarah Jenkins has ended the session. Your device has been released.");
      }
    });

    // 2. BroadcastChannel (instant zero-latency same-origin sync)
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("focuslock-session-sync");
      bc.onmessage = (event) => {
        if (event.data?.type === "SESSION_ENDED") {
          handleSessionTermination("The instructor has ended the class session. Your device has been released immediately.");
        }
      };
    }

    // 3. LocalStorage Listener (cross-tab sync)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "fl_session_active" && e.newValue === "false") {
        handleSessionTermination();
      }
    };
    window.addEventListener("storage", handleStorage);

    // 4. Real-Time Status Poller (every 1.5s)
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/session/status`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          // If the global session is inactive and focus is active, terminate
          if (data.session && data.session.is_active === false) {
            if (focusStateRef.current === "active" || focusStateRef.current === "paused") {
              handleSessionTermination();
            }
          }
        }
      } catch {}
    }, 1500);

    return () => {
      unsubscribe();
      if (bc) bc.close();
      window.removeEventListener("storage", handleStorage);
      clearInterval(pollInterval);
    };
  }, [handleSessionTermination]);

  // Focus Timer Tick
  useEffect(() => {
    let timer: any;
    if (focusState === "active") {
      timer = setInterval(() => {
        setFocusElapsedSeconds((prev) => {
          if (prev + 1 >= maxPolicySeconds) {
            setFocusState("ended");
            setIsKioskLocked(false);
            setStatusMessage("45-minute signed policy limit reached. Focus session expired.");
            return prev + 1;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [focusState, maxPolicySeconds]);

  // Call Manager Grace Countdown
  useEffect(() => {
    let timer: any;
    if (callManagerActive && callGraceRemaining > 0) {
      timer = setInterval(() => {
        setCallGraceRemaining((prev) => {
          if (prev <= 1) {
            setCallManagerActive(false);
            return 60;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [callManagerActive, callGraceRemaining]);

  // Anti-Tamper & Tab Switch Event Reporter (FERPA-compliant: no destination app logged)
  useEffect(() => {
    if (focusState !== "active" || callManagerActive) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchesCount((prev) => prev + 1);
        // Post neutral background event to instructor review without affecting attendance
        fetch(`${getApiBase()}/api/sessions/${selectedSessionId}/focus-events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            student_id: studentId,
            student_name: studentName,
            action: "backgrounded",
            detail: "App moved to background during active focus · neutral review flag",
          }),
        }).catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [focusState, callManagerActive, selectedSessionId, studentId, studentName]);

  // Start Focus Session
  const handleStartFocus = () => {
    setFocusState("active");
    setFocusStartTime(Date.now());
    setFocusElapsedSeconds(0);
    setActiveTab("focus");
    setStatusMessage("Voluntary focus active. Your phone remains under your control.");

    // Record started focus event
    fetch(`${getApiBase()}/api/sessions/${selectedSessionId}/focus-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: studentId,
        student_name: studentName,
        action: "started",
        detail: "Student voluntary focus session initialized",
      }),
    }).catch(() => {});
  };

  // Pause Focus
  const handlePauseFocus = () => {
    setFocusState("paused");
    fetch(`${getApiBase()}/api/sessions/${selectedSessionId}/focus-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: studentId,
        student_name: studentName,
        action: "paused",
        detail: "Student paused voluntary focus · attendance remains intact",
      }),
    }).catch(() => {});
  };

  // Resume Focus
  const handleResumeFocus = () => {
    setFocusState("active");
    fetch(`${getApiBase()}/api/sessions/${selectedSessionId}/focus-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: studentId,
        student_name: studentName,
        action: "resumed",
        detail: "Student resumed voluntary focus session",
      }),
    }).catch(() => {});
  };

  // Exit Focus
  const handleExitFocus = () => {
    setFocusState("ended");
    setIsKioskLocked(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    fetch(`${getApiBase()}/api/sessions/${selectedSessionId}/focus-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: studentId,
        student_name: studentName,
        action: "exited",
        detail: "Student voluntarily exited focus · attendance preserved",
      }),
    }).catch(() => {});
  };

  // Toggle Kiosk Fullscreen
  const toggleKioskFullscreen = () => {
    if (!isKioskLocked) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      setIsKioskLocked(true);
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setIsKioskLocked(false);
    }
  };

  // Submit Privacy Request (Correction or Deletion)
  const handleSubmitPrivacyRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (privacyReason.trim().length < 10) {
      setErrorMessage("Please enter at least 10 characters explaining the reason for your request.");
      return;
    }
    try {
      const res = await fetch(`${getApiBase()}/api/teacher/privacy/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          student_name: studentName,
          session_id: privacyModalSessionId || selectedSessionId,
          kind: privacyModalKind || "correction",
          reason: privacyReason.trim(),
        }),
      });
      if (res.ok) {
        setStatusMessage(`Your ${privacyModalKind} request has been submitted for instructor review.`);
        setPrivacyModalKind(null);
        setPrivacyReason("");
        loadData();
      } else {
        setErrorMessage("Failed to submit privacy request. Please retry.");
      }
    } catch (e: any) {
      setErrorMessage("Error submitting request: " + e.message);
    }
  };

  // Request Teacher Review for attendance
  const handleRequestTeacherReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reviewReason.trim().length < 5) {
      setErrorMessage("Please state why camera check-in was unavailable.");
      return;
    }
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${selectedSessionId}/attendance/${studentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "pending_review",
          reason: reviewReason.trim(),
        }),
      });
      if (res.ok) {
        setStatusMessage("Attendance review request submitted to Dr. Sarah Jenkins.");
        setShowTeacherReviewModal(false);
        setReviewReason("");
        loadData();
      }
    } catch (e: any) {
      setErrorMessage("Error: " + e.message);
    }
  };

  // Format Seconds to MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || sessions[0];

  return (
    <div className="min-h-screen bg-[#f5f7f3] text-[#173a36] font-sans antialiased flex flex-col selection:bg-[#dff1dc]">
      {/* Top App Header */}
      <header className="bg-[#173f37] text-white px-5 sm:px-8 py-3.5 shadow-md flex justify-between items-center z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#ffffff18] border border-[#ffffff33] flex items-center justify-center text-white">
            <Shield className="w-4 h-4 text-[#b9d7c5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white">FocusLock</span>
              <span className="bg-[#ffffff18] text-[#d4e6d8] text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Student App
              </span>
            </div>
            <p className="text-[11px] text-[#b9d7c5] -mt-0.5">LOCAL DEMO · Privacy-Preserving Participation</p>
          </div>
        </div>

        {/* Student Profile & Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold text-white">{studentName}</span>
            <span className="text-[11px] text-[#b9d7c5]">ID: {studentId} · Desk #01</span>
          </div>
          <button
            onClick={() => loadData()}
            disabled={refreshing}
            className="p-2 rounded-lg bg-[#ffffff14] hover:bg-[#ffffff25] text-white transition-all text-xs flex items-center gap-1.5"
            title="Refresh session status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden md:inline">Sync</span>
          </button>
        </div>
      </header>

      {/* Navigation Bar (Tabs: Today | Focus | History) */}
      <nav className="bg-white border-b border-[#dce4df] px-5 sm:px-8 sticky top-0 z-20 shadow-xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex gap-1 sm:gap-2">
            <button
              onClick={() => {
                setActiveTab("today");
                setShowDetailView(false);
              }}
              className={`px-4 py-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-all ${
                activeTab === "today" && !showDetailView
                  ? "border-[#173f37] text-[#173f37] bg-[#f8faf8]"
                  : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
              }`}
            >
              <Calendar className="w-4 h-4" />
              Today&apos;s Classes
            </button>

            <button
              onClick={() => {
                setActiveTab("focus");
                setShowDetailView(false);
              }}
              className={`px-4 py-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-all relative ${
                activeTab === "focus"
                  ? "border-[#173f37] text-[#173f37] bg-[#f8faf8]"
                  : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Class Focus
              {focusState === "active" && (
                <span className="w-2 h-2 rounded-full bg-[#235e32] animate-pulse"></span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab("history");
                setShowDetailView(false);
              }}
              className={`px-4 py-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-all ${
                activeTab === "history"
                  ? "border-[#173f37] text-[#173f37] bg-[#f8faf8]"
                  : "border-transparent text-[#5b6e68] hover:text-[#173f37]"
              }`}
            >
              <History className="w-4 h-4" />
              Attendance History
            </button>
          </div>

          {focusState === "active" && (
            <div className="hidden sm:flex items-center gap-2 bg-[#dff1dc] text-[#1c5a35] px-3 py-1 rounded-full text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#1c5a35] animate-ping"></span>
              Focus Active: {formatTime(focusElapsedSeconds)}
            </div>
          )}
        </div>
      </nav>

      {/* Global Status Banner Messages */}
      {statusMessage && (
        <div className="max-w-4xl mx-auto w-full px-5 mt-4">
          <div className="bg-[#dff1dc] border border-[#a8d4a6] text-[#1c5a35] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1c5a35]" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage("")} className="hover:opacity-75">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="max-w-4xl mx-auto w-full px-5 mt-4">
          <div className="bg-[#fff0ed] border border-[#f5b8af] text-[#942f23] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-[#942f23]" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage("")} className="hover:opacity-75">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="max-w-4xl mx-auto w-full px-5 py-6 flex-1 flex flex-col gap-6">
        {/* ========================================================================= */}
        {/* TAB 1: TODAY'S CLASSES VIEW (Genesis v2 layout) */}
        {/* ========================================================================= */}
        {activeTab === "today" && !showDetailView && (
          <div className="flex flex-col gap-6">
            {/* Header Greeting */}
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#173f37]">
                Today&apos;s classes
              </h1>
              <p className="text-xs sm:text-sm text-[#5b6e68] mt-1">
                Hello, <strong className="text-[#173f37]">{studentName}</strong>. Your phone stays under your control.
              </p>
            </div>

            {/* Genesis v2 "Automatic class focus" Card */}
            <div className="bg-white border border-[#dce4df] rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#e9f3e7] text-[#173f37] flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5 text-[#217554]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-[#173f37]">Automatic class focus</h3>
                    <p className="text-xs text-[#5b6e68] mt-0.5">
                      No background lock. Pause or Exit remains available at any time.
                    </p>
                  </div>
                </div>

                <span
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                    quietOpted ? "bg-[#dff1dc] text-[#1c5a35]" : "bg-[#eff1ee] text-[#5b6e68]"
                  }`}
                >
                  {quietOpted ? "DND Enabled" : "DND Off"}
                </span>
              </div>

              <p className="text-xs sm:text-sm text-[#5b6e68] leading-relaxed">
                A focus disclosure appears immediately after each QR scan. No setup is required here.
                If you accept, that class can start voluntary focus when it becomes active.
                {quietOpted
                  ? " Automatic DND is enabled for your active classes."
                  : " Automatic DND is off until Android grants access."}
              </p>

              {quietMessage && (
                <div className="bg-[#fff7e8] border border-[#e6be68] text-[#795b29] text-xs p-3 rounded-xl">
                  {quietMessage}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {quietOpted ? (
                  <button
                    onClick={() => {
                      setQuietOpted(false);
                      setQuietMessage("Automatic DND turned off. Attendance is unaffected.");
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] transition-all flex items-center gap-1.5"
                  >
                    <BellOff className="w-3.5 h-3.5 text-[#5b6e68]" /> Turn off automatic DND
                  </button>
                ) : (
                  <button
                    onClick={() => setShowQuietDisclosure(true)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] shadow-xs transition-all flex items-center gap-1.5"
                  >
                    <Bell className="w-3.5 h-3.5 text-[#b9d7c5]" /> Set up automatic DND
                  </button>
                )}
              </div>
            </div>

            {/* Active Class Focus Action Banner (Genesis v2 shortcut) */}
            {selectedSession && selectedSession.state === "active" && (
              <div className="bg-gradient-to-r from-[#173f37] to-[#1f4e44] text-white rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5 text-[#b9d7c5]" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#b9d7c5]">
                      Active Lecture in Progress
                    </span>
                    <h4 className="font-bold text-base text-white">{selectedSession.title}</h4>
                    <p className="text-xs text-[#d4e6d8]">{selectedSession.room_code}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {focusState === "active" ? (
                    <button
                      onClick={() => setActiveTab("focus")}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold bg-[#dff1dc] text-[#1c5a35] hover:bg-[#cceed0] transition-all flex items-center justify-center gap-2 shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> Return to focus · Pause or Exit
                    </button>
                  ) : (
                    <button
                      onClick={handleStartFocus}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold bg-white text-[#173f37] hover:bg-[#f5f7f3] transition-all flex items-center justify-center gap-2 shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> Enter voluntary class focus
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Classes List */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base text-[#173f37]">Scheduled sessions today</h3>
                <button
                  onClick={() => loadData()}
                  disabled={refreshing}
                  className="text-xs text-[#217554] hover:underline flex items-center gap-1 font-semibold"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh list
                </button>
              </div>

              {sessions.length === 0 ? (
                <div className="bg-white border border-[#dce4df] rounded-2xl p-8 text-center text-[#5b6e68] text-xs sm:text-sm">
                  No classes scheduled today. Attendance from earlier sessions is in History.
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className="bg-white border border-[#dce4df] hover:border-[#b8cdbf] rounded-2xl p-5 sm:p-6 shadow-xs transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#217554]">
                          {session.course_code || "CS-402"}
                        </span>
                        <span className="text-[#5b6e68] text-xs">·</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            session.state === "active"
                              ? "bg-[#dff1dc] text-[#1c5a35]"
                              : session.state === "checkin_pending"
                              ? "bg-[#fff7e8] text-[#795b29]"
                              : session.state === "ended"
                              ? "bg-[#e3e5e3] text-[#505b52]"
                              : "bg-[#eff1ee] text-[#5b6e68]"
                          }`}
                        >
                          Session: {session.state.replace("_", " ")}
                        </span>
                      </div>

                      <h4 className="font-bold text-base text-[#173f37]">{session.title}</h4>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#5b6e68] mt-2">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#217554]" />
                          {new Date(session.starts_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          –{" "}
                          {new Date(session.ends_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>·</span>
                        <span>{session.room_code}</span>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#173f37]">Attendance:</span>
                        <span className="bg-[#e0f0e4] text-[#235e32] text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {session.status || "VERIFIED PRESENT"}
                        </span>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => {
                          setSelectedSessionId(session.id);
                          setShowDetailView(true);
                        }}
                        className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] transition-all flex items-center justify-center gap-1.5"
                      >
                        View session <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      {(session.state === "active" || session.state === "checkin_pending") && (
                        <button
                          onClick={() => {
                            setSelectedSessionId(session.id);
                            setShowScanner(true);
                          }}
                          className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] transition-all flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          Scan QR
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}

              <p className="text-[11px] text-[#5b6e68] leading-relaxed">
                Camera scanning is optional. Ask your teacher to confirm attendance if you cannot or choose not to scan.
              </p>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1 (Subview): SESSION DETAIL VIEW (session/{id} from Genesis v2) */}
        {/* ========================================================================= */}
        {activeTab === "today" && showDetailView && selectedSession && (
          <div className="flex flex-col gap-6">
            <button
              onClick={() => setShowDetailView(false)}
              className="text-xs font-semibold text-[#173f37] hover:underline flex items-center gap-1.5 w-fit"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to today&apos;s classes
            </button>

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#217554]">
                {selectedSession.course_code || "CS-402"} · {selectedSession.room_code}
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#173f37] mt-1">
                {selectedSession.title}
              </h2>
              <p className="text-xs sm:text-sm text-[#5b6e68] mt-1">
                Starts at{" "}
                {new Date(selectedSession.starts_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · Until{" "}
                {new Date(selectedSession.ends_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>

            {/* Attendance Status Card */}
            <div className="bg-white border border-[#dce4df] rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-base text-[#173f37]">
                  Attendance: {selectedSession.status || "VERIFIED PRESENT"}
                </h4>
                <span className="bg-[#e0f0e4] text-[#235e32] text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Verified Desk #01
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#5b6e68] leading-relaxed">
                QR check-ins and teacher confirmations appear here. If a record looks wrong, ask your teacher to correct it.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={() => setShowScanner(true)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] shadow-xs flex items-center gap-1.5"
                >
                  Scan classroom QR
                </button>
                <button
                  onClick={() => setShowTeacherReviewModal(true)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] flex items-center gap-1.5"
                >
                  Camera unavailable? Request review
                </button>
              </div>
            </div>

            {/* Quiet Notifications Card */}
            <div className="bg-white border border-[#dce4df] rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col gap-3">
              <h4 className="font-bold text-base text-[#173f37]">Quiet notifications</h4>
              <p className="text-xs sm:text-sm text-[#5b6e68] leading-relaxed">
                {quietOpted
                  ? "FocusLock quiet mode is requested for this session. Android DND exceptions control which calls and messages alert you."
                  : "Optional: automatically turn on Do Not Disturb when you enter an active session."}
              </p>
              <div className="flex items-center gap-3 pt-1">
                {quietOpted ? (
                  <button
                    onClick={() => {
                      setQuietOpted(false);
                      setQuietMessage("Quiet mode stopped.");
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] flex items-center gap-1.5"
                  >
                    <BellOff className="w-3.5 h-3.5 text-[#5b6e68]" /> Stop quiet mode now
                  </button>
                ) : (
                  <button
                    onClick={() => setShowQuietDisclosure(true)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] shadow-xs flex items-center gap-1.5"
                  >
                    <Bell className="w-3.5 h-3.5 text-[#b9d7c5]" /> Set up automatic quiet mode
                  </button>
                )}
              </div>
            </div>

            {/* Focus is your choice Card */}
            <div className="bg-white border border-[#dce4df] rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col gap-3">
              <h4 className="font-bold text-base text-[#173f37]">Focus is your choice</h4>
              <p className="text-xs sm:text-sm text-[#5b6e68] leading-relaxed">
                Scanning is optional. A QR check-in is evidence of participation, not proof of physical presence.
                This app does not lock your phone or prevent legitimate emergencies.
              </p>
              <div className="pt-1">
                <button
                  onClick={handleStartFocus}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#173f37] text-white hover:bg-[#12332c] shadow-xs flex items-center gap-2"
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Open voluntary focus
                </button>
              </div>
            </div>

            {/* Course Resources Attached by Teacher */}
            <div className="flex flex-col gap-3">
              <h4 className="font-bold text-base text-[#173f37]">Course resources</h4>
              {resources.length === 0 ? (
                <div className="bg-white border border-[#dce4df] rounded-2xl p-6 text-center text-[#5b6e68] text-xs">
                  No course documents attached yet.
                </div>
              ) : (
                resources.map((res) => (
                  <div
                    key={res.id}
                    className="bg-white border border-[#dce4df] hover:border-[#b8cdbf] rounded-2xl p-4 sm:p-5 shadow-xs flex justify-between items-center gap-4 transition-all"
                  >
                    <div>
                      <h5 className="font-bold text-sm text-[#173f37]">{res.title}</h5>
                      <p className="text-[11px] text-[#5b6e68] mt-0.5">
                        {res.kind.toUpperCase()} ·{" "}
                        {res.downloadable ? "Offline copy allowed" : "View only"}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setViewingResource(res);
                        setResourcePage(1);
                      }}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#e9f3e7] text-[#173f37] hover:bg-[#dcead8] transition-all flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" /> Read
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => loadData()}
              disabled={refreshing}
              className="w-fit px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] transition-all flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh attendance
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: VOLUNTARY FOCUS & KIOSK VIEW (focus/{id} from Genesis v2) */}
        {/* ========================================================================= */}
        {activeTab === "focus" && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#173f37]">
                  Voluntary focus
                </h1>
                <p className="text-xs sm:text-sm text-[#5b6e68] mt-1">
                  Status: <strong className="text-[#173f37] capitalize">{focusState}</strong>
                </p>
              </div>

              <span
                className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                  focusState === "active"
                    ? "bg-[#dff1dc] text-[#1c5a35]"
                    : focusState === "paused"
                    ? "bg-[#fff7e8] text-[#795b29]"
                    : "bg-[#eff1ee] text-[#5b6e68]"
                }`}
              >
                {focusState}
              </span>
            </div>

            {/* Timer and Elapsed Display */}
            <div className="bg-white border border-[#dce4df] rounded-2xl p-6 sm:p-8 shadow-xs text-center flex flex-col items-center justify-center gap-3">
              <span className="text-xs font-bold uppercase tracking-widest text-[#217554]">
                Elapsed Focus Time
              </span>
              <div className="text-5xl sm:text-6xl font-mono font-bold text-[#173f37] tracking-tight">
                {formatTime(focusElapsedSeconds)}
              </div>
              <p className="text-xs text-[#5b6e68]">
                Signed policy deadline:{" "}
                <strong className="text-[#173f37]">
                  {formatTime(Math.max(0, maxPolicySeconds - focusElapsedSeconds))} remaining
                </strong>{" "}
                (45-min local limit)
              </p>

              {tabSwitchesCount > 0 && (
                <div className="bg-[#fff7e8] border border-[#e6be68] text-[#795b29] text-xs px-3.5 py-1.5 rounded-full flex items-center gap-2 mt-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>
                    App backgrounded {tabSwitchesCount} time{tabSwitchesCount > 1 ? "s" : ""}. Review flag noted.
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs sm:text-sm text-[#5b6e68] leading-relaxed">
              Your phone remains yours. Focus participation and attendance are separate. An interruption does not tell us
              which app was opened or why.
            </p>

            {/* Focus Action Controls (Genesis v2 exact buttons) */}
            <div className="flex flex-wrap items-center gap-3">
              {focusState === "idle" || focusState === "ended" ? (
                <button
                  onClick={handleStartFocus}
                  className="px-6 py-3 rounded-xl text-sm font-bold bg-[#173f37] text-white hover:bg-[#12332c] shadow-sm flex items-center gap-2 transition-all"
                >
                  <Play className="w-4 h-4 fill-current" /> Start focus
                </button>
              ) : null}

              {focusState === "active" ? (
                <button
                  onClick={handlePauseFocus}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-[#fff7e8] border border-[#e6be68] text-[#795b29] hover:bg-[#fdedcf] flex items-center gap-2 transition-all"
                >
                  <Pause className="w-4 h-4 fill-current" /> Pause now
                </button>
              ) : null}

              {focusState === "paused" ? (
                <button
                  onClick={handleResumeFocus}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] flex items-center gap-2 transition-all shadow-xs"
                >
                  <Play className="w-4 h-4 fill-current" /> Resume
                </button>
              ) : null}

              {focusState === "active" || focusState === "paused" ? (
                <button
                  onClick={handleExitFocus}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#942f23] hover:bg-[#fff0ed] flex items-center gap-2 transition-all"
                >
                  <LogOut className="w-4 h-4" /> Exit focus now
                </button>
              ) : null}
            </div>

            {/* Safe Communications & Call Manager Grace Shortcuts */}
            {(focusState === "active" || focusState === "paused") && (
              <div className="bg-white border border-[#dce4df] rounded-2xl p-5 shadow-xs flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-[#173f37]">Emergency & Communications Shortcuts</h4>
                  <span className="text-[11px] text-[#5b6e68]">60s grace return</span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      setCallManagerActive(true);
                      setCallGraceRemaining(60);
                      setStatusMessage("Call Manager activated: 60s grace return granted.");
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] flex items-center gap-2"
                  >
                    <PhoneCall className="w-3.5 h-3.5 text-[#217554]" /> Open phone / Call Manager
                  </button>

                  <button
                    onClick={() => {
                      setStatusMessage("Opening emergency dialer...");
                      window.open("tel:112");
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#f5b8af] text-[#942f23] hover:bg-[#fff0ed] flex items-center gap-2"
                  >
                    <PhoneCall className="w-3.5 h-3.5 text-[#942f23]" /> Emergency (112)
                  </button>

                  <button
                    onClick={toggleKioskFullscreen}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] flex items-center gap-2 ml-auto"
                  >
                    {isKioskLocked ? (
                      <>
                        <Minimize2 className="w-3.5 h-3.5" /> Disengage Kiosk
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-3.5 h-3.5" /> Fullscreen Kiosk
                      </>
                    )}
                  </button>
                </div>

                {callManagerActive && (
                  <div className="bg-[#e9f3e7] text-[#173f37] text-xs p-3 rounded-xl flex items-center justify-between font-medium">
                    <span>Call in progress · Grace window active:</span>
                    <strong className="font-mono text-sm">{callGraceRemaining}s remaining</strong>
                  </div>
                )}
              </div>
            )}

            {/* Course Resources Drawer in Focus Mode */}
            {resources.length > 0 && (
              <div className="bg-white border border-[#dce4df] rounded-2xl p-5 shadow-xs flex flex-col gap-3">
                <h4 className="font-bold text-sm text-[#173f37]">Course Materials for This Lecture</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {resources.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setViewingResource(r);
                        setResourcePage(1);
                      }}
                      className="p-3 rounded-xl border border-[#dce4df] hover:border-[#217554] bg-[#f8faf8] text-left flex items-start gap-3 transition-all"
                    >
                      <FileText className="w-4 h-4 text-[#217554] shrink-0 mt-0.5" />
                      <div className="overflow-hidden">
                        <span className="font-semibold text-xs text-[#173f37] truncate block">{r.title}</span>
                        <span className="text-[10px] text-[#5b6e68] block mt-0.5">
                          {r.kind.toUpperCase()} · Click to read
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <p className="text-[11px] text-[#5b6e68] leading-relaxed">
                Pause and Exit work without internet. The signed policy expires on this device&apos;s elapsed clock; pause
                does not extend it. If the app cannot report an event, the teacher&apos;s status is unknown.
              </p>
              <p className="text-[11px] text-[#5b6e68] leading-relaxed">
                While focus is active, leaving the app with the screen on may show a local reminder and send a neutral
                background-interruption flag for teacher review. Screen-off and explicit Exit do not trigger it.
                FocusLock cannot identify another app or why you left. Attendance is unchanged.
              </p>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: ATTENDANCE HISTORY & PRIVACY REQUESTS (history from Genesis v2) */}
        {/* ========================================================================= */}
        {activeTab === "history" && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#173f37]">
                  Attendance history
                </h1>
                <p className="text-xs sm:text-sm text-[#5b6e68] mt-1">
                  Your records only · QR check-ins and teacher confirmations
                </p>
              </div>

              <button
                onClick={() => loadData()}
                disabled={refreshing}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3] flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>

            {/* List of Previous Sessions */}
            <div className="flex flex-col gap-4">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white border border-[#dce4df] rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#217554]">
                        {session.course_code || "CS-402"}
                      </span>
                      <span className="text-[#5b6e68] text-xs">·</span>
                      <span className="text-xs text-[#5b6e68]">{session.room_code}</span>
                    </div>

                    <h4 className="font-bold text-base text-[#173f37]">{session.title}</h4>

                    <div className="flex items-center gap-3 text-xs text-[#5b6e68] mt-2">
                      <span>{new Date(session.starts_at).toLocaleDateString()}</span>
                      <span>·</span>
                      <span className="bg-[#e0f0e4] text-[#235e32] text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {session.status || "VERIFIED PRESENT"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setPrivacyModalKind("correction");
                        setPrivacyModalSessionId(session.id);
                        setPrivacyReason("");
                      }}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#173f37] hover:bg-[#f5f7f3] border border-[#cfdbd4] transition-all"
                    >
                      Request correction
                    </button>
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <button
                  onClick={() => {
                    setPrivacyModalKind("deletion");
                    setPrivacyModalSessionId(null);
                    setPrivacyReason("");
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68] hover:text-[#942f23] hover:border-[#f5b8af] transition-all flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5" /> Request data deletion
                </button>
              </div>
            </div>

            {/* Submitted Privacy Requests List */}
            <div className="flex flex-col gap-3 pt-4 border-t border-[#dce4df]">
              <h3 className="font-bold text-base text-[#173f37]">Submitted Privacy & Audit Requests</h3>
              {privacyRequests.length === 0 ? (
                <p className="text-xs text-[#5b6e68]">No privacy or correction requests submitted yet.</p>
              ) : (
                privacyRequests.map((req) => (
                  <div
                    key={req.id}
                    className="bg-white border border-[#dce4df] rounded-xl p-4 text-xs flex flex-col gap-1.5 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#173f37] capitalize">
                        {req.kind} Request #{req.id}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          req.status === "accepted"
                            ? "bg-[#dff1dc] text-[#1c5a35]"
                            : req.status === "declined"
                            ? "bg-[#fff0ed] text-[#942f23]"
                            : "bg-[#fff7e8] text-[#795b29]"
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <p className="text-[#5b6e68]">&ldquo;{req.reason}&rdquo;</p>

                    {req.resolution && (
                      <div className="bg-[#f8faf8] border border-[#e2ece0] p-2 rounded-lg text-[#173f37] text-[11px] mt-1 font-medium">
                        Instructor Resolution: {req.resolution}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL 1: CAMERA SCANNER (QR Check-in) */}
      {/* ========================================================================= */}
      {showScanner && (
        <div className="fixed inset-0 z-50 bg-[#173f37]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-[#173f37]">Classroom QR Scan</h3>
              <button onClick={() => setShowScanner(false)} className="text-[#5b6e68] hover:text-[#173f37]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#5b6e68]">
              Scan the rotating projector challenge to register your voluntary check-in token.
            </p>

            <div className="my-2">
              <QRScanner
                onSuccess={(data) => {
                  setStatusMessage("Check-in successful! Cryptographic token verified.");
                  setShowScanner(false);
                  loadData();
                }}
              />
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => {
                  setShowScanner(false);
                  setShowTeacherReviewModal(true);
                }}
                className="text-xs text-[#217554] hover:underline font-semibold"
              >
                Camera broken? Request review
              </button>
              <button
                onClick={() => setShowScanner(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#173f37]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: REQUEST TEACHER REVIEW */}
      {/* ========================================================================= */}
      {showTeacherReviewModal && (
        <div className="fixed inset-0 z-50 bg-[#173f37]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl flex flex-col gap-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-[#173f37]">Request Instructor Review</h3>
              <button onClick={() => setShowTeacherReviewModal(false)} className="text-[#5b6e68] hover:text-[#173f37]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#5b6e68] leading-relaxed">
              If your camera is unavailable, cracked, or encountering permission restrictions, request Dr. Sarah Jenkins
              to manually confirm your desk attendance.
            </p>

            <form onSubmit={handleRequestTeacherReview} className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-[#173f37]">Reason for manual review:</label>
              <textarea
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                placeholder="e.g., Camera lens cracked, present at desk Row 1 #01"
                rows={3}
                required
                className="w-full text-xs p-3 rounded-xl border border-[#c7d4cc] focus:outline-hidden focus:border-[#217554]"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTeacherReviewModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c]"
                >
                  Send request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: PRIVACY & CORRECTION REQUEST (Min 10 chars as in Genesis v2) */}
      {/* ========================================================================= */}
      {privacyModalKind && (
        <div className="fixed inset-0 z-50 bg-[#173f37]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl flex flex-col gap-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-[#173f37]">
                {privacyModalKind === "correction"
                  ? "Request attendance correction"
                  : "Request data deletion"}
              </h3>
              <button onClick={() => setPrivacyModalKind(null)} className="text-[#5b6e68] hover:text-[#173f37]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#5b6e68] leading-relaxed">
              {privacyModalKind === "correction"
                ? "State why the recorded attendance requires correction. Instructor will audit and update your record."
                : "Submit a GDPR/FERPA right-to-erasure request for this session record. Requires institutional approval."}
            </p>

            <form onSubmit={handleSubmitPrivacyRequest} className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-[#173f37]">
                Reason (at least 10 characters required):
              </label>
              <textarea
                value={privacyReason}
                onChange={(e) => setPrivacyReason(e.target.value)}
                placeholder="Provide details for human review..."
                rows={4}
                required
                className="w-full text-xs p-3 rounded-xl border border-[#c7d4cc] focus:outline-hidden focus:border-[#217554]"
              />

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-[#5b6e68]">
                  {privacyReason.trim().length}/10 characters min
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPrivacyModalKind(null)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={privacyReason.trim().length < 10}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] disabled:opacity-50"
                  >
                    Send request
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: DND AUTOMATIC SETUP DISCLOSURE (Genesis v2 exact text) */}
      {/* ========================================================================= */}
      {showQuietDisclosure && (
        <div className="fixed inset-0 z-50 bg-[#173f37]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl flex flex-col gap-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#e9f3e7] flex items-center justify-center text-[#217554]">
                  <Bell className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-lg text-[#173f37]">Automatic quiet mode for class</h3>
              </div>
              <button onClick={() => setShowQuietDisclosure(false)} className="text-[#5b6e68] hover:text-[#173f37]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-[#5b6e68] leading-relaxed">
              After you allow Do Not Disturb access once, FocusLock will turn on its own DND rule when you enter an active
              class session. It quiets notifications until the signed session timer expires, the session ends, or you tap
              Stop. Android may silence calls or messages depending on your DND exceptions; check those settings before
              enabling. You can always use your phone, dialer and messages, and stop quiet mode in the app or notification.
              Attendance and voluntary focus are unchanged if you decline.
            </p>

            <div className="flex justify-end items-center gap-2 pt-2">
              <button
                onClick={() => setShowQuietDisclosure(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-[#cfdbd4] text-[#5b6e68]"
              >
                Not now
              </button>
              <button
                onClick={() => {
                  setQuietOpted(true);
                  setShowQuietDisclosure(false);
                  setQuietMessage("Automatic DND enabled for future sessions. Android exceptions apply.");
                }}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#173f37] text-white hover:bg-[#12332c] shadow-xs"
              >
                Allow automatic quiet mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: COURSE RESOURCE VIEWER (Genesis v2 text & PDF reader) */}
      {/* ========================================================================= */}
      {viewingResource && (
        <div className="fixed inset-0 z-50 bg-[#173f37]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-hidden animate-in fade-in">
            <div className="flex items-center justify-between border-b border-[#dce4df] pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#217554]">
                  College Resource · {viewingResource.kind.toUpperCase()}
                </span>
                <h3 className="font-bold text-base sm:text-lg text-[#173f37] mt-0.5">{viewingResource.title}</h3>
              </div>
              <button onClick={() => setViewingResource(null)} className="text-[#5b6e68] hover:text-[#173f37]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-[#f8faf8] border border-[#dce4df] rounded-2xl text-xs sm:text-sm text-[#173f37] leading-relaxed">
              {viewingResource.kind === "text" ? (
                <div className="font-mono whitespace-pre-wrap">
                  {`=== FOCUSLOCK COURSE NOTES: ${viewingResource.title} ===
Author: Dr. Sarah Jenkins, Department of Computer Science
Course: CS-402 Advanced Distributed Systems

Summary & Key Takeaways:
1. Byzantine fault tolerance ensures consensus across asynchronous nodes up to f < n/3 faulty actors.
2. Android lock pinning and Device Policy Manager provide physical kiosk isolation for high-stakes assessments.
3. Cryptographic rotation challenges defend against replay tokens without storing student biometric identifiers.
4. FERPA regulatory guidelines dictate auditability and voluntary participant agency during classroom focus.`}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[220px] gap-3 text-center">
                  <div className="w-16 h-20 bg-white border border-[#cfdbd4] rounded-lg shadow-xs flex flex-col items-center justify-center text-[#217554]">
                    <FileText className="w-8 h-8" />
                    <span className="text-[9px] font-bold mt-1">PDF P.{resourcePage}</span>
                  </div>
                  <p className="font-semibold text-xs text-[#173f37]">
                    Viewing {viewingResource.title} (Page {resourcePage} of 6)
                  </p>
                  <p className="text-[11px] text-[#5b6e68] max-w-md">
                    Full vector rendering initialized in app-private storage. You can read, highlight, and review notes
                    without navigating outside FocusLock.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setResourcePage((p) => Math.max(1, p - 1))}
                      disabled={resourcePage <= 1}
                      className="px-3 py-1.5 rounded-lg border border-[#cfdbd4] text-xs font-semibold disabled:opacity-40"
                    >
                      Previous Page
                    </button>
                    <span className="text-xs text-[#5b6e68] font-mono px-2">Page {resourcePage} / 6</span>
                    <button
                      onClick={() => setResourcePage((p) => Math.min(6, p + 1))}
                      disabled={resourcePage >= 6}
                      className="px-3 py-1.5 rounded-lg border border-[#cfdbd4] text-xs font-semibold disabled:opacity-40"
                    >
                      Next Page
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              {viewingResource.downloadable && (
                <button
                  onClick={() => {
                    setResourceSavedOffline(!resourceSavedOffline);
                    setStatusMessage(
                      resourceSavedOffline
                        ? "Offline cache deleted."
                        : "Resource saved in encrypted app-private storage for offline study."
                    );
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                    resourceSavedOffline
                      ? "bg-[#dff1dc] border-[#a8d4a6] text-[#1c5a35]"
                      : "bg-white border-[#cfdbd4] text-[#173f37] hover:bg-[#f5f7f3]"
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  {resourceSavedOffline ? "Saved privately for offline use" : "Save private offline copy"}
                </button>
              )}

              <button
                onClick={() => setViewingResource(null)}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#173f37] text-white hover:bg-[#12332c] ml-auto"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: SESSION ENDED ALERT (Instructor Quit Instant Disengage) */}
      {/* ========================================================================= */}
      {sessionEndedAlert && (
        <div className="fixed inset-0 z-50 bg-[#173f37]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl flex flex-col gap-4 text-center animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-2xl bg-[#dff1dc] text-[#1c5a35] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <h3 className="font-bold text-lg text-[#173f37]">Session Ended by Instructor</h3>

            <p className="text-xs sm:text-sm text-[#5b6e68] leading-relaxed">
              {sessionEndedAlert}
            </p>

            <button
              onClick={() => {
                setSessionEndedAlert(null);
                setActiveTab("today");
                setShowDetailView(false);
              }}
              className="w-full py-2.5 rounded-xl text-xs font-bold bg-[#173f37] text-white hover:bg-[#12332c] transition-all shadow-xs"
            >
              Return to Today&apos;s Classes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
