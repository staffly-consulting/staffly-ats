import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";

import { ClerkProvider } from "@clerk/nextjs";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// Named for the face, not `--font-sans`: the Tailwind theme defines
// `--font-sans` in terms of this, and giving both the same name made the theme
// variable refer to itself, which is invalid — every page silently fell back
// to the browser's default serif.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Display serif for the marketing pages' italic accents only. One weight, one
 * style — it never sets body text, so nothing else is downloaded.
 */
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolved per request from the signed-in account's saved preference; see
  // src/i18n/request.ts. Drives both <html lang> and Intl formatting.
  const locale = await getLocale();

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
      {/* The font variables sit on <html>, not <body>: the base stylesheet
          sets `font-family` on html itself, and a variable declared on a child
          is not visible there. */}
      <html
        lang={locale}
        suppressHydrationWarning
        className={`${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}
      >
        <body className="min-h-svh antialiased">
          <NextIntlClientProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            <Toaster position="bottom-right" />
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
