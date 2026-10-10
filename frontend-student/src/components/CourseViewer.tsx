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

export default function CourseViewer({ sessionId, sessionSecret }: CourseViewerProps) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState<string>("Course Materials");

  useEffect(() => {
    const loadProtectedSlides = async () => {
      try {
        setLoading(true);
        // Call gated course-portal endpoint with cryptographic HMAC headers
        const res = await fetchSigned("/api/course-portal/slides", sessionId, sessionSecret);
        if (!res.ok) {
          throw new Error(`Gated access denied: HTTP ${res.status}`);
        }
        const data = await res.json();
        setSlides(data.slides || []);
        if (data.course) setCourseTitle(data.course);
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to load course materials");
      } finally {
        setLoading(false);
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col justify-between min-h-[380px]">
      <div>
        {/* Header with Signed Gate Status */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-slate-300 truncate max-w-[200px]">
              {courseTitle}
            </span>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-mono font-medium text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
            <ShieldCheck className="w-3 h-3" /> Signed Gate Verified
          </span>
        </div>

        {/* Slide Title */}
        <div className="mb-4">
          <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
            Slide {slide.slide_number} of {slides.length}
          </span>
          <h2 className="text-lg font-bold text-white mt-0.5">{slide.title}</h2>
          {slide.subtitle && (
            <p className="text-xs text-slate-400 mt-0.5">{slide.subtitle}</p>
          )}
        </div>

        {/* Bullet Points */}
        <ul className="space-y-2 mb-4 text-xs text-slate-300 leading-relaxed">
          {slide.bullet_points.map((pt, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
              <span>{pt}</span>
            </li>
          ))}
        </ul>

        {/* Code Snippet if present */}
        {slide.code_snippet && (
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 mb-4 font-mono text-[11px] text-cyan-300 overflow-x-auto">
            <pre>{slide.code_snippet}</pre>
          </div>
        )}

        {/* Lecture Notes if present */}
        {slide.notes && (
          <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-400 italic">
            <span className="font-semibold text-slate-300 not-italic">Instructor Note: </span>
            {slide.notes}
          </div>
        )}
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-800">
        <button
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            currentIdx === 0
              ? "text-slate-600 bg-slate-950 cursor-not-allowed"
              : "text-slate-300 bg-slate-800 hover:bg-slate-700"
          }`}
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>

        <span className="text-xs font-mono text-slate-400">
          {currentIdx + 1} / {slides.length}
        </span>

        <button
          onClick={() => setCurrentIdx((i) => Math.min(slides.length - 1, i + 1))}
          disabled={currentIdx === slides.length - 1}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            currentIdx === slides.length - 1
              ? "text-slate-600 bg-slate-950 cursor-not-allowed"
              : "text-slate-300 bg-slate-800 hover:bg-slate-700"
          }`}
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
