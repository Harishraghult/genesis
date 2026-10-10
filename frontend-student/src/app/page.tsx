"use client";

import React, { useState, useEffect } from "react";
import QRScanner from "@/components/QRScanner";
import FocusAttestation from "@/components/FocusAttestation";
import CourseViewer from "@/components/CourseViewer";
import QuizModal from "@/components/QuizModal";
import { studentWsClient } from "@/lib/websocket";
import { getApiBase } from "@/lib/config";
import { Shield, LogOut, CheckCircle2, AlertOctagon, PhoneCall } from "lucide-react";

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
  const [pendingConsentSession, setPendingConsentSession] = useState<StudentSession | null>(null);
  const [pulseQuiz, setPulseQuiz] = useState<any | null>(null);
  const [sessionEnded, setSessionEnded] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = studentWsClient.subscribe((msg: any) => {
      // console.log("[Student WS Event]:", msg);

      if (msg.type === "PRESENCE_PULSE_START") {
        setPulseQuiz(msg.quiz);
      } else if (msg.type === "SESSION_ENDED") {
        setSessionEnded(true);
      }
    });

    return () => unsubscribe();
  }, []);

  const [emergencyNumber, setEmergencyNumber] = useState<string>("112");

  useEffect(() => {
    fetch(`${getApiBase()}/api/session/status`)
      .then((res) => res.json())
      .then((data) => {
        if (data.emergency_number) {
          setEmergencyNumber(data.emergency_number);
        }
      })
      .catch(() => {});
  }, []);

  const handlePunchSuccess = (data: StudentSession) => {
    // Show opt-in consent and pre-prompt screen first (Item 8)
    setPendingConsentSession(data);
  };

  const handleConfirmConsent = (enableKiosk: boolean) => {
    if (!pendingConsentSession) return;
    setSession(pendingConsentSession);
    setPendingConsentSession(null);

    if (enableKiosk && typeof document !== "undefined" && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const handleExit = () => {
    if (confirm("Exit FocusLock Lecture Mode? Your exit will be logged to the faculty board.")) {
      setSession(null);
      setPendingConsentSession(null);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  const handleEmergency = () => {
    // 1. Tear down session and restrictions locally FIRST without waiting for server response
    setSession(null);
    setPendingConsentSession(null);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    // 2. Clear local locks and redirect immediately to regional emergency dialer
    window.location.href = `tel:${emergencyNumber}`;
  };

  return (
    <main className="min-h-screen p-3 sm:p-5 flex flex-col justify-between max-w-lg mx-auto w-full">
      {pendingConsentSession ? (
        /* OPT-IN PRE-PROMPT SCREEN (Item 8) */
        <div className="my-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 animate-fade-in">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Focus Containment Opt-In</h2>
              <p className="text-xs text-slate-400">Welcome, {pendingConsentSession.student_name}</p>
            </div>
          </div>

          <div className="text-xs text-slate-300 space-y-2.5 leading-relaxed bg-slate-950/80 p-4 rounded-xl border border-slate-800">
            <div>
              <span className="font-semibold text-emerald-400 block mb-0.5">What FocusLock Does:</span>
              <span>Monitors whether this lecture window remains active. Full screen kiosk containment helps you focus on lecture materials.</span>
            </div>
            <div>
              <span className="font-semibold text-cyan-400 block mb-0.5">What FocusLock NEVER Does:</span>
              <span>Zero traffic sniffing, zero inspection of personal apps, zero logging of external browsing. Traffic is never rerouted.</span>
            </div>
            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 italic">
              Privacy guarantee: Foreground presence detection alone provides full class attendance verification.
            </div>
          </div>

          <div className="flex flex-col gap-2.5 pt-2">
            <button
              onClick={() => handleConfirmConsent(true)}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Opt-In to Full Focus Containment (Kiosk Mode)
            </button>

            <button
              onClick={() => handleConfirmConsent(false)}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors border border-slate-700"
            >
              Foreground Presence Only (No Kiosk Containment)
            </button>
          </div>
        </div>
      ) : !session ? (
        <div className="my-auto py-6">
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
            <div className="p-3 bg-cyan-950/80 border border-cyan-800 rounded-xl text-xs text-cyan-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>The instructor has concluded the lecture session. Locks released.</span>
            </div>
          )}

          {/* Focus Attestation & Visibility Guard */}
          <FocusAttestation studentId={session.student_id} />

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
    </main>
  );
}
