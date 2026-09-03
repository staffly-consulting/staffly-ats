"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { CandidateStatus } from "@prisma/client";

import type { JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Status pills. Built as plain Tailwind class maps on top of shadcn's `Badge`
 * rather than new badge variants, so the variant list stays upstream-clean.
 *
 * Only the COLOUR lives here now; the label comes from the message catalogue,
 * keyed by the enum member. Keeping the two apart means a translator never has
 * to touch a Tailwind class, and a design change never touches Thai text.
 */

const JOB_STATUS: Record<JobStatus, { className: string }> = {
  DRAFT: {
    className: "bg-muted text-muted-foreground border-border",
  },
  OPEN: {
    className: "bg-success/12 text-success border-success/25",
  },
  CLOSED: {
    className: "bg-secondary text-secondary-foreground border-border",
  },
  ARCHIVED: {
    className: "bg-muted text-muted-foreground border-border",
  },
};

/**
 * Real `CandidateStatus` from the database. The pipeline writes NEW (ingested)
 * → PROCESSING (extraction running) → EXTRACTED (resume read) or ERROR.
 * SCORED and SHORTLISTED arrive with the scoring step.
 */
const CANDIDATE_STATUS: Record<CandidateStatus, { className: string }> = {
  NEW: {
    className: "bg-brand/10 text-brand border-brand/25",
  },
  PROCESSING: {
    className: "bg-warning/14 text-warning border-warning/25",
  },
  EXTRACTED: {
    className: "bg-brand/10 text-brand border-brand/25",
  },
  SCORED: {
    className: "bg-secondary text-secondary-foreground border-border",
  },
  SHORTLISTED: {
    className: "bg-success/12 text-success border-success/25",
  },
  REJECTED: {
    className: "bg-muted text-muted-foreground border-border",
  },
  ERROR: {
    className: "bg-danger/10 text-danger border-danger/25",
  },
};

export function JobStatusPill({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  const t = useTranslations("jobStatus");
  const { className: tone } = JOB_STATUS[status];
  return (
    <Badge variant="outline" className={cn(tone, className)}>
      {t(status)}
    </Badge>
  );
}

export function CandidateStatusPill({
  status,
  className,
}: {
  status: CandidateStatus;
  className?: string;
}) {
  const t = useTranslations("candidateStatus");
  const { className: tone } = CANDIDATE_STATUS[status];
  return (
    <Badge variant="outline" className={cn(tone, className)}>
      {t(status)}
    </Badge>
  );
}
