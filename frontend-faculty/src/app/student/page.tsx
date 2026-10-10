"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import QRScanner from "@/components/QRScanner";
import FocusAttestation from "@/components/FocusAttestation";
import CourseViewer from "@/components/CourseViewer";
import QuizModal from "@/components/QuizModal";
import { studentWsClient } from "@/lib/websocket";
import { getApiBase } from "@/lib/config";
import { LogOut, CheckCircle2, PhoneCall, AlertTriangle, X } from "lucide-react";

interface StudentSession {
  student_id: string;
  student_name: string;
  session_id: string;
  session_token: string;
  session_secret: string;
  status: string;
}

export default function StudentPage() {
  const [session, setSession] = useState<StudentSession | null>(null);
  const [pulseQuiz, setPulseQuiz] = useState<any | null>(null);
  const [sessionEnded, setSessionEnded] = useState<boolean>(false);
  const [kioskMode, setKioskMode] = useState<boolean>(true);
  const [emergencyNumber, setEmergencyNumber] = useState<string>("112");
  const [showExitConfirm, setShowExitConfirm] = useState<boolean>(false);

  // Refs so the poll interval never captures a stale closure
  const sessionRef = useRef<StudentSession | null>(null);
  const sessionEndedRef = useRef<boolean>(false);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { sessionEndedRef.current = sessionEnded; }, [sessionEnded]);

  // Termination — safe to call multiple times (idempotent via ref guard)
  const triggerSessionTermination = useCallback(() => {
    if (sessionEndedRef.current) return;
    setSessionEnded(true);
    sessionEndedRef.current = true;
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    // Auto-return to scan screen after 5 s
    setTimeout(() => {
      setSession(null);
      sessionRef.current = null;
      setSessionEnded(false);
      sessionEndedRef.current = false;
    }, 5000);
  }, []);

  useEffect(() => {
    // 1. WebSocket notification
    const unsubscribe = studentWsClient.subscribe((msg: any) => {
      if (msg.type === "PRESENCE_PULSE_START") {
        setPulseQuiz(msg.quiz);
      } else if (msg.type === "SESSION_ENDED") {
        triggerSessionTermination();
      }
    });

    // 2. High-frequency active poll: exit in <=2s when instructor stops session.
    // KEY FIX: read sessionRef.current (ref) — not session (stale closure at effect-mount time)
    const pollInterval = setInterval(() => {
      fetch(`${getApiBase()}/api/session/status`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (data.emergency_number) setEmergencyNumber(data.emergency_number);
          if (data.session && !data.session.is_active && sessionRef.current !== null) {
            triggerSessionTermination();
          }
        })
        .catch(() => {});
    }, 2000);

    // 3. BroadcastChannel cross-tab instant notification
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("focuslock-session-sync");
      bc.onmessage = (e) => {
        if (e.data?.type === "SESSION_ENDED") {
          triggerSessionTermination();
        }
      };
    }

    // 4. LocalStorage change listener
    const onStorage = (e: StorageEvent) => {
      if (e.key === "fl_session_active" && e.newValue === "false") {
        triggerSessionTermination();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
      if (bc) bc.close();
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps — poll reads sessionRef so stale closures are impossible

  const handlePunchSuccess = (data: StudentSession) => {
    setKioskMode(true);
    setSession(data);
    sessionRef.current = data;
    if (typeof document !== "undefined" && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const handleExit = () => {
    // Custom overlay — window.confirm() is silently blocked in fullscreen on mobile browsers
    setShowExitConfirm(true);
  };

  const handleConfirmExit = () => {
    setShowExitConfirm(false);
    setSession(null);
    sessionRef.current = null;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleEmergency = () => {
    setSession(null);
    sessionRef.current = null;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    window.location.href = `tel:${emergencyNumber}`;
  };

  return (
    <main className="min-h-screen p-3 sm:p-5 flex flex-col justify-between max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs">
        <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
          📱 FocusLock Student Mobile
        </span>
        <a
          href="/"
          className="text-cyan-400 hover:text-cyan-300 font-semibold underline text-[11px]"
        >
          ← Teacher Dashboard
        </a>
      </div>

      {!session ? (
        <div className="my-auto py-6">
          {sessionEnded && (
            <div className="mb-4 p-4 bg-cyan-950/90 border border-cyan-700 rounded-xl text-xs text-cyan-200 flex items-center gap-2 shadow-xl">
              <CheckCircle2 className="w-5 h-5 text-cyan-400 shrink-0" />
              <span className="font-semibold">Session ended by instructor. Returning to check-in…</span>
            </div>
          )}
          <QRScanner onSuccess={handlePunchSuccess} />
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-2">
          {/* Top Session Status Bar */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl shadow-md">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <span className="text-xs font-bold text-white block leading-tight">
                  {session.student_name}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {session.student_id} · CS-402
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleEmergency}
                className="px-2.5 py-1 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
                title={`Immediate baseband emergency call (${emergencyNumber})`}
              >
                <PhoneCall className="w-3 h-3 text-rose-400" /> {emergencyNumber}
              </button>

              <button
                onClick={handleExit}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="Exit Session"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Session Ended Notification */}
          {sessionEnded && (
            <div className="p-4 bg-cyan-950/90 border border-cyan-700 rounded-xl text-xs text-cyan-200 flex flex-col gap-2.5 shadow-xl">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-cyan-400 shrink-0" />
                <span className="font-semibold">Instructor stopped the session. Releasing locks and returning to Idle screen…</span>
              </div>
              <button
                onClick={() => {
                  setSession(null);
                  sessionRef.current = null;
                  setSessionEnded(false);
                  sessionEndedRef.current = false;
                }}
                className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition-colors"
              >
                Return to Check-In Screen Now
              </button>
            </div>
          )}

          {/* Focus Attestation & Visibility Guard */}
          <FocusAttestation studentId={session.student_id} kiosk={kioskMode} active={!sessionEnded} />

          {/* Protected Course Slides Viewer */}
          <CourseViewer
            sessionId={session.session_id}
            sessionSecret={session.session_secret}
          />

          {/* Presence Pulse MCQ Modal */}
          {pulseQuiz && (
            <QuizModal
              quiz={pulseQuiz}
              studentId={session.student_id}
              onClose={() => setPulseQuiz(null)}
            />
          )}
        </div>
      )}

      {/* Footer Branding */}
      <footer className="text-center py-3 text-[11px] text-slate-500">
        FocusLock Zero-Trust Academic Intranet · Session-Scoped Kiosk
      </footer>

      {/* Custom Exit Confirmation Overlay — replaces window.confirm() which is blocked in fullscreen */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-slate-900 border-2 border-amber-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center">
            <div className="w-14 h-14 bg-amber-500/10 border border-amber-500/30 rounded-full flex items-center justify-center mx-auto mb-3 text-amber-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-extrabold text-white">Exit Lecture Mode?</h2>
            <p className="text-xs text-amber-200/90 mt-2 leading-relaxed">
              Your early exit will be recorded on the faculty attendance board. Your attendance may be marked as <strong>Left in Middle</strong>.
            </p>
            <div className="flex flex-col gap-2 mt-5">
              <button
                onClick={handleConfirmExit}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-sm transition-colors"
              >
                Exit &amp; Record My Departure
              </button>
              <button
                onClick={() => setShowExitConfirm(false)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-sm border border-slate-700 flex items-center justify-center gap-2 transition-colors"
              >
                <X className="w-4 h-4" /> Stay in Lecture
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
