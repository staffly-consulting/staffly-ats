import type { ScoreBand } from "@/lib/types";

/**
 * Single source of truth for how a 0-100 screening score maps to colour.
 * Everything that paints a score (badge, ring, table cell, filter chips)
 * goes through here so the thresholds only exist in one place.
 */
export const SCORE_THRESHOLDS = {
  /** >= strong is a shortlist candidate. */
  strong: 70,
  /** >= moderate is worth a human look. */
  moderate: 40,
} as const;

export function getScoreBand(score: number | null | undefined): ScoreBand {
  if (score === null || score === undefined) return "unscored";
  if (score >= SCORE_THRESHOLDS.strong) return "strong";
  if (score >= SCORE_THRESHOLDS.moderate) return "moderate";
  return "weak";
}

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  strong: "Strong match",
  moderate: "Possible match",
  weak: "Weak match",
  unscored: "Not scored yet",
};

/** Tailwind classes per band — soft fill + readable text, works in both themes. */
export const SCORE_BAND_BADGE_CLASSES: Record<ScoreBand, string> = {
  strong: "bg-success/12 text-success border-success/25",
  moderate: "bg-warning/14 text-warning border-warning/25",
  weak: "bg-danger/12 text-danger border-danger/25",
  unscored: "bg-muted text-muted-foreground border-border",
};

/** Solid fill — used for progress bars and ring strokes. */
export const SCORE_BAND_FILL_CLASSES: Record<ScoreBand, string> = {
  strong: "bg-success",
  moderate: "bg-warning",
  weak: "bg-danger",
  unscored: "bg-muted-foreground/40",
};

export const SCORE_BAND_STROKE_CLASSES: Record<ScoreBand, string> = {
  strong: "stroke-success",
  moderate: "stroke-warning",
  weak: "stroke-danger",
  unscored: "stroke-muted-foreground/40",
};

export const SCORE_BAND_TEXT_CLASSES: Record<ScoreBand, string> = {
  strong: "text-success",
  moderate: "text-warning",
  weak: "text-danger",
  unscored: "text-muted-foreground",
};

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? "—" : `${Math.round(score)}`;
}

/** Options for the "minimum score" filter select. */
export const SCORE_FILTER_OPTIONS = [
  { value: "0", label: "Any score" },
  { value: "40", label: "40+ · possible" },
  { value: "70", label: "70+ · strong" },
  { value: "85", label: "85+ · top tier" },
] as const;
