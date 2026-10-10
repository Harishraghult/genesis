"use client";

import React, { useEffect, useState } from "react";
import { Lock, AlertTriangle, ShieldCheck, Sun } from "lucide-react";
import { getApiBase } from "@/lib/config";

interface FocusAttestationProps {
  studentId: string;
  onFocusStatusChange?: (isFocused: boolean) => void;
}

export default function FocusAttestation({
  studentId,
  onFocusStatusChange,
}: FocusAttestationProps) {
  const [isFocused, setIsFocused] = useState<boolean>(true);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [distractionCount, setDistractionCount] = useState<number>(0);

  useEffect(() => {
    // 1. Acquire Screen Wake Lock if supported
    let wakeLockSentinel: any = null;
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
          setWakeLockActive(true);
          wakeLockSentinel.addEventListener("release", () => {
            setWakeLockActive(false);
          });
        }
      } catch (err) {
        console.warn("Wake lock request failed:", err);
      }
    };
    requestWakeLock();

    // 2. Setup Page Visibility Listener
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "hidden") {
        setIsFocused(false);
        setDistractionCount((prev) => prev + 1);
        onFocusStatusChange?.(false);

        // Notify server immediately of focus loss
        try {
          fetch(`${getApiBase()}/api/attendance/focus-event`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              student_id: studentId,
              event_type: "EVENT_FOCUS_LOST",
              detail: "User minimized browser or switched tabs",
            }),
            keepalive: true,
          });
        } catch (e) {
          console.warn("Failed to dispatch focus loss event:", e);
        }
      } else {
        setIsFocused(true);
        onFocusStatusChange?.(true);

        // Notify server of focus restore
        try {
          fetch(`${getApiBase()}/api/attendance/focus-event`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              student_id: studentId,
              event_type: "EVENT_FOCUS_RESTORED",
              detail: "User returned to lecture browser tab",
            }),
          });
        } catch (e) {
          console.warn("Failed to dispatch focus restored event:", e);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, [studentId, onFocusStatusChange]);

  return (
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
            {isFocused ? "Lecture Kiosk Active" : "Focus Lost (Proctor Flagged)"}
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            {isFocused
              ? "Screen pinned to course slides"
              : `Tab switch detected (${distractionCount} violation recorded)`}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
        <Sun className={`w-3 h-3 ${wakeLockActive ? "text-amber-400" : "text-slate-600"}`} />
        <span>{wakeLockActive ? "Wake Lock ON" : "Normal Display"}</span>
      </div>
    </div>
  );
}
