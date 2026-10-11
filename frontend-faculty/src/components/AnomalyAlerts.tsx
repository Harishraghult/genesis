"use client";

import React from "react";
import { ShieldAlert, X, AlertOctagon, Smartphone, Volume2, Shield } from "lucide-react";

export interface AnomalyEvent {
  id: string;
  student_id: string;
  student_name: string;
  timestamp: number;
  message: string;
  title?: string;
  type?: "APP_SWITCH" | "FOCUS_LOST" | "NETWORK_ANOMALY" | "TAMPER_DETECTED";
  leave_count?: number;
}

interface AnomalyAlertsProps {
  alerts: AnomalyEvent[];
  onDismiss: (id: string) => void;
}

export default function AnomalyAlerts({ alerts, onDismiss }: AnomalyAlertsProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none">
      {alerts.map((alert) => {
        const isAppSwitch = alert.type === "APP_SWITCH" || alert.type === "FOCUS_LOST";
        const isTamper = alert.type === "TAMPER_DETECTED";

        const badgeColor = isTamper
          ? "text-red-300 bg-red-950/80 border-red-700"
          : isAppSwitch
          ? "text-amber-300 bg-amber-950/80 border-amber-700"
          : "text-rose-300 bg-rose-950/80 border-rose-700";

        const borderColor = isTamper
          ? "border-red-500 shadow-red-500/30"
          : isAppSwitch
          ? "border-amber-500 shadow-amber-500/30"
          : "border-rose-500 shadow-rose-500/30";

        return (
          <div
            key={alert.id}
            className={`pointer-events-auto bg-slate-950/95 border-2 ${borderColor} rounded-xl p-4 shadow-2xl text-slate-100 backdrop-blur-md animate-slide-up flex items-start justify-between gap-3`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                  isTamper
                    ? "bg-red-900/60 text-red-400"
                    : isAppSwitch
                    ? "bg-amber-900/60 text-amber-400"
                    : "bg-rose-900/60 text-rose-400"
                }`}
              >
                {isTamper ? (
                  <Shield className="w-5 h-5 animate-pulse text-red-400" />
                ) : isAppSwitch ? (
                  <Smartphone className="w-5 h-5 animate-bounce text-amber-400" />
                ) : (
                  <AlertOctagon className="w-5 h-5 animate-bounce text-rose-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColor} flex items-center gap-1`}
                  >
                    <Volume2 className="w-3 h-3 animate-pulse" />
                    {alert.title || (isAppSwitch ? "App Switch Violation" : isTamper ? "Security Tamper Attempt" : "Network Verification Needed")}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                  {alert.leave_count && alert.leave_count > 1 ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-900 text-rose-200 border border-rose-700">
                      Violation #{alert.leave_count}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm font-bold text-white mt-1">
                  {alert.student_name} <span className="font-mono text-cyan-300 text-xs">({alert.student_id})</span>
                </p>
                <p className="text-xs text-slate-300 mt-1 font-mono leading-relaxed bg-slate-900/90 p-2 rounded border border-slate-800">
                  {alert.message}
                </p>
              </div>
            </div>

            <button
              onClick={() => onDismiss(alert.id)}
              className="text-slate-400 hover:text-white p-1 rounded-md transition-colors shrink-0"
              title="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
