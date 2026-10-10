import type { CandidateStatus } from "@prisma/client";

/**
 * The human half of `CandidateStatus`.
 *
 * The enum carries two things: where a resume is in the PIPELINE (NEW,
 * PROCESSING, EXTRACTED, SCORED, ERROR — written by the system) and what a
 * PERSON decided about the candidate (everything here). This module is the one
 * place that says which is which, so the action that writes a decision, the
 * filter that reads it and the export that prints it cannot drift apart.
 *
 * Pure and dependency-free, like `lib/permissions.ts`, so client components can
 * import it.
 */

/** Forward stages, in the order a candidate moves through them. */
export const HIRING_STAGES = [
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
] as const satisfies readonly CandidateStatus[];

/** Every status a person, never the system, sets. */
export const DECISION_STATUSES = [
  ...HIRING_STAGES,
  "REJECTED",
] as const satisfies readonly CandidateStatus[];

export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export function isDecisionStatus(value: unknown): value is DecisionStatus {
  return DECISION_STATUSES.includes(value as DecisionStatus);
}

/** The `decision` URL filter: one stage, or everyone nobody has ruled on. */
export type DecisionFilter = DecisionStatus | "undecided";

export function parseDecisionFilter(
  value: string | null | undefined,
): DecisionFilter | undefined {
  return value === "undecided" || isDecisionStatus(value) ? value : undefined;
}

/**
 * English labels, for surfaces that are not translated: the export and the
 * filter bar. Anything rendered through the status pill uses the message
 * catalogue instead.
 */
export const DECISION_LABELS: Record<DecisionStatus, string> = {
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};
