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
    <div className="bg-white border border-[#E5E3DC] rounded-2xl p-5 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-bold text-[#1E293B] uppercase tracking-wider">
              30-Second Presence Pulse
            </h3>
          </div>
          {pulseActive ? (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold text-amber-800 bg-[#FEF3C7] border border-[#FCD34D] animate-pulse">
              <Timer className="w-3.5 h-3.5" /> {countdown}s remaining
            </span>
          ) : (
            <span className="text-xs text-[#64748B] font-mono bg-[#FAF9F5] px-2.5 py-0.5 rounded-full border border-[#E5E3DC]">Idle</span>
          )}
        </div>

        <p className="text-xs text-[#64748B] leading-relaxed mb-4">
          Broadcasts an unannounced pop quiz to all student mobile devices to confirm active human presence in room.
        </p>

        {pulseActive && (
          <div className="mb-4 bg-[#FAF9F5] p-3 rounded-xl border border-[#E5E3DC]">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-[#64748B] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#2E6B38]" /> Submissions Received:
              </span>
              <span className="font-mono text-[#2E6B38] font-bold">
                {pulseResponsesCount} / {totalStudentsCount}
              </span>
            </div>
            <div className="w-full bg-[#E5E3DC] h-2 rounded-full overflow-hidden">
              <div
                className="bg-amber-500 h-full transition-all duration-300 rounded-full"
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
            ? "bg-[#F1F0EA] text-[#64748B] cursor-not-allowed border border-[#E5E3DC]"
            : "bg-[#2E6B38] hover:bg-[#25572D] text-white shadow-sm active:scale-[0.98]"
        }`}
      >
        <Send className="w-4 h-4" />
        {triggering ? "Broadcasting..." : pulseActive ? "Pulse In Progress" : "Trigger 30s Presence Pulse"}
      </button>
    </div>
  );
}
