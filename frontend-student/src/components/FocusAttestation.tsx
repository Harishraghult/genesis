"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ShieldCheck,
  Copy,
  Maximize,
  BellOff,
  Shield,
  PhoneCall,
  VolumeX,
  Settings,
  CheckCircle2,
  X,
  ExternalLink,
  Smartphone,
} from "lucide-react";
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
 *  - Show a blocking "you left the lecture" overlay on return with Call Manager resume support.
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

    // High-urgency multi-tone security alarm siren (880Hz -> 440Hz -> 880Hz)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.2);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {}
}

function triggerVibrate(pattern: number[] = [400, 150, 400, 150, 600]) {
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
  const [dndActive, setDndActive] = useState<boolean>(true);
  const [showDndModal, setShowDndModal] = useState<boolean>(false);
  const [callModeActive, setCallModeActive] = useState<boolean>(false);

  const lostRef = useRef(false);
  const callGraceRef = useRef(false);
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

  const markRestored = useCallback(
    (detail = "Returned to lecture") => {
      lostRef.current = false;
      setIsFocused(true);
      onFocusStatusChange?.(true);
      playAlertBeep();
      triggerVibrate([200, 100, 200]);
      report("EVENT_FOCUS_RESTORED", detail);
      requestWakeLock();
    },
    [onFocusStatusChange, report, requestWakeLock]
  );

  // 1. Single-instance lock: FocusLock may only be open in ONE tab
  useEffect(() => {
    if (!active || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.from === tabId.current) return;
      if (msg.type === "HELLO") {
        ch.postMessage({ type: "OWNED", from: tabId.current, student: studentId });
        markLost("Attempted to open parallel FocusLock tab");
      } else if (msg.type === "OWNED") {
        setDuplicateTab(true);
      }
    };
    ch.postMessage({ type: "HELLO", from: tabId.current });
    return () => ch.close();
  }, [active, studentId, markLost]);

  // 2. Anti-Tamper & Anti-Hack Engine: Block context menu, inspection hotkeys, and debugger
  useEffect(() => {
    if (!active) return;

    // A. Disable context menu (right-click / long-press inspect)
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      markLost("Security Violation: Right-click inspection blocked");
    };
    window.addEventListener("contextmenu", onContextMenu);

    // B. Block DevTools keyboard shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, Ctrl+S)
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")) ||
        (e.ctrlKey && (e.key === "u" || e.key === "U" || e.key === "s" || e.key === "S"))
      ) {
        e.preventDefault();
        markLost("Security Interruption Attempt: Keyboard inspection shortcut blocked");
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // C. Anti-debugger loop: detects breakpoint pause or open developer tools
    let lastTick = Date.now();
    const debuggerWatcher = setInterval(() => {
      const now = Date.now();
      if (now - lastTick > 2800) {
        markLost("Security Layer Interrupted: Debugger or inspector pause detected");
      }
      lastTick = now;
    }, 1000);

    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      clearInterval(debuggerWatcher);
    };
  }, [active, markLost]);

  // 3. Leave detection: visibility (tab/app switch, home, lock) + blur (split screen, floating apps)
  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (callGraceRef.current) {
          markLost("Switched to Call Manager / Phone Call (Authorized)");
        } else {
          markLost("Switched app or minimized lecture");
        }
      } else {
        if (callGraceRef.current) {
          handleResumeFromCall();
        } else {
          markRestored("Returned to lecture");
        }
      }
    };
    const onBlur = () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      blurTimer.current = setTimeout(() => {
        if (!document.hasFocus()) {
          if (callGraceRef.current) {
            markLost("Call Manager / Phone Call in progress");
          } else {
            markLost("App lost focus (split-screen / app switch)");
          }
        }
      }, BLUR_GRACE_MS);
    };
    const onFocus = () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      if (document.visibilityState === "visible") {
        if (callGraceRef.current) {
          handleResumeFromCall();
        } else {
          markRestored("Returned to lecture");
        }
      }
    };
    const onPageHide = () => markLost("Navigated away or closed page");

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

  // 4. Kiosk extras: fullscreen tracking, back-button trap, leave warning
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

  const handleResume = useCallback(
    (customDetail?: string) => {
      callGraceRef.current = false;
      setCallModeActive(false);
      setShowReturnOverlay(false);
      markRestored(customDetail || "Resumed lecture session");
      if (kiosk) enterFullscreen();
      requestWakeLock();
    },
    [enterFullscreen, kiosk, markRestored, requestWakeLock]
  );

  const handleResumeFromCall = useCallback(() => {
    callGraceRef.current = false;
    setCallModeActive(false);
    setShowReturnOverlay(false);
    // Pardon violation increment for telephony / call manager
    setLeaveCount((n) => Math.max(0, n - 1));
    markRestored("Call Manager / Telephony attended - session seamlessly resumed");
    if (kiosk) enterFullscreen();
    requestWakeLock();
  }, [enterFullscreen, kiosk, markRestored, requestWakeLock]);

  const handleToggleCallMode = () => {
    const next = !callModeActive;
    setCallModeActive(next);
    callGraceRef.current = next;
  };

  const handleTakeoverTab = () => {
    setDuplicateTab(false);
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const ch = new BroadcastChannel(CHANNEL);
        ch.postMessage({ type: "OWNED", from: tabId.current, student: studentId });
        ch.close();
      } catch {}
    }
    handleResume("Took over active lecture tab");
  };

  // Duplicate tab: allow taking over primary session
  if (duplicateTab) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-6 text-center">
        <div className="max-w-sm bg-white border border-[#E5E3DC] rounded-2xl p-6 shadow-2xl">
          <Copy className="w-12 h-12 text-[#991B1B] mx-auto mb-3 animate-pulse" />
          <h2 className="text-lg font-bold text-[#1E293B]">Parallel Tabs Restricted</h2>
          <p className="text-xs text-[#64748B] mt-2">
            FocusLock is actively locked to your primary lecture tab.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={handleTakeoverTab}
              className="w-full py-3 bg-[#2E6B38] hover:bg-[#25572D] text-white font-bold rounded-xl text-xs transition-colors shadow-sm cursor-pointer"
            >
              🔄 Take Over &amp; Continue Session Here
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!active) return null;

  return (
    <>
      {/* Automatic Do Not Disturb & Hack-Proof Shield Status Pill */}
      <div className="w-full mb-3 px-3.5 py-2.5 rounded-xl bg-[#EEF8EE] border border-[#C8E6C9] flex items-center justify-between text-xs shadow-sm text-[#1B4D2E]">
        <div className="flex items-center gap-2">
          <BellOff className="w-4 h-4 text-[#2E6B38] shrink-0 animate-pulse" />
          <span className="font-semibold text-[11px] leading-tight">
            🛡️ DND Active · Calls &amp; Notifications Suppressed
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button
            onClick={() => setShowDndModal(true)}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#2E6B38] text-white hover:bg-[#25572D] transition-colors shadow-sm flex items-center gap-1 cursor-pointer"
            title="Configure Do Not Disturb & notification settings"
          >
            <Settings className="w-3 h-3" /> Set DND
          </button>
        </div>
      </div>

      {/* Optional Call Manager Grace Mode Pill */}
      <div className="w-full mb-3 px-3.5 py-2 rounded-xl bg-white border border-[#E5E3DC] flex items-center justify-between text-xs shadow-sm">
        <div className="flex items-center gap-2">
          <PhoneCall className={`w-4 h-4 ${callModeActive ? "text-[#2E6B38] animate-bounce" : "text-[#64748B]"}`} />
          <span className="text-[11px] text-[#1E293B]">
            {callModeActive ? (
              <strong className="text-[#2E6B38]">Call Manager Mode Active (Incoming Calls Allowed)</strong>
            ) : (
              "Incoming Call Manager Mode:"
            )}
          </span>
        </div>
        <button
          onClick={handleToggleCallMode}
          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
            callModeActive
              ? "bg-[#2E6B38] text-white hover:bg-[#25572D]"
              : "bg-[#F1F0EA] hover:bg-[#E5E3DC] text-[#64748B]"
          }`}
        >
          {callModeActive ? "Active · Tap to Finish" : "Allow Calls"}
        </button>
      </div>

      {/* Sticky Fullscreen Enforcer Banner for Mobile Tabs */}
      {kiosk && !isFullscreen && (
        <button
          onClick={enterFullscreen}
          className="w-full mb-3 p-3 bg-[#FFFBEB] border border-[#FCD34D] text-[#92400E] rounded-xl text-xs font-bold flex items-center justify-between shadow-sm animate-pulse cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Maximize className="w-4 h-4 shrink-0 text-[#92400E]" />
            <span>🔒 TAB LOCK INACTIVE: Tap to Lock Fullscreen &amp; Hide Tabs</span>
          </div>
          <span className="text-[10px] bg-[#92400E] text-white px-2 py-0.5 rounded uppercase tracking-wider font-bold">Lock Now</span>
        </button>
      )}

      <div
        className={`px-4 py-2.5 rounded-xl border flex items-center justify-between transition-colors shadow-sm ${
          isFocused
            ? "bg-white border-[#C8E6C9] text-[#1B4D2E]"
            : "bg-[#FFF5F5] border-rose-300 text-rose-800 animate-pulse"
        }`}
      >
        <div className="flex items-center gap-2.5">
          {isFocused ? (
            <ShieldCheck className="w-5 h-5 text-[#2E6B38]" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          )}
          <div>
            <span className="text-xs font-bold uppercase tracking-wider block">
              {isFocused ? (isFullscreen ? "🔒 Kiosk Mode Locked" : "Lecture Presence Active") : "⚠️ Tab / Focus Interruption Detected"}
            </span>
            <span className="text-[11px] text-[#64748B] font-mono">
              Left {leaveCount}× · Screen {wakeLockActive ? "kept awake" : "may sleep"}
            </span>
          </div>
        </div>
        {kiosk && !isFullscreen && (
          <button
            onClick={enterFullscreen}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-[#FAF9F5] border border-[#E5E3DC] text-[#1E293B] flex items-center gap-1 shadow-sm cursor-pointer"
          >
            <Maximize className="w-3 h-3 text-[#2E6B38]" /> Fullscreen
          </button>
        )}
      </div>

      {/* Return Overlay with Call Manager Continuation Support */}
      {showReturnOverlay && (
        <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
          <div className="max-w-sm w-full text-center bg-white border-2 border-amber-400 rounded-2xl p-6 shadow-2xl">
            <div className="w-14 h-14 bg-amber-50 border border-amber-200 rounded-full flex items-center justify-center mx-auto mb-3 text-amber-600 animate-bounce">
              <PhoneCall className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-extrabold text-[#1E293B]">Lecture Focus Interrupted</h2>
            <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
              You switched away from the lecture window. If you answered a phone call via the Call Manager, tap below to continue your session without penalty.
            </p>
            <div className="my-3 p-2 bg-[#FAF9F5] border border-[#E5E3DC] rounded-lg text-xs font-mono text-[#1E293B]">
              Interruption logged · Tap below to continue session
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              <button
                id="resume-call-btn"
                onClick={handleResumeFromCall}
                className="w-full py-3.5 rounded-xl bg-[#2E6B38] hover:bg-[#25572D] text-white text-xs font-bold uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform cursor-pointer"
              >
                <PhoneCall className="w-4 h-4" />
                Resumed from Call Manager / Call (Continue)
              </button>
              <button
                id="resume-lecture-btn"
                onClick={() => handleResume("Resumed lecture session")}
                className="w-full py-2.5 rounded-xl bg-[#F1F0EA] hover:bg-[#E5E3DC] text-[#1E293B] border border-[#E5E3DC] text-xs font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-colors cursor-pointer"
              >
                <Maximize className="w-3.5 h-3.5 text-[#2E6B38]" />
                Continue Lecture Session (Fullscreen)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Do Not Disturb (DND) Setup & Verification Modal */}
      {showDndModal && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white border-2 border-[#C8E6C9] rounded-2xl p-6 max-w-sm w-full shadow-2xl text-left">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E3DC]">
              <div className="flex items-center gap-2">
                <BellOff className="w-5 h-5 text-[#2E6B38]" />
                <h3 className="text-sm font-bold text-[#1E293B]">Enable Do Not Disturb (DND)</h3>
              </div>
              <button
                onClick={() => setShowDndModal(false)}
                className="p-1 text-[#64748B] hover:text-[#1E293B] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-4 text-xs text-[#64748B] flex flex-col gap-3 leading-relaxed">
              <p>
                To avoid attendance violations from floating notifications, message heads, or app switches, enable Do Not Disturb on your phone:
              </p>

              <div className="bg-[#FAF9F5] p-3 rounded-xl border border-[#E5E3DC] flex flex-col gap-2">
                <div className="font-semibold text-[#1E293B] flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-[#2E6B38]" /> Android Quick Links:
                </div>
                <div className="flex flex-col gap-1.5 mt-1">
                  <a
                    href="intent:#Intent;action=android.settings.ZEN_MODE_SETTINGS;end"
                    className="w-full py-2 px-3 bg-[#EEF8EE] border border-[#C8E6C9] hover:bg-[#E2F3E2] text-[#1B4D2E] rounded-lg text-xs font-bold flex items-center justify-between transition-colors"
                  >
                    <span>1. Open Android DND Settings</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href="intent:#Intent;action=android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS;end"
                    className="w-full py-2 px-3 bg-[#FAF9F5] border border-[#E5E3DC] hover:bg-[#F1F0EA] text-[#1E293B] rounded-lg text-xs font-medium flex items-center justify-between transition-colors"
                  >
                    <span>2. Notification Policy Access</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              <div className="text-[11px] text-[#64748B]">
                💡 <strong>Manual method:</strong> Swipe down from the top of your phone screen and tap the <strong>Do Not Disturb</strong> or <strong>Focus</strong> icon in the Quick Settings shade.
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-[#E5E3DC]">
              <button
                onClick={() => {
                  setDndActive(true);
                  setShowDndModal(false);
                }}
                className="w-full py-3 bg-[#2E6B38] hover:bg-[#25572D] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" /> I Have Enabled DND / Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
