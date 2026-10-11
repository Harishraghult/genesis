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
          ? "text-red-800 bg-red-50 border-red-200"
          : isAppSwitch
          ? "text-amber-800 bg-amber-50 border-amber-200"
          : "text-rose-800 bg-rose-50 border-rose-200";

        const borderColor = isTamper
          ? "border-red-400 shadow-red-100"
          : isAppSwitch
          ? "border-amber-400 shadow-amber-100"
          : "border-rose-400 shadow-rose-100";

        return (
          <div
            key={alert.id}
            className={`pointer-events-auto bg-white/95 border-2 ${borderColor} rounded-2xl p-4 shadow-xl text-[#1E293B] backdrop-blur-md animate-slide-up flex items-start justify-between gap-3`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                  isTamper
                    ? "bg-red-50 text-red-600"
                    : isAppSwitch
                    ? "bg-amber-50 text-amber-600"
                    : "bg-rose-50 text-rose-600"
                }`}
              >
                {isTamper ? (
                  <Shield className="w-5 h-5 animate-pulse text-red-600" />
                ) : isAppSwitch ? (
                  <Smartphone className="w-5 h-5 animate-bounce text-amber-600" />
                ) : (
                  <AlertOctagon className="w-5 h-5 animate-bounce text-rose-600" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md border ${badgeColor} flex items-center gap-1`}
                  >
                    <Volume2 className="w-3 h-3 animate-pulse" />
                    {alert.title || (isAppSwitch ? "App Switch Violation" : isTamper ? "Security Tamper Attempt" : "Network Verification Needed")}
                  </span>
                  <span className="text-[10px] text-[#64748B] font-mono">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                  {alert.leave_count && alert.leave_count > 1 ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 border border-rose-200">
                      Violation #{alert.leave_count}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm font-bold text-[#1E293B] mt-1">
                  {alert.student_name} <span className="font-mono text-[#2E6B38] text-xs font-semibold">({alert.student_id})</span>
                </p>
                <p className="text-xs text-[#475569] mt-1 font-mono leading-relaxed bg-[#FAF9F5] p-2 rounded-lg border border-[#E5E3DC]">
                  {alert.message}
                </p>
              </div>
            </div>

            <button
              onClick={() => onDismiss(alert.id)}
              className="text-[#94A3B8] hover:text-[#1E293B] p-1 rounded-md transition-colors shrink-0"
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
