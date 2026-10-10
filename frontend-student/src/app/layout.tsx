import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaInstallBanner from "@/components/PwaInstallBanner";

export const viewport: Viewport = {
  themeColor: "#0284c7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "FocusLock — Student Lecture Companion",
  description: "Verified Attendance & Session-Scoped Focus Client",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FocusLock",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased flex flex-col justify-center">
        {children}
        <PwaInstallBanner />
      </body>
    </html>
  );
}

