import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sports Eye — Prediction Intelligence",
  description: "Sports prediction, simulation, calibration, mistake analysis, and proof tracking."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
