import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { ClerkProvider } from "@clerk/nextjs";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Staffly ATS+",
    template: "%s · Staffly ATS+",
  },
  description:
    "AI-powered recruitment screening. Ingest applications, score them against your criteria, and shortlist in minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Clerk's prebuilt components pick up the app's look from these variables
    // rather than shipping their own palette, so sign-in and the org switcher
    // match the dashboard without restyling Clerk's internals.
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "var(--brand)",
          colorPrimaryForeground: "var(--brand-foreground)",
          colorBackground: "var(--card)",
          colorForeground: "var(--foreground)",
          colorMuted: "var(--muted)",
          colorMutedForeground: "var(--muted-foreground)",
          colorInput: "var(--background)",
          colorInputForeground: "var(--foreground)",
          colorBorder: "var(--border)",
          colorRing: "var(--ring)",
          colorDanger: "var(--danger)",
          colorSuccess: "var(--success)",
          colorWarning: "var(--warning)",
          borderRadius: "var(--radius)",
          fontFamily: "var(--font-sans)",
        },
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${inter.variable} ${jetbrainsMono.variable} min-h-svh antialiased`}
        >
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </body>
      </html>
    </ClerkProvider>
  );
}
