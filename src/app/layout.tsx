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
  metadataBase: new URL("https://tutorloft-workspace.vercel.app"),
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
    url: "https://tutorloft-workspace.vercel.app",
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
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-float focus:outline-none focus:ring-2 focus:ring-ring"
          href="#main-content"
        >
          Skip to content
        </a>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
