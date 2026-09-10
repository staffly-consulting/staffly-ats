import type { Metadata } from "next";

import Link from "next/link";

import { MarketingHeader } from "@/components/marketing/marketing-header";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { StafflyLogo } from "@/components/staffly-logo";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Staffly ATS+ plans. Applications pool monthly, overage is billed as it accrues, and every plan includes AI screening and scoring.",
};

/**
 * Public pricing.
 *
 * Sits outside the `(dashboard)` route group, so `auth.protect()` never runs
 * and a visitor can read the prices before creating an account — which was the
 * gap: the plan table existed only inside a dialog behind sign-in.
 *
 * A server component with no session reads: the buy buttons are a client island
 * (`PricingPlans`) whose server action resolves the visitor's auth state at the
 * moment they click. Nothing here needs to know who is looking, so this page
 * stays statically renderable.
 */
export default function PricingPage() {
  return (
    <div className="min-h-svh bg-background">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="absolute inset-0 -z-10 bg-linear-to-b from-brand-subtle/70 via-background to-background" />
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <div className="mx-auto max-w-2xl space-y-4 text-center">
              <h1 className="text-4xl font-semibold tracking-tight text-balance">
                Priced by applications, not by seat
              </h1>
              <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
                Every plan reads and scores every application that arrives, and
                every plan includes unlimited team members. Pick the pool that
                matches your hiring volume — you are only charged extra for what
                you use beyond it.
              </p>
            </div>

            <div className="mt-12">
              <PricingPlans
                // Absent in most environments; the Enterprise card degrades to
                // plain text rather than a dead mailto link.
                salesEmail={process.env.NEXT_PUBLIC_SALES_EMAIL ?? null}
              />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-lg font-semibold">How the pool works</h2>
          <dl className="mt-6 space-y-6 text-sm leading-relaxed">
            <div>
              <dt className="font-medium">What counts as an application?</dt>
              <dd className="mt-1 text-muted-foreground">
                One candidate arriving at one of your job posts. Resumes are
                parsed and scored as part of that — there is no separate charge
                for screening.
              </dd>
            </div>
            <div>
              <dt className="font-medium">
                What happens if I go over the pool?
              </dt>
              <dd className="mt-1 text-muted-foreground">
                Nothing stops. Applications past the included pool are billed at
                your plan&apos;s per-application rate, and you can see the
                running total in Settings before the invoice arrives.
              </dd>
            </div>
            <div>
              <dt className="font-medium">
                Does the pool reset when I am billed annually?
              </dt>
              <dd className="mt-1 text-muted-foreground">
                Yes. The pool is monthly on every plan, and overage is invoiced
                monthly as it accrues rather than accumulating for a year.
              </dd>
            </div>
            <div>
              <dt className="font-medium">How many people can I add?</dt>
              <dd className="mt-1 text-muted-foreground">
                As many as you like, on every plan. There are no per-user fees
                and no seat limits — a bigger team already sends more
                applications, so charging for both would bill the same growth
                twice. Invite your whole hiring panel.
              </dd>
            </div>
            <div>
              <dt className="font-medium">
                Is it safe to invite hiring managers?
              </dt>
              <dd className="mt-1 text-muted-foreground">
                Yes. Viewers can read job posts, candidates, scores and resumes,
                but cannot change criteria, edit a job post, export candidate
                data, or touch billing. Give them a Viewer seat and they see the
                shortlist without being able to alter anything.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Can I change or cancel later?</dt>
              <dd className="mt-1 text-muted-foreground">
                Any time, from Settings. Cancelling stops the renewal — you keep
                full access until the end of the period you have already paid
                for.
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <StafflyLogo href={null} className="text-xs" />
          <Link href="/" className="hover:text-foreground">
            Back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
