import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tutorloft.app"),
  title: {
    default: "TutorLoft",
    template: "%s · TutorLoft",
  },
  description:
    "TutorLoft is a private tutoring workspace for classes, materials, assignments, and billing.",
  openGraph: {
    title: "TutorLoft",
    description:
      "A calm private tutoring workspace for lessons, assignments, parent visibility, and invoice tracking.",
    type: "website",
    url: "https://tutorloft.app",
    siteName: "TutorLoft",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={cn(
          inter.variable,
          instrumentSerif.variable,
          jetBrainsMono.variable,
          "font-sans",
        )}
      >
        {children}
      </body>
    </html>
  );
}
