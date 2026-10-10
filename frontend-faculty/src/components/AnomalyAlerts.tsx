"use client";

import React from "react";
import { ShieldAlert, X, AlertOctagon } from "lucide-react";

export interface AnomalyEvent {
  id: string;
  student_id: string;
  student_name: string;
  timestamp: number;
  message: string;
}

interface AnomalyAlertsProps {
  alerts: AnomalyEvent[];
  onDismiss: (id: string) => void;
}

export default function AnomalyAlerts({ alerts, onDismiss }: AnomalyAlertsProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="pointer-events-auto bg-rose-950/95 border-2 border-rose-500/80 rounded-xl p-4 shadow-2xl text-slate-100 backdrop-blur-md animate-slide-up flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 bg-rose-900/60 rounded-lg text-rose-300 shrink-0 mt-0.5">
              <AlertOctagon className="w-5 h-5 text-rose-400 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  Network Verification Needed
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {new Date(alert.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-sm font-semibold text-white mt-0.5">
                {alert.student_name} ({alert.student_id})
              </p>
              <p className="text-xs text-rose-200/90 mt-1 font-mono leading-relaxed bg-rose-900/40 p-1.5 rounded border border-rose-800/60">
                {alert.message}
              </p>
            </div>
          </div>

          <button
            onClick={() => onDismiss(alert.id)}
            className="text-rose-400 hover:text-white p-1 rounded-md transition-colors"
            title="Dismiss alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
