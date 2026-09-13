import Link from "next/link";

import { ArrowRight, Check, Filter, Mail, Minus, ScanLine } from "lucide-react";

import { ScoreRing } from "@/components/dashboard/score-indicator";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { StafflyLogo } from "@/components/staffly-logo";
import { Button } from "@/components/ui/button";
import { TRIAL_PERIOD_DAYS } from "@/lib/plans";

const STEPS = [
  {
    icon: Mail,
    title: "Applications arrive by email",
    body: "Every job post gets its own inbound address. Forward your careers inbox once and applications land in Staffly automatically.",
  },
  {
    icon: ScanLine,
    title: "Resumes are read and structured",
    body: "Contact details, education, experience and skills are extracted into fields you can filter on — no manual data entry.",
  },
  {
    icon: Filter,
    title: "Candidates are scored on your criteria",
    body: "Define what matters per role, weight it, and get a 0–100 score with a written rationale for every criterion.",
  },
];

/**
 * An illustration of the scoring breakdown, not a real candidate.
 *
 * This is on the page because the per-criterion rationale is what distinguishes
 * Staffly from a keyword filter, and describing it in a sentence never lands —
 * people have to see the score decompose into reasons they can argue with.
 * Including a partial verdict is deliberate: a demo where everything passes
 * teaches nobody what the product does when someone is a genuine maybe.
 */
const SAMPLE_CRITERIA = [
  {
    label: "5+ years backend engineering",
    weight: "High",
    verdict: "met" as const,
    note: "8 years across two payments companies.",
  },
  {
    label: "Production Go or Rust",
    weight: "High",
    verdict: "met" as const,
    note: "Go since 2019; owned the billing service.",
  },
  {
    label: "Led a migration at scale",
    weight: "Medium",
    verdict: "partial" as const,
    note: "Contributed to a monolith split, did not lead it.",
  },
  {
    label: "Works EU business hours",
    weight: "Low",
    verdict: "met" as const,
    note: "Based in Lisbon.",
  },
];

const SAMPLE_CANDIDATES = [
  { name: "Mariam Haddad", detail: "8 yrs · Lisbon", score: 92 },
  { name: "Sofia Lindqvist", detail: "9 yrs · Stockholm", score: 88 },
  { name: "Tomás Ferreira", detail: "6 yrs · São Paulo", score: 78 },
  { name: "Jonas Weber", detail: "4 yrs · Munich", score: 34 },
];

export default function LandingPage() {
  return (
    // `flex flex-col` + `flex-1` on main is what pins the footer to the bottom.
    // With `min-h-svh` alone the wrapper was tall but its children were not, so
    // on a tall screen the footer sat directly under the last section with a
    // band of empty background below it.
    <div className="flex min-h-svh flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">
        {/* ---------------------------------------------------------------- */}
        {/* Hero                                                             */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-32">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div>
              {/* The trial is the offer, so it leads. A thin rule rather than a
                  filled badge — it should register without shouting. */}
              <p className="flex items-center gap-2 text-sm font-medium text-brand">
                <span className="h-px w-6 bg-brand/40" />
                {TRIAL_PERIOD_DAYS}-day free trial
              </p>

              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Read every application.
                <span className="text-brand"> Shortlist in minutes.</span>
              </h1>

              <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
                Staffly ATS+ ingests applications from your inbox, extracts what
                matters from each resume, and scores candidates against the
                criteria you set — with a rationale you can defend.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/sign-up">
                    Start free trial
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/pricing">See pricing</Link>
                </Button>
              </div>

              {/* Stated plainly because the card requirement is the first thing
                  a sceptical buyer looks for, and burying it costs more trust
                  than it saves. */}
              <p className="mt-4 text-xs text-muted-foreground">
                {TRIAL_PERIOD_DAYS} days free. Card required, nothing charged
                until the trial ends, cancel any time.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Senior Backend Engineer</p>
                  <p className="text-xs text-muted-foreground">
                    10 applicants · 4 above threshold
                  </p>
                </div>
                <span className="text-xs font-medium text-success">Open</span>
              </div>

              <ul className="mt-5 space-y-1">
                {SAMPLE_CANDIDATES.map((candidate) => (
                  <li
                    key={candidate.name}
                    className="flex items-center gap-3 rounded-lg px-2 py-2"
                  >
                    <ScoreRing score={candidate.score} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {candidate.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {candidate.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* How it works — no card chrome, just columns on a rule            */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              From forwarded email to ranked shortlist
            </h2>

            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <div className="flex items-center gap-3">
                    <step.icon className="size-4.5 text-brand" />
                    <span
                      aria-hidden
                      className="text-xs text-muted-foreground tabular-nums"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* The scoring breakdown — the actual differentiator                */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <div className="grid items-center gap-14 lg:grid-cols-2">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  A number you can argue with
                </h2>
                <p className="mt-5 leading-relaxed text-muted-foreground">
                  A score on its own is just a filter with better marketing.
                  Each one here decomposes into the criteria you defined, how
                  heavily you weighted them, and what in the resume actually met
                  them.
                </p>
                <ul className="mt-7 space-y-3 text-sm text-muted-foreground">
                  {[
                    "Set criteria per role, not per account",
                    "Weight what matters — not every requirement is equal",
                    "A written reason for every criterion, pass or fail",
                    "Disagree with a verdict and the evidence is right there",
                  ].map((point) => (
                    <li key={point} className="flex gap-3">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-4 border-b border-border pb-4">
                  <ScoreRing score={92} size="lg" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Mariam Haddad</p>
                    <p className="text-xs text-muted-foreground">
                      Senior Backend Engineer · 8 yrs · Lisbon
                    </p>
                  </div>
                </div>

                <ul className="mt-5 space-y-4">
                  {SAMPLE_CRITERIA.map((criterion) => (
                    <li key={criterion.label} className="flex gap-3">
                      <span
                        aria-hidden
                        className={
                          criterion.verdict === "met"
                            ? "mt-0.5 shrink-0 text-success"
                            : "mt-0.5 shrink-0 text-warning"
                        }
                      >
                        {criterion.verdict === "met" ? (
                          <Check className="size-4" />
                        ) : (
                          <Minus className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium">
                            {criterion.label}
                          </p>
                          <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
                            {criterion.weight}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {criterion.note}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                <p className="mt-5 border-t border-border pt-3 text-[11px] text-muted-foreground">
                  Illustrative example — not a real candidate.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Closing call to action                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:py-28">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Stop reading resumes in order of arrival
            </h2>
            <p className="mt-4 leading-relaxed text-pretty text-muted-foreground">
              Try it free for {TRIAL_PERIOD_DAYS} days. Plans start at $79 a
              month, priced by applications rather than by seat — so the whole
              hiring team can use it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Start free trial
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <StafflyLogo href={null} className="text-xs" />
          <nav className="flex items-center gap-5">
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
