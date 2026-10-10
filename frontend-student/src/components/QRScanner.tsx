"use client";

import React, { useState, useEffect } from "react";
import { Camera, KeyRound, Wifi, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";
import { getApiBase } from "@/lib/config";

interface QRScannerProps {
  onSuccess: (data: {
    student_id: string;
    student_name: string;
    session_id: string;
    session_token: string;
    session_secret: string;
    status: string;
  }) => void;
}

export default function QRScanner({ onSuccess }: QRScannerProps) {
  const [studentId, setStudentId] = useState<string>("21CS074");
  const [studentName, setStudentName] = useState<string>("Rohan Iyer");
  const [totpToken, setTotpToken] = useState<string>("");
  const [reportedBssid, setReportedBssid] = useState<string>("BSSID_ROOM_302");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);

  useEffect(() => {
    let html5QrCode: any;

    if (cameraActive && typeof window !== "undefined") {
      // Dynamic import to prevent SSR issues with html5-qrcode
      import("html5-qrcode").then(({ Html5Qrcode }) => {
        html5QrCode = new Html5Qrcode("qr-reader");
        html5QrCode
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            (decodedText: string) => {
              try {
                const parsed = JSON.parse(decodedText);
                if (parsed.totp) {
                  setTotpToken(parsed.totp);
                  if (parsed.bssid) setReportedBssid(parsed.bssid);
                  html5QrCode.stop().then(() => setCameraActive(false));
                }
              } catch {
                if (/^\d{6}$/.test(decodedText.trim())) {
                  setTotpToken(decodedText.trim());
                  html5QrCode.stop().then(() => setCameraActive(false));
                }
              }
            },
            () => {}
          )
          .catch((err: any) => {
            console.warn("Camera start error:", err);
            setCameraActive(false);
          });
      });
    }

    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [cameraActive]);

  const handlePunchIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !studentName || !totpToken) {
      setErrorMsg("Please fill in Student ID, Name, and the 6-digit TOTP code.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      // On-device privacy matching: match against room APs locally and send boolean attestation
      const isRoomApMatch = reportedBssid.trim().toUpperCase().includes("ROOM_302");
      const payload = {
        student_id: studentId.trim(),
        student_name: studentName.trim(),
        totp_token: totpToken.trim(),
        bssid_match: isRoomApMatch,
        // Data minimization: raw BSSID and device identifier are NOT transmitted
        is_simulation: false,
      };

      const res = await fetch(`${getApiBase()}/api/attendance/punch-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.status === "ERROR") {
        setErrorMsg(data.message || "Attendance verification failed.");
      } else {
        // Successful punch-in (or flagged proxy)
        onSuccess({
          student_id: data.student_id,
          student_name: data.student_name,
          session_id: "FL-CS402-2026",
          session_token: data.session_token || "",
          session_secret: data.session_secret || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
          status: data.status,
        });
      }
    } catch (err: any) {
      setErrorMsg("Failed to reach FocusLock gate: " + (err.message || "Network Error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
      <div className="text-center mb-5">
        <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-3 text-emerald-400">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-100">FocusLock Student Check-In</h2>
        <p className="text-xs text-slate-400 mt-1">
          Scan the rolling TOTP code projected on the classroom board to enter Lecture Mode.
        </p>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Camera Viewport or Toggle */}
      {cameraActive ? (
        <div className="mb-4 rounded-xl overflow-hidden border border-slate-700 bg-black relative">
          <div id="qr-reader" className="w-full"></div>
          <button
            type="button"
            onClick={() => setCameraActive(false)}
            className="w-full py-2 bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
          >
            Cancel Camera Scan
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCameraActive(true)}
          className="w-full mb-4 py-2.5 px-4 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <Camera className="w-4 h-4 text-emerald-400" />
          Scan QR With Camera
        </button>
      )}

      {/* Form Fields */}
      <form onSubmit={handlePunchIn} className="flex flex-col gap-3.5">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Student ID
          </label>
          <input
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
            placeholder="e.g. 21CS074"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Full Name
          </label>
          <input
            type="text"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
            placeholder="e.g. Rohan Iyer"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
            Rolling 6-Digit TOTP Token
          </label>
          <div className="relative">
            <input
              type="text"
              maxLength={6}
              value={totpToken}
              onChange={(e) => setTotpToken(e.target.value)}
              required
              className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono tracking-widest text-emerald-400 focus:outline-none focus:border-emerald-500"
              placeholder="e.g. 849201"
            />
            <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1 flex items-center justify-between">
            <span>Room Wi-Fi Attestation</span>
            <span className="text-[10px] text-emerald-400 font-mono">Matched On-Device</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={reportedBssid}
              onChange={(e) => setReportedBssid(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-mono text-slate-400 focus:outline-none"
            />
            <Wifi className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
        >
          {loading ? "Attesting In-Room Presence..." : "Verify & Enter Lecture Mode"}
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
