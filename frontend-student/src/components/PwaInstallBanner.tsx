"use client";

import { useEffect, useState } from "react";
import { Download, Share, X, Smartphone } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Register Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration skipped or failed:", err);
      });
    }

    // Check if app is already running standalone
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(isStandaloneMode);

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    // Capture install prompt for Android/Chromium
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  if (isStandalone || dismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto">
      <div className="bg-slate-900/95 backdrop-blur-md border border-cyan-500/40 p-4 rounded-2xl shadow-2xl shadow-cyan-950/50 text-white flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 shrink-0 mt-0.5">
          <Smartphone className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm text-cyan-200">Install FocusLock Mobile</h4>
            <button
              onClick={() => setDismissed(true)}
              className="text-slate-400 hover:text-white p-1 -mr-1"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            {isIOS ? (
              <>
                To install like a downloaded app: tap the <span className="inline-flex items-center text-cyan-400 font-semibold"><Share className="w-3 h-3 inline mx-0.5" /> Share</span> button in Safari, then select <strong className="text-white">Add to Home Screen</strong>.
              </>
            ) : (
              "Install to your home screen for distraction-free standalone mode and instant access."
            )}
          </p>

          {!isIOS && deferredPrompt && (
            <button
              onClick={handleInstallClick}
              className="mt-3 w-full py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 shadow-md shadow-cyan-500/20 transition-all active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              Download / Install to Home Screen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
