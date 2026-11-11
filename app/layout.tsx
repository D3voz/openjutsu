import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Openjutsu",
  description: "Cambio de personaje de código abierto para vídeo, impulsado por ComfyUI y MiniMax H3.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
