"use client";

import React, { useState, useEffect } from "react";
import { Zap, Timer, CheckCircle, AlertCircle } from "lucide-react";
import { getApiBase } from "@/lib/config";

interface QuizModalProps {
  quiz: {
    quiz_id: string;
    question: string;
    options: string[];
    duration_seconds: number;
  };
  studentId: string;
  onClose: () => void;
}

export default function QuizModal({ quiz, studentId, onClose }: QuizModalProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(quiz.duration_seconds || 30);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          if (!submitted) {
            handleAutoSubmit();
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [submitted]);

  const handleAutoSubmit = async () => {
    handleSubmit(selectedIdx ?? 0);
  };

  const handleSubmit = async (optionIndex: number) => {
    if (submitted) return;
    setSubmitted(true);
    setSelectedIdx(optionIndex);

    try {
      const res = await fetch(`${getApiBase()}/api/session/pulse/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          quiz_id: quiz.quiz_id,
          selected_option: optionIndex,
        }),
      });
      const data = await res.json();
      setIsCorrect(data.is_correct ?? true);
    } catch (e) {
      console.warn("Failed to submit pulse response:", e);
    }

    setTimeout(() => {
      onClose();
    }, 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Instructor Presence Pulse
            </h3>
          </div>
          <span className="flex items-center gap-1 text-xs font-mono font-bold text-amber-400 bg-amber-950/80 px-2.5 py-1 rounded-full border border-amber-700 animate-pulse">
            <Timer className="w-3.5 h-3.5" /> {secondsLeft}s
          </span>
        </div>

        {/* Question */}
        <p className="text-sm font-semibold text-slate-100 mb-4 leading-snug">
          {quiz.question}
        </p>

        {/* Options */}
        <div className="flex flex-col gap-2.5 mb-5">
          {quiz.options.map((option, idx) => {
            const isSelected = selectedIdx === idx;
            return (
              <button
                key={idx}
                type="button"
                disabled={submitted}
                onClick={() => handleSubmit(idx)}
                className={`w-full text-left p-3 rounded-xl text-xs font-medium border transition-all ${
                  isSelected
                    ? "bg-amber-500/20 border-amber-400 text-white font-semibold"
                    : "bg-slate-950/80 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-mono shrink-0">
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span>{option}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Submitted confirmation status */}
        {submitted && (
          <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-xl text-xs text-emerald-300 text-center flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>Presence response registered. Returning to slides...</span>
          </div>
        )}
      </div>
    </div>
  );
}
