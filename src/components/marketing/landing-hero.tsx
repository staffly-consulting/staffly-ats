import { ArrowRight } from "lucide-react";

import { ScoreRing } from "@/components/dashboard/score-indicator";
import { PillLink } from "@/components/marketing/pill-link";
import { TRIAL_PERIOD_DAYS } from "@/lib/plans";
import { SCORE_THRESHOLDS } from "@/lib/score";
import { cn } from "@/lib/utils";

/** Illustrative, not real people. Ordered by score, as the product ranks them. */
const SAMPLE_CANDIDATES = [
  { name: "Mariam Haddad", detail: "8 yrs · Lisbon", score: 92 },
  { name: "Sofia Lindqvist", detail: "9 yrs · Stockholm", score: 88 },
  { name: "Tomás Ferreira", detail: "6 yrs · São Paulo", score: 78 },
  { name: "Jonas Weber", detail: "4 yrs · Munich", score: 34 },
];

/**
 * How each of the top candidate's criteria came out, for the "why" card.
 * `flex` is the criterion's weight, so the bar widths are the weighting.
 */
const WHY_SEGMENTS = [
  { flex: 3, met: true },
  { flex: 3, met: true },
  { flex: 2, met: false },
  { flex: 1, met: true },
];

function CandidateRow({
  candidate,
}: {
  candidate: (typeof SAMPLE_CANDIDATES)[number];
}) {
  const above = candidate.score >= SCORE_THRESHOLDS.strong;

  return (
    <li className="flex items-center gap-4 py-2.5">
      <ScoreRing score={candidate.score} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{candidate.name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {candidate.detail}
        </p>
      </div>
      <span
        className={cn(
          "rounded-md px-2 py-0.5 font-mono text-[11px]",
          above
            ? "bg-success/10 text-success"
            : "bg-muted text-muted-foreground",
        )}
      >
        {above ? "Shortlist" : "Below"}
      </span>
    </li>
  );
}

export function LandingHero() {
  // Split on the real threshold rather than by position, so the divider cannot
  // drift from the scores if the sample data or the threshold changes.
  const above = SAMPLE_CANDIDATES.filter(
    (c) => c.score >= SCORE_THRESHOLDS.strong,
  );
  const below = SAMPLE_CANDIDATES.filter(
    (c) => c.score < SCORE_THRESHOLDS.strong,
  );

  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="marketing-grid absolute inset-0 -z-10" />

      <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 pt-16 pb-28 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:pt-24 lg:pb-36">
        <div>
          {/* The trial is the offer, so it leads. */}
          <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-card py-1 pr-3 pl-1 text-sm text-brand">
            <span className="rounded-full bg-brand-subtle px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide">
              NEW
            </span>
            {TRIAL_PERIOD_DAYS}-day free trial
          </p>

          <h1 className="mt-8 text-5xl leading-[0.98] font-semibold tracking-tighter text-balance sm:text-6xl lg:text-7xl">
            Read every application.
            <span className="mt-1 block font-serif leading-[1.05] font-normal tracking-normal text-brand italic">
              Shortlist in minutes.
            </span>
          </h1>

          <p className="mt-8 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
            Staffly ATS+ ingests applications from your inbox, extracts what
            matters from each resume, and scores candidates against the
            criteria you set — with a rationale you can defend.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <PillLink href="/sign-up">
              Start free trial
              <ArrowRight className="size-4" />
            </PillLink>
            <PillLink href="/pricing" tone="outline">
              See pricing
            </PillLink>
          </div>

          {/* Stated plainly because the card requirement is the first thing a
              sceptical buyer looks for, and burying it costs more trust than it
              saves. */}
          <p className="mt-6 text-sm text-muted-foreground">
            {TRIAL_PERIOD_DAYS} days free. Card required, nothing charged until
            the trial ends, cancel any time.
          </p>
        </div>

        {/* Decorative: a picture of the product, not content. Hidden from
            assistive tech as one unit so a screen reader is not read four
            invented candidates as though they were real. */}
        <div aria-hidden className="relative">
          <div className="rounded-3xl border border-border bg-card shadow-2xl shadow-brand/10">
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0">
                <p className="truncate font-semibold">Senior Backend Engineer</p>
                <p className="truncate text-sm text-muted-foreground">
                  10 applicants · {above.length} above threshold shown
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" />
                Open
              </span>
            </div>

            <div className="px-6 py-3">
              <ul>
                {above.map((candidate) => (
                  <CandidateRow key={candidate.name} candidate={candidate} />
                ))}
              </ul>

              <div className="flex items-center gap-3 py-2">
                <span className="h-px flex-1 border-t border-dashed border-border" />
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                  THRESHOLD {SCORE_THRESHOLDS.strong}
                </span>
                <span className="h-px flex-1 border-t border-dashed border-border" />
              </div>

              <ul>
                {below.map((candidate) => (
                  <CandidateRow key={candidate.name} candidate={candidate} />
                ))}
              </ul>
            </div>
          </div>

          {/* The rationale, overlapping the list: the score is never shown
              without the reason for it, which is the product's whole claim. */}
          <div className="absolute right-4 -bottom-16 w-72 rounded-2xl bg-slate-950 p-5 text-white shadow-2xl sm:right-6 sm:w-80">
            <p className="font-mono text-[11px] tracking-widest text-indigo-300">
              WHY {SAMPLE_CANDIDATES[0].score}
            </p>
            <p className="mt-2 text-sm">
              Go since 2019; owned the billing service.
            </p>
            <div className="mt-3 flex gap-1.5">
              {WHY_SEGMENTS.map((segment, index) => (
                <span
                  key={index}
                  style={{ flexGrow: segment.flex }}
                  className={cn(
                    "h-1 basis-0 rounded-full",
                    segment.met ? "bg-emerald-400" : "bg-amber-400",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
