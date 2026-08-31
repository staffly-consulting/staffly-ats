import { Badge } from "@/components/ui/badge";
import type { CandidateStatus } from "@prisma/client";

import type { JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Status pills. Built as plain Tailwind class maps on top of shadcn's `Badge`
 * rather than new badge variants, so the variant list stays upstream-clean.
 */

const JOB_STATUS: Record<JobStatus, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border-border",
  },
  OPEN: {
    label: "Open",
    className: "bg-success/12 text-success border-success/25",
  },
  CLOSED: {
    label: "Closed",
    className: "bg-secondary text-secondary-foreground border-border",
  },
  ARCHIVED: {
    label: "Archived",
    className: "bg-muted text-muted-foreground border-border",
  },
};

/**
 * Real `CandidateStatus` from the database. The pipeline writes NEW (ingested)
 * → PROCESSING (extraction running) → EXTRACTED (resume read) or ERROR.
 * SCORED and SHORTLISTED arrive with the scoring step.
 */
const CANDIDATE_STATUS: Record<
  CandidateStatus,
  { label: string; className: string }
> = {
  NEW: {
    label: "New",
    className: "bg-brand/10 text-brand border-brand/25",
  },
  PROCESSING: {
    label: "Processing",
    className: "bg-warning/14 text-warning border-warning/25",
  },
  EXTRACTED: {
    label: "Extracted",
    className: "bg-brand/10 text-brand border-brand/25",
  },
  SCORED: {
    label: "Scored",
    className: "bg-secondary text-secondary-foreground border-border",
  },
  SHORTLISTED: {
    label: "Shortlisted",
    className: "bg-success/12 text-success border-success/25",
  },
  REJECTED: {
    label: "Rejected",
    className: "bg-muted text-muted-foreground border-border",
  },
  ERROR: {
    label: "Error",
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
  const { label, className: tone } = JOB_STATUS[status];
  return (
    <Badge variant="outline" className={cn(tone, className)}>
      {label}
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
  const { label, className: tone } = CANDIDATE_STATUS[status];
  return (
    <Badge variant="outline" className={cn(tone, className)}>
      {label}
    </Badge>
  );
}
