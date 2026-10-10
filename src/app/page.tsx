import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingScoring } from "@/components/marketing/landing-scoring";
import { LandingSteps } from "@/components/marketing/landing-steps";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { PillLink } from "@/components/marketing/pill-link";
import { StafflyLogo } from "@/components/staffly-logo";
import { TRIAL_PERIOD_DAYS } from "@/lib/plans";

export default function LandingPage() {
  return (
    // `flex flex-col` + `flex-1` on main is what pins the footer to the bottom.
    // With `min-h-svh` alone the wrapper was tall but its children were not, so
    // on a tall screen the footer sat directly under the last section with a
    // band of empty background below it.
    <div className="flex min-h-svh flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">
        <LandingHero />
        <LandingSteps />
        <LandingScoring />

        {/* ---------------------------------------------------------------- */}
        {/* Closing call to action                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          {/* Always white on indigo, in both colour schemes: `text-white`
              rather than `text-brand-foreground`, which is dark in dark mode
              and would not match the fixed-white buttons below. */}
          <div className="relative overflow-hidden rounded-[2.5rem] bg-indigo-600 px-6 py-20 text-center text-white sm:py-28">
            <div aria-hidden className="marketing-dots absolute inset-0" />

            <div className="relative mx-auto max-w-3xl">
              <h2 className="text-4xl leading-[1.05] font-semibold tracking-tighter text-balance sm:text-6xl">
                Stop reading resumes in order of{" "}
                <span className="font-serif font-normal tracking-normal italic">
                  arrival
                </span>
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-indigo-100">
                Try it free for {TRIAL_PERIOD_DAYS} days. Plans start at $79 a
                month, priced by applications rather than by seat — so the whole
                hiring team can use it.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <PillLink href="/sign-up" tone="light">
                  Start free trial
                  <ArrowRight className="size-4" />
                </PillLink>
                <PillLink href="/pricing" tone="outline-light">
                  See pricing
                </PillLink>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <StafflyLogo href={null} />
          <nav className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href="/sign-in"
              className="transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="transition-colors hover:text-foreground"
            >
              Get started
            </Link>
          </nav>
          <p>© {new Date().getFullYear()} Staffly Consulting</p>
        </div>
      </footer>
    </div>
  );
}
