import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portrait Studio",
  description: "AI-powered face-centered image cropping with intelligent batch processing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
