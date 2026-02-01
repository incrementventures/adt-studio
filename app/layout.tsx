import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import QueueStatus from "./queue-status";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ADT Studio",
  description: "Book pipeline dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-x-hidden`}
      >
        <header className="border-b border-slate-700/50 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 shadow-lg shadow-black/20">
          <div className="flex items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-500 text-xs font-bold">
                A
              </span>
              ADT Studio
            </Link>
            <QueueStatus />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
