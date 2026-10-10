"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, RefreshCw, Clock, Wifi, Play, Loader2 } from "lucide-react";
import { getApiBase } from "@/lib/config";

interface QRData {
  is_active: boolean;
  totp_token: string;
  expires_in: number;
  session_id: string;
  timestamp?: number;
  step_interval?: number;
  qr_payload: string;
}

interface RollingQRProps {
  active: boolean;
  starting?: boolean;
  onStart: () => void;
}

export default function RollingQR({ active, starting, onStart }: RollingQRProps) {
  const [qrData, setQrData] = useState<QRData | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(15);
  const [error, setError] = useState<string | null>(null);
  const expiresAt = useRef<number>(0);

  const fetchQR = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/session/current-qr`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: QRData = await res.json();
      setError(null);
      if (!data.is_active) {
        setQrData(null);
        return;
      }
      setQrData(data);
      // +1s buffer so we fetch just after the server step rolls over
      expiresAt.current = Date.now() + (data.expires_in + 1) * 1000;
      setSecondsRemaining(data.expires_in);
    } catch (e: any) {
      setError("Cannot reach FocusLock backend. Check NEXT_PUBLIC_API_URL.");
    }
  }, []);

  // Fetch immediately whenever the session becomes active
  useEffect(() => {
    if (active) fetchQR();
    else setQrData(null);
  }, [active, fetchQR]);

  // Single 1s ticker: countdown + refetch on expiry
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((expiresAt.current - Date.now()) / 1000));
      setSecondsRemaining(left);
      if (left <= 0) fetchQR();
    }, 1000);
    return () => clearInterval(timer);
  }, [active, fetchQR]);

  const step = qrData?.step_interval || 15;
  const progressPercent = Math.min(100, (secondsRemaining / step) * 100).toFixed(1);

  if (!active) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-cyan-950/60 border border-cyan-800 flex items-center justify-center text-cyan-400">
          <Play className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">No Active Session</h2>
          <p className="text-xs text-slate-400 mt-1">
            Start the lecture session to project the rolling attendance QR code. Students cannot check in until you do.
          </p>
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <button
          id="start-session-btn"
          onClick={onStart}
          disabled={starting}
          className="w-full py-3 px-4 rounded-xl text-sm font-bold uppercase tracking-wider bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {starting ? "Starting..." : "Start Session & Show QR"}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center">
      <div className="w-full flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Live · Scan to Check In
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 rounded-full text-xs font-mono text-cyan-400 border border-slate-700">
          <Clock className="w-3.5 h-3.5" />
          <span>{secondsRemaining}s</span>
        </div>
      </div>

      <div className="relative p-4 bg-white rounded-xl shadow-inner flex items-center justify-center min-w-[260px] min-h-[260px]">
        {qrData ? (
          <QRCodeSVG value={qrData.qr_payload} size={240} level="M" includeMargin={true} />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-500 gap-2">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
            <span className="text-xs">Generating ephemeral token...</span>
          </div>
        )}
      </div>

      <div className="w-full mt-4">
        <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 rounded-full ${
              secondsRemaining <= 3 ? "bg-amber-500" : "bg-cyan-500"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="mt-4 w-full text-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest font-medium mb-1">
          Or type this code
        </div>
        <div className="text-4xl font-extrabold tracking-[0.3em] font-mono text-cyan-400 bg-slate-950/80 py-2 px-4 rounded-lg border border-slate-800 inline-block">
          {qrData?.totp_token || "------"}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

      <div className="mt-4 pt-4 border-t border-slate-800/80 w-full flex flex-col gap-2 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" /> Room network check:
          </span>
          <span className="font-mono text-slate-300 font-medium">On-device</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" /> Token:
          </span>
          <span className="font-mono text-emerald-400 font-medium">Rotates every {step}s</span>
        </div>
      </div>
    </div>
  );
}
