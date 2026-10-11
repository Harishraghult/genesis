"use client";

export const dynamic = "force-dynamic";

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
  joined_at?: number;
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

  // Restore session if user refreshes page while in lecture mode (only if session still active on server)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("fl_active_student_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.student_id && parsed.session_id) {
          fetch(`${getApiBase()}/api/session/status`, { cache: "no-store" })
            .then((res) => res.json())
            .then((data) => {
              if (data.session && data.session.is_active) {
                setSession(parsed);
                sessionRef.current = parsed;
              } else {
                sessionStorage.removeItem("fl_active_student_session");
              }
            })
            .catch(() => {
              setSession(parsed);
              sessionRef.current = parsed;
            });
        }
      }
    } catch {}
  }, []);

  // Termination — safe to call multiple times (idempotent via ref guard)
  const triggerSessionTermination = useCallback(() => {
    if (sessionEndedRef.current) return;
    setSessionEnded(true);
    sessionEndedRef.current = true;
    try {
      sessionStorage.removeItem("fl_active_student_session");
    } catch {}
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    // Auto-return to scan screen after 3.5 s
    setTimeout(() => {
      setSession(null);
      sessionRef.current = null;
      setSessionEnded(false);
      sessionEndedRef.current = false;
    }, 3500);
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

    // 2. High-frequency active poll: exit immediately (<1.5s) when instructor stops session
    const pollInterval = setInterval(() => {
      fetch(`${getApiBase()}/api/session/status`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (data.emergency_number) setEmergencyNumber(data.emergency_number);

          const currentStudent = sessionRef.current;
          if (currentStudent) {
            // When instructor ends/quits session, server reports is_active === false
            const isInactive = !data.session || data.session.is_active === false;
            if (isInactive) {
              triggerSessionTermination();
            }
          }
        })
        .catch(() => {});
    }, 1500);

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
    const sessionWithTime: StudentSession = {
      ...data,
      joined_at: data.joined_at || Math.floor(Date.now() / 1000),
    };
    setKioskMode(true);
    setSession(sessionWithTime);
    sessionRef.current = sessionWithTime;
    try {
      sessionStorage.setItem("fl_active_student_session", JSON.stringify(sessionWithTime));
    } catch {}
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
    try {
      sessionStorage.removeItem("fl_active_student_session");
    } catch {}
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
    <main className="min-h-screen p-3 sm:p-5 flex flex-col justify-between max-w-lg mx-auto w-full bg-[#FAF9F5] text-[#1E293B]">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E5E3DC] text-xs">
        <span className="font-semibold text-[#1B4D2E] flex items-center gap-1.5">
          📱 FocusLock Student Mobile
        </span>
        <a
          href="/"
          className="text-[#2E6B38] hover:text-[#25572D] font-semibold underline text-[11px]"
        >
          ← Teacher Dashboard
        </a>
      </div>

      {!session ? (
        <div className="my-auto py-6">
          {sessionEnded && (
            <div className="mb-4 p-4 bg-[#EEF8EE] border border-[#C8E6C9] rounded-xl text-xs text-[#1B4D2E] flex items-center gap-2 shadow-sm">
              <CheckCircle2 className="w-5 h-5 text-[#2E6B38] shrink-0" />
              <span className="font-semibold">Session ended by instructor. Returning to check-in…</span>
            </div>
          )}
          <QRScanner onSuccess={handlePunchSuccess} />
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-2">
          {/* Top Session Status Bar */}
          <div className="flex items-center justify-between bg-white border border-[#E5E3DC] px-4 py-2.5 rounded-xl shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#3B8246] animate-pulse" />
              <div>
                <span className="text-xs font-bold text-[#1E293B] block leading-tight">
                  {session.student_name}
                </span>
                <span className="text-[10px] font-mono text-[#64748B]">
                  {session.student_id} · CS-402
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleEmergency}
                className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
                title={`Immediate baseband emergency call (${emergencyNumber})`}
              >
                <PhoneCall className="w-3 h-3 text-rose-600" /> {emergencyNumber}
              </button>

              <button
                onClick={handleExit}
                className="p-1.5 bg-[#F1F0EA] hover:bg-[#E5E3DC] rounded-lg text-[#64748B] hover:text-[#1E293B] transition-colors"
                title="Exit Session"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Session Ended Notification */}
          {sessionEnded && (
            <div className="p-4 bg-[#EEF8EE] border border-[#C8E6C9] rounded-xl text-xs text-[#1B4D2E] flex flex-col gap-2.5 shadow-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#2E6B38] shrink-0" />
                <span className="font-semibold">Instructor stopped the session. Releasing locks and returning to Idle screen…</span>
              </div>
              <button
                onClick={() => {
                  setSession(null);
                  sessionRef.current = null;
                  setSessionEnded(false);
                  sessionEndedRef.current = false;
                }}
                className="w-full py-2 bg-[#2E6B38] hover:bg-[#25572D] text-white font-bold rounded-lg text-xs transition-colors shadow-sm"
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
      <footer className="text-center py-3 text-[11px] text-[#64748B]">
        FocusLock Zero-Trust Academic Intranet · Session-Scoped Kiosk
      </footer>

      {/* Custom Exit Confirmation Overlay — replaces window.confirm() which is blocked in fullscreen */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white border-2 border-amber-400 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center">
            <div className="w-14 h-14 bg-amber-50 border border-amber-200 rounded-full flex items-center justify-center mx-auto mb-3 text-amber-600">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-extrabold text-[#1E293B]">Exit Lecture Mode?</h2>
            <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
              Your early exit will be recorded on the faculty attendance board. Your attendance may be marked as <strong>Left in Middle</strong>.
            </p>
            <div className="flex flex-col gap-2 mt-5">
              <button
                onClick={handleConfirmExit}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-sm transition-colors shadow-sm"
              >
                Exit &amp; Record My Departure
              </button>
              <button
                onClick={() => setShowExitConfirm(false)}
                className="w-full py-2.5 bg-[#F1F0EA] hover:bg-[#E5E3DC] text-[#1E293B] font-semibold rounded-xl text-sm border border-[#E5E3DC] flex items-center justify-center gap-2 transition-colors"
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
