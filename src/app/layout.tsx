import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { ClerkProvider } from "@clerk/nextjs";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

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
      <html lang={locale} suppressHydrationWarning>
        <body
          className={`${inter.variable} ${jetbrainsMono.variable} min-h-svh antialiased`}
        >
          <NextIntlClientProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            <Toaster position="bottom-right" />
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
