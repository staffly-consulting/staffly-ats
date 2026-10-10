"use client";

import { useTranslations } from "next-intl";

import type { CandidateDecision } from "@/app/(dashboard)/dashboard/candidate-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DECISION_STATUSES, isDecisionStatus } from "@/lib/hiring-stage";
import type { CandidateStatus } from "@prisma/client";

const UNDECIDED = "UNDECIDED";

/**
 * Where a candidate is in the hiring pipeline, as a picker.
 *
 * A select rather than a row of "next stage" buttons because hiring does not
 * only move forward: an offer falls through, a rejected candidate is
 * reconsidered. Any stage is reachable from any other in one step.
 */
export function CandidateStageSelect({
  status,
  disabled,
  onChange,
}: {
  status: CandidateStatus;
  disabled: boolean;
  onChange: (next: CandidateDecision) => void;
}) {
  const t = useTranslations("candidateStatus");

  return (
    <Select
      value={isDecisionStatus(status) ? status : UNDECIDED}
      onValueChange={(value) => onChange(value as CandidateDecision)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full sm:w-56" aria-label="Hiring stage">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNDECIDED}>Not yet decided</SelectItem>
        {DECISION_STATUSES.map((stage) => (
          <SelectItem key={stage} value={stage}>
            {t(stage)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
