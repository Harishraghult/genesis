"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck, Copy, Maximize } from "lucide-react";
import { getApiBase } from "@/lib/config";

interface FocusAttestationProps {
  studentId: string;
  /** Student opted in to full kiosk containment (fullscreen, back-button trap, return overlay). */
  kiosk?: boolean;
  /** Containment runs only while the session is live. */
  active?: boolean;
  onFocusStatusChange?: (isFocused: boolean) => void;
}

const CHANNEL = "focuslock-tab-lock";
const BLUR_GRACE_MS = 1500; // ignore momentary blurs (e.g. notification shade peek)

/**
 * Browser-level focus containment.
 *
 * What a web app CAN do (implemented here):
 *  - Block FocusLock itself from running in two tabs at once (BroadcastChannel lock).
 *  - Detect leaving the lecture: tab switch, app switch, home button, split-screen / floating window.
 *  - Report focus loss to the class-wide aggregate (never shown per-student on the projector).
 *  - Keep the screen awake, request fullscreen, and trap the Android back button.
 *  - Show a blocking "you left the lecture" overlay on return.
 *
 * What a web app CANNOT do: physically stop the OS from opening other apps/tabs.
 * That requires the Android companion (screen pinning via startLockTask + VpnService).
 */
function playAlertBeep() {
  try {
    if (typeof window === "undefined") return;
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {}
}

function triggerVibrate(pattern: number[] = [300, 150, 300, 150, 500]) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

export default function FocusAttestation({
  studentId,
  kiosk = true,
  active = true,
  onFocusStatusChange,
}: FocusAttestationProps) {
  const [isFocused, setIsFocused] = useState<boolean>(true);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [leaveCount, setLeaveCount] = useState<number>(0);
  const [showReturnOverlay, setShowReturnOverlay] = useState<boolean>(false);
  const [duplicateTab, setDuplicateTab] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const lostRef = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const tabId = useRef<string>(Math.random().toString(36).slice(2));

  const report = useCallback(
    (event_type: "EVENT_FOCUS_LOST" | "EVENT_FOCUS_RESTORED", detail: string) => {
      try {
        fetch(`${getApiBase()}/api/attendance/focus-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, event_type, detail }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    },
    [studentId]
  );

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible") {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        setWakeLockActive(true);
        wakeLockRef.current.addEventListener("release", () => setWakeLockActive(false));
      }
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const enterFullscreen = useCallback(() => {
    const el: any = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req && !document.fullscreenElement) {
      try {
        const p = req.call(el, { navigationUI: "hide" });
        if (p && p.catch) p.catch(() => {});
      } catch {}
    }
  }, []);

  const markLost = useCallback(
    (detail: string) => {
      if (lostRef.current) return;
      lostRef.current = true;
      setIsFocused(false);
      setLeaveCount((n) => n + 1);
      onFocusStatusChange?.(false);
      playAlertBeep();
      triggerVibrate();
      setShowReturnOverlay(true);
      report("EVENT_FOCUS_LOST", detail);
    },
    [onFocusStatusChange, report]
  );

  const markRestored = useCallback(() => {
    if (!lostRef.current) return;
    lostRef.current = false;
    setIsFocused(true);
    onFocusStatusChange?.(true);
    playAlertBeep();
    triggerVibrate([200, 100, 200]);
    report("EVENT_FOCUS_RESTORED", "Returned to lecture");
    if (kiosk) setShowReturnOverlay(true);
    requestWakeLock();
  }, [kiosk, onFocusStatusChange, report, requestWakeLock]);

  // 1. Single-instance lock: FocusLock may only be open in ONE tab
  useEffect(() => {
    if (!active || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.from === tabId.current) return;
      if (msg.type === "HELLO") {
        // Another FocusLock tab just opened: tell it we own the session
        ch.postMessage({ type: "OWNED", from: tabId.current, student: studentId });
        markLost("Attempted to open parallel FocusLock tab");
      } else if (msg.type === "OWNED") {
        setDuplicateTab(true);
      }
    };
    ch.postMessage({ type: "HELLO", from: tabId.current });
    return () => ch.close();
  }, [active, studentId, markLost]);

  // 2. Leave detection: visibility (tab/app switch, home, lock) + blur (split screen, floating apps)
  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        markLost("Switched tab or minimized browser");
      } else {
        markRestored();
      }
    };
    const onBlur = () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      blurTimer.current = setTimeout(() => {
        if (!document.hasFocus()) markLost("Lecture window lost focus (split-screen / tab change)");
      }, BLUR_GRACE_MS);
    };
    const onFocus = () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      if (document.visibilityState === "visible") markRestored();
    };
    const onPageHide = () => markLost("Page closed or navigated away");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    requestWakeLock();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      if (blurTimer.current) clearTimeout(blurTimer.current);
      wakeLockRef.current?.release?.().catch(() => {});
    };
  }, [active, markLost, markRestored, requestWakeLock]);

  // 3. Kiosk extras: fullscreen tracking, back-button trap, leave warning
  useEffect(() => {
    if (!active || !kiosk) return;

    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    onFs();

    // Trap Android back gesture/button inside the lecture
    history.pushState({ focuslock: true }, "");
    const onPop = () => {
      history.pushState({ focuslock: true }, "");
      playAlertBeep();
      triggerVibrate();
      setShowReturnOverlay(true);
    };
    window.addEventListener("popstate", onPop);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "FocusLock lecture is active. Leaving records an attendance violation.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, kiosk]);

  const handleResume = () => {
    setShowReturnOverlay(false);
    if (kiosk) enterFullscreen();
    requestWakeLock();
  };

  // Duplicate tab: block this copy entirely
  if (duplicateTab) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm bg-rose-950/90 border border-rose-600 rounded-2xl p-6 shadow-2xl">
          <Copy className="w-12 h-12 text-rose-400 mx-auto mb-3 animate-pulse" />
          <h2 className="text-lg font-bold text-white">Parallel Tabs Restricted</h2>
          <p className="text-xs text-rose-200 mt-2">
            FocusLock is actively locked to your primary lecture tab. Parallel tabs and multi-tab browsing are strictly restricted.
          </p>
          <p className="text-[11px] text-slate-400 mt-3 font-mono">
            Close this tab and return to your active lecture session.
          </p>
        </div>
      </div>
    );
  }

  if (!active) return null;

  return (
    <>
      {/* Sticky Fullscreen Enforcer Banner for Mobile Tabs */}
      {kiosk && !isFullscreen && (
        <button
          onClick={enterFullscreen}
          className="w-full mb-3 p-3 bg-gradient-to-r from-amber-600 to-rose-600 text-white rounded-xl text-xs font-bold flex items-center justify-between shadow-lg shadow-rose-950/50 animate-pulse border border-amber-400"
        >
          <div className="flex items-center gap-2">
            <Maximize className="w-4 h-4 shrink-0" />
            <span>🔒 TAB LOCK INACTIVE: Tap to Lock Fullscreen & Hide Tabs</span>
          </div>
          <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase tracking-wider">Lock Now</span>
        </button>
      )}

      <div
        className={`px-4 py-2.5 rounded-xl border flex items-center justify-between transition-colors shadow-lg ${
          isFocused
            ? "bg-slate-900/90 border-emerald-500/30 text-emerald-300"
            : "bg-rose-950/90 border-rose-500 text-rose-200 animate-pulse"
        }`}
      >
        <div className="flex items-center gap-2.5">
          {isFocused ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          )}
          <div>
            <span className="text-xs font-bold uppercase tracking-wider block">
              {isFocused ? (isFullscreen ? "🔒 Kiosk Mode Locked" : "Lecture Presence Active") : "⚠️ Tab / Focus Violation Detected"}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              Left {leaveCount}× · Screen {wakeLockActive ? "kept awake" : "may sleep"}
            </span>
          </div>
        </div>
        {kiosk && !isFullscreen && (
          <button
            onClick={enterFullscreen}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1"
          >
            <Maximize className="w-3 h-3" /> Fullscreen
          </button>
        )}
      </div>

      {showReturnOverlay && (
        <div className="fixed inset-0 z-[90] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
          <div className="max-w-sm w-full text-center bg-slate-900 border-2 border-rose-600 rounded-2xl p-6 shadow-2xl">
            <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 rounded-full flex items-center justify-center mx-auto mb-3 text-rose-400 animate-bounce">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-extrabold text-white">Focus Violation Detected</h2>
            <p className="text-xs text-rose-200/90 mt-2">
              You switched away from FocusLock or switched tabs. Tab switching is restricted during lecture containment.
            </p>
            <div className="my-3 p-2 bg-slate-950 border border-rose-900/60 rounded-lg text-xs font-mono text-rose-300">
              Violations recorded: {leaveCount}× this session
            </div>
            <p className="text-[11px] text-slate-400 italic">
              Attendance verification requires maintaining foreground presence in lecture materials.
            </p>
            <button
              id="resume-lecture-btn"
              onClick={handleResume}
              className="mt-5 w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 text-xs font-bold uppercase tracking-wider shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-transform"
            >
              Re-Engage Lecture Lock (Fullscreen)
            </button>
          </div>
        </div>
      )}
    </>
  );
}
