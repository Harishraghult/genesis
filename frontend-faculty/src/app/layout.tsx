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
    <html lang="en">
      <body className="min-h-screen bg-[#FAF9F5] text-[#1E293B] antialiased">
        {children}
      </body>
    </html>
  );
}
