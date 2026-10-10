"use client";

import React, { useState, useEffect } from "react";
import { Zap, Timer, CheckCircle2, Send } from "lucide-react";

interface PresencePulseProps {
  onTriggerPulse: () => Promise<void>;
  pulseActive: boolean;
  pulseResponsesCount: number;
  totalStudentsCount: number;
}

export default function PresencePulse({
  onTriggerPulse,
  pulseActive,
  pulseResponsesCount,
  totalStudentsCount,
}: PresencePulseProps) {
  const [countdown, setCountdown] = useState<number>(30);
  const [triggering, setTriggering] = useState<boolean>(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (pulseActive) {
      setCountdown(30);
      timer = setInterval(() => {
        setCountdown((c) => (c > 0 ? c - 1 : 0));
      }, 1000);
    } else {
      setCountdown(30);
    }
    return () => clearInterval(timer);
  }, [pulseActive]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await onTriggerPulse();
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              30-Second Presence Pulse
            </h3>
          </div>
          {pulseActive ? (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold text-amber-400 bg-amber-950/80 border border-amber-700 animate-pulse">
              <Timer className="w-3.5 h-3.5" /> {countdown}s remaining
            </span>
          ) : (
            <span className="text-xs text-slate-400 font-mono">Idle</span>
          )}
        </div>

        <p className="text-xs text-slate-400 leading-relaxed mb-4">
          Broadcasts an unannounced pop quiz to all student mobile devices to confirm active human presence in room.
        </p>

        {pulseActive && (
          <div className="mb-4 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Submissions Received:
              </span>
              <span className="font-mono text-emerald-400 font-bold">
                {pulseResponsesCount} / {totalStudentsCount}
              </span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-amber-400 h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${totalStudentsCount > 0 ? (pulseResponsesCount / totalStudentsCount) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleTrigger}
        disabled={pulseActive || triggering}
        className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
          pulseActive
            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
            : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 active:scale-[0.98]"
        }`}
      >
        <Send className="w-4 h-4" />
        {triggering ? "Broadcasting..." : pulseActive ? "Pulse In Progress" : "Trigger 30s Presence Pulse"}
      </button>
    </div>
  );
}
