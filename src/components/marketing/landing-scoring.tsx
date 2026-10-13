import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

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

const POINTS = [
  "Set criteria per role, not per account",
  "Weight what matters — not every requirement is equal",
  "A written reason for every criterion, pass or fail",
  "Disagree with a verdict and the evidence is right there",
];

/**
 * The one dark band on the page. Fixed slate rather than theme tokens: it is
 * meant to be dark in both colour schemes, and `bg-foreground` would turn it
 * white in dark mode.
 */
export function LandingScoring() {
  return (
    <section className="bg-slate-950 text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-blue-300 uppercase">
            The rationale
          </p>
          <h2 className="mt-4 text-4xl leading-[1.05] font-semibold tracking-tighter text-balance sm:text-5xl">
            A number you can{" "}
            <span className="font-serif font-normal tracking-normal italic">
              argue with
            </span>
          </h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-300">
            A score on its own is just a filter with better marketing. Each one
            here decomposes into the criteria you defined, how heavily you
            weighted them, and what in the resume actually met them.
          </p>
          <ul className="mt-8 space-y-3 text-slate-300">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-3">
                <Check className="mt-1 size-4 shrink-0 text-blue-300" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div className="min-w-0">
              <p className="truncate font-semibold">Mariam Haddad</p>
              <p className="truncate text-sm text-slate-400">
                Senior Backend Engineer · 8 yrs · Lisbon
              </p>
            </div>
            <span className="text-5xl leading-none font-semibold text-emerald-400 tabular-nums">
              92
            </span>
          </div>

          <ul className="mt-6 space-y-5">
            {SAMPLE_CRITERIA.map((criterion) => {
              const met = criterion.verdict === "met";
              return (
                <li key={criterion.label} className="flex gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                      met
                        ? "bg-emerald-400/15 text-emerald-400"
                        : "bg-amber-400/15 text-amber-400",
                    )}
                  >
                    {met ? (
                      <Check className="size-3" />
                    ) : (
                      <Minus className="size-3" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">
                        {criterion.label}
                        {/* The icon alone carries the verdict visually; this
                            says it for a screen reader. */}
                        <span className="sr-only">
                          {met ? " — met" : " — partly met"}
                        </span>
                      </p>
                      <span className="shrink-0 font-mono text-[10px] tracking-widest text-slate-400 uppercase">
                        {criterion.weight}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-slate-400">
                      {criterion.note}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 border-t border-white/10 pt-4 text-xs text-slate-500">
            Illustrative example — not a real candidate.
          </p>
        </div>
      </div>
    </section>
  );
}
