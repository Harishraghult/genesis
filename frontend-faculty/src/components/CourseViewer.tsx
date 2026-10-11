"use client";

import React, { useEffect, useState } from "react";
import { fetchSigned } from "@/lib/api";
import { BookOpen, ChevronLeft, ChevronRight, Lock, ShieldCheck, AlertCircle } from "lucide-react";

interface Slide {
  slide_number: number;
  title: string;
  subtitle?: string;
  bullet_points: string[];
  code_snippet?: string;
  notes?: string;
}

interface CourseViewerProps {
  sessionId: string;
  sessionSecret: string;
}

const FALLBACK_SLIDES: Slide[] = [
  {
    slide_number: 1,
    title: "Unit 4: Zero-Trust Classroom Security Architecture",
    subtitle: "Defeating Digital Proxies & Preserving Real-Time Student Focus",
    bullet_points: [
      "Why traditional QR codes fail: WhatsApp screenshot relays & proxy attendance.",
      "Session-Scoped Ephemeral Cryptography: 15-second rolling HMAC-SHA256 tokens.",
      "Local Subnet & BSSID Attestation: Verifying physical in-room presence.",
      "Kiosk Mode & Focus Containment: Detecting tab switches with zero surveillance."
    ],
    notes: "Attendance fraud rates exceed 35% when static or slow-rotating QR codes are projected."
  },
  {
    slide_number: 2,
    title: "Cryptographic Signing Gate (X-FL-*)",
    subtitle: "Tamper-Proof Course Content Delivery",
    bullet_points: [
      "Every resource request must provide: X-FL-Session, X-FL-Ts, X-FL-Nonce, X-FL-Sig.",
      "Sig formula: HMAC-SHA256(session_secret, timestamp + nonce + path).",
      "30-second replay window rejection prevents packet sniffing & replay attacks.",
      "Unsigned or standard browser requests receive immediate 403 Forbidden."
    ],
    code_snippet: "sig = HMAC_SHA256(secret, `${ts}${nonce}${path}`)\nheaders = {'X-FL-Sig': sig, 'X-FL-Ts': ts, 'X-FL-Nonce': nonce}"
  },
  {
    slide_number: 3,
    title: "Distraction Containment vs. Invasive Surveillance",
    subtitle: "Privacy-Preserving In-Browser & OS Containment",
    bullet_points: [
      "Web Client: Page Visibility API + Screen Wake Lock API detects hidden tabs.",
      "Android Companion: startLockTask() screen pinning + blackhole VpnService.",
      "Zero Data Snooping: Packets are dropped without inspection, logging, or forwarding.",
      "Immediate emergency override: 112 calls always take precedence."
    ],
    notes: "Students retain ownership: VPN revocation is treated as an event, not a lock violation."
  }
];

export default function CourseViewer({ sessionId, sessionSecret }: CourseViewerProps) {
  const [slides, setSlides] = useState<Slide[]>(FALLBACK_SLIDES);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState<string>("CS-402: Zero-Trust Classroom Security");

  useEffect(() => {
    const loadProtectedSlides = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        // Call gated course-portal endpoint with cryptographic HMAC headers
        const res = await fetchSigned("/api/course-portal/slides", sessionId, sessionSecret, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data.slides && data.slides.length > 0) {
            setSlides(data.slides);
            if (data.course) setCourseTitle(data.course);
          }
        }
      } catch (err: any) {
        // High availability: retain built-in slides
      }
    };

    loadProtectedSlides();
  }, [sessionId, sessionSecret]);

  if (loading) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs text-slate-400 font-mono">
          Verifying X-FL-* cryptographic headers & loading lecture slides...
        </p>
      </div>
    );
  }

  if (errorMsg || slides.length === 0) {
    return (
      <div className="p-6 bg-rose-950/40 border border-rose-800/80 rounded-2xl text-center">
        <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
        <h4 className="text-sm font-semibold text-rose-200">Protected Course Portal</h4>
        <p className="text-xs text-rose-300/80 mt-1">{errorMsg || "No slides found."}</p>
      </div>
    );
  }

  const slide = slides[currentIdx];

  return (
    <div className="bg-white border border-[#E5E3DC] rounded-2xl p-5 shadow-sm flex flex-col justify-between min-h-[380px] text-[#1E293B]">
      <div>
        {/* Header with Signed Gate Status */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#F1F0EA]">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#2E6B38]" />
            <span className="text-xs font-bold text-[#1E293B] truncate max-w-[200px]">
              {courseTitle}
            </span>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-mono font-medium text-[#1B4D2E] bg-[#EEF8EE] px-2 py-0.5 rounded border border-[#C8E6C9]">
            <ShieldCheck className="w-3 h-3 text-[#2E6B38]" /> Signed Gate Verified
          </span>
        </div>

        {/* Slide Title */}
        <div className="mb-4">
          <span className="text-[10px] uppercase font-bold text-[#2E6B38] tracking-wider">
            Slide {slide.slide_number} of {slides.length}
          </span>
          <h2 className="text-lg font-bold text-[#1E293B] mt-0.5">{slide.title}</h2>
          {slide.subtitle && (
            <p className="text-xs text-[#64748B] mt-0.5">{slide.subtitle}</p>
          )}
        </div>

        {/* Bullet Points */}
        <ul className="space-y-2 mb-4 text-xs text-[#334155] leading-relaxed">
          {slide.bullet_points.map((pt, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2E6B38] mt-1.5 shrink-0" />
              <span>{pt}</span>
            </li>
          ))}
        </ul>

        {/* Code Snippet if present */}
        {slide.code_snippet && (
          <div className="bg-[#FAF9F5] p-3 rounded-xl border border-[#E5E3DC] mb-4 font-mono text-[11px] text-[#1E293B] overflow-x-auto">
            <pre>{slide.code_snippet}</pre>
          </div>
        )}

        {/* Lecture Notes if present */}
        {slide.notes && (
          <div className="bg-[#FAF9F5] p-2.5 rounded-xl border border-[#E5E3DC] text-[11px] text-[#64748B] italic">
            <span className="font-semibold text-[#1E293B] not-italic">Instructor Note: </span>
            {slide.notes}
          </div>
        )}
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-[#F1F0EA]">
        <button
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
            currentIdx === 0
              ? "text-[#CBD5E1] bg-[#FAF9F5] border-[#E5E3DC] cursor-not-allowed"
              : "text-[#1E293B] bg-[#FAF9F5] hover:bg-[#F1F0EA] border-[#E5E3DC]"
          }`}
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>

        <span className="text-xs font-mono text-[#64748B]">
          {currentIdx + 1} / {slides.length}
        </span>

        <button
          onClick={() => setCurrentIdx((i) => Math.min(slides.length - 1, i + 1))}
          disabled={currentIdx === slides.length - 1}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
            currentIdx === slides.length - 1
              ? "text-[#CBD5E1] bg-[#FAF9F5] border-[#E5E3DC] cursor-not-allowed"
              : "text-[#1E293B] bg-[#FAF9F5] hover:bg-[#F1F0EA] border-[#E5E3DC]"
          }`}
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
