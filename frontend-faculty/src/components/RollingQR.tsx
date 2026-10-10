"use client";

import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, RefreshCw, Clock, Wifi } from "lucide-react";
import { getApiBase } from "@/lib/config";

interface QRData {
  totp_token: string;
  expires_in: number;
  session_id: string;
  timestamp: number;
  step_interval: number;
  qr_payload: string;
}

export default function RollingQR() {
  const [qrData, setQrData] = useState<QRData | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(15);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchQR = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/session/current-qr`);
      if (res.ok) {
        const data: QRData = await res.json();
        setQrData(data);
        setSecondsRemaining(data.expires_in);
      }
    } catch (e) {
      console.error("Failed to fetch rolling QR:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQR();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          fetchQR();
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const progressPercent = ((secondsRemaining / (qrData?.step_interval || 15)) * 100).toFixed(1);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center">
      <div className="w-full flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Rolling Attendance Gate
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 rounded-full text-xs font-mono text-cyan-400 border border-slate-700">
          <Clock className="w-3.5 h-3.5" />
          <span>{secondsRemaining}s rotation</span>
        </div>
      </div>

      {/* QR Code Container */}
      <div className="relative p-4 bg-white rounded-xl shadow-inner flex items-center justify-center min-w-[240px] min-h-[240px]">
        {qrData ? (
          <QRCodeSVG
            value={qrData.qr_payload}
            size={220}
            level="H"
            includeMargin={true}
            className="transition-all duration-300"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-500 gap-2">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
            <span className="text-xs">Generating ephemeral token...</span>
          </div>
        )}
      </div>

      {/* Progress Countdown Bar */}
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

      {/* Projected 6-Digit TOTP Token for Class */}
      <div className="mt-4 w-full text-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest font-medium mb-1">
          Dynamic Session Token
        </div>
        <div className="text-3xl font-extrabold tracking-widest font-mono text-cyan-400 bg-slate-950/80 py-1.5 px-4 rounded-lg border border-slate-800 inline-block">
          {qrData?.totp_token || "------"}
        </div>
      </div>

      {/* Security Attestation Badges */}
      <div className="mt-4 pt-4 border-t border-slate-800/80 w-full flex flex-col gap-2 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" /> Room Subnet:
          </span>
          <span className="font-mono text-slate-300 font-medium">BSSID_ROOM_302</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" /> Cryptographic Gate:
          </span>
          <span className="font-mono text-emerald-400 font-medium">HMAC-SHA256 Active</span>
        </div>
      </div>
    </div>
  );
}
