import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "../components/language.tsx";

export const metadata: Metadata = {
  title: "Openjutsu",
  description: "Open-source character swap for video, powered by ComfyUI and MiniMax H3.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
