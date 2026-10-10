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
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
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
      report("EVENT_FOCUS_LOST", detail);
    },
    [onFocusStatusChange, report]
  );

  const markRestored = useCallback(() => {
    if (!lostRef.current) return;
    lostRef.current = false;
    setIsFocused(true);
    onFocusStatusChange?.(true);
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
      } else if (msg.type === "OWNED") {
        setDuplicateTab(true);
      }
    };
    ch.postMessage({ type: "HELLO", from: tabId.current });
    return () => ch.close();
  }, [active, studentId]);

  // 2. Leave detection: visibility (tab/app switch, home, lock) + blur (split screen, floating apps)
  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") markLost("Switched tab or app");
      else markRestored();
    };
    const onBlur = () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      blurTimer.current = setTimeout(() => {
        if (!document.hasFocus()) markLost("Lecture window lost focus (split-screen / overlay)");
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
    onFs();

    // Trap Android back gesture/button inside the lecture
    history.pushState({ focuslock: true }, "");
    const onPop = () => {
      history.pushState({ focuslock: true }, "");
      setShowReturnOverlay(true);
    };
    window.addEventListener("popstate", onPop);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("fullscreenchange", onFs);
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
      <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-sm text-center bg-slate-900 border border-rose-800 rounded-2xl p-6 shadow-2xl">
          <Copy className="w-10 h-10 text-rose-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white">FocusLock is already open</h2>
          <p className="text-xs text-slate-400 mt-2">
            Your lecture session is running in another tab or window. Only one FocusLock window is allowed per session.
            Close this tab and return to the original.
          </p>
        </div>
      </div>
    );
  }

  if (!active) return null;

  return (
    <>
      <div
        className={`px-4 py-2.5 rounded-xl border flex items-center justify-between transition-colors shadow-lg ${
          isFocused
            ? "bg-slate-900/90 border-emerald-500/30 text-emerald-300"
            : "bg-amber-950/90 border-amber-500 text-amber-200 animate-pulse"
        }`}
      >
        <div className="flex items-center gap-2.5">
          {isFocused ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          )}
          <div>
            <span className="text-xs font-bold uppercase tracking-wider block">
              {isFocused ? (kiosk ? "Lecture Kiosk Active" : "Presence Active") : "You left the lecture"}
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
        <div className="fixed inset-0 z-[90] bg-slate-950/95 backdrop-blur flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center bg-slate-900 border border-amber-700 rounded-2xl p-6 shadow-2xl">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-white">You left the lecture</h2>
            <p className="text-xs text-slate-400 mt-2">
              Switching apps or tabs is recorded in the class-wide focus index ({leaveCount}× this session). It is never
              shown by name on the projector and never affects grades automatically.
            </p>
            <button
              id="resume-lecture-btn"
              onClick={handleResume}
              className="mt-5 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold"
            >
              Return to Lecture
            </button>
          </div>
        </div>
      )}
    </>
  );
}
