"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  SCORE_BAND_BADGE_CLASSES,
  SCORE_BAND_STROKE_CLASSES,
  SCORE_BAND_TEXT_CLASSES,
  formatScore,
  getScoreBand,
} from "@/lib/score";
import { cn } from "@/lib/utils";

/**
 * Score primitives. Colour comes from the band helpers in `lib/score.ts`, so
 * the thresholds are never re-stated here.
 */

const RING_SIZES = {
  sm: { box: "size-9", text: "text-[11px]", stroke: 3.5 },
  md: { box: "size-12", text: "text-sm", stroke: 4 },
  lg: { box: "size-20", text: "text-xl", stroke: 5 },
} as const;

const VIEWBOX = 44;
const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreRing({
  score,
  size = "sm",
  className,
}: {
  score: number | null | undefined;
  size?: keyof typeof RING_SIZES;
  className?: string;
}) {
  const t = useTranslations("score");
  const band = getScoreBand(score);
  const { box, text, stroke } = RING_SIZES[size];
  const filled = (Math.max(0, Math.min(100, score ?? 0)) / 100) * CIRCUMFERENCE;

  return (
    <div
      className={cn("relative inline-flex shrink-0", box, className)}
      role="img"
      aria-label={t("ariaLabel", {
        score: formatScore(score),
        band: t(`band.${band}`),
      })}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
          className={cn(
            "transition-[stroke-dasharray] duration-500",
            SCORE_BAND_STROKE_CLASSES[band],
          )}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-semibold tabular-nums",
          text,
          SCORE_BAND_TEXT_CLASSES[band],
        )}
      >
        {formatScore(score)}
      </span>
    </div>
  );
}

export function ScoreBadge({
  score,
  withLabel = false,
  className,
}: {
  score: number | null | undefined;
  withLabel?: boolean;
  className?: string;
}) {
  const t = useTranslations("score");
  const band = getScoreBand(score);

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-semibold tabular-nums",
        SCORE_BAND_BADGE_CLASSES[band],
        className,
      )}
    >
      {formatScore(score)}
      {withLabel ? (
        <span className="font-normal opacity-80">{t(`band.${band}`)}</span>
      ) : null}
    </Badge>
  );
}
