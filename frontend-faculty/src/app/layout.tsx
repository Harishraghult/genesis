import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FocusLock — Faculty Control Center & Projector",
  description: "Verified Attendance & Session-Scoped Classroom Focus System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
