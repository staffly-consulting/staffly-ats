import { z } from "zod";

/**
 * Two schemas, and the split between them is the whole design of this step.
 *
 * `criterionJudgementSchema` is what the **model** is allowed to produce: for
 * each criterion, did the candidate meet it, and why. Nothing numeric.
 *
 * `scoringResultSchema` is what **our code** produces after doing the
 * arithmetic itself. The model never sees it and never fills it in.
 *
 * Keeping the number out of the model's hands is what makes a score
 * explainable: "78 because 3 of 4 optional criteria at weights 7/4/3 of 16
 * were met, plus a +5 referral" is a sentence you can defend to a customer.
 * "The model said 78" is not, and two similar candidates scoring 71 and 84 for
 * no traceable reason is a support ticket nobody can close.
 */

/* -------------------------------------------------------------------------- */
/* What the model returns                                                      */
/* -------------------------------------------------------------------------- */

export const criterionJudgementSchema = z.object({
  /** Must match a `Criterion.id` from the job post's criteria JSON. */
  criterionId: z.string().min(1),
  met: z.boolean(),
  /** 1–2 sentences, specific to this candidate and this requirement. */
  rationale: z.string().min(1).max(1000),
});

export const judgementResponseSchema = z.object({
  criteria: z.array(criterionJudgementSchema),
  /** 2–3 sentences on the strongest and weakest points of fit. */
  overallRationale: z.string().min(1).max(2000),
});

export type CriterionJudgement = z.infer<typeof criterionJudgementSchema>;
export type JudgementResponse = z.infer<typeof judgementResponseSchema>;

/* -------------------------------------------------------------------------- */
/* What our code produces                                                      */
/* -------------------------------------------------------------------------- */

export const criterionResultSchema = z.object({
  criterionId: z.string(),
  /** Copied off the criterion so the breakdown renders without a join. */
  label: z.string(),
  isMandatory: z.boolean(),
  met: z.boolean(),
  /**
   * Mandatory criteria are pass/fail and always score 0 — they gate rather than
   * contribute. Optional criteria carry their weighted share of the 50-point
   * optional allocation.
   */
  points: z.number(),
  rationale: z.string(),
});

export const scoringResultSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  mandatoryPassed: z.boolean(),
  criteriaResults: z.array(criterionResultSchema),
  referralBonusApplied: z.number(),
  universityBonusApplied: z.number(),
  overallRationale: z.string(),
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
});

export type CriterionResult = z.infer<typeof criterionResultSchema>;
export type ScoringResult = z.infer<typeof scoringResultSchema>;

/**
 * The persisted shape of `CandidateScore.breakdown`.
 *
 * An envelope rather than a bare array, because the bonuses and the mandatory
 * verdict are facts about the scoring run that the fixed schema has no column
 * for — and inventing synthetic criteria rows to carry them would corrupt the
 * per-criterion list. Same pattern as `JobPost.optionalCriteria`.
 *
 * `version` exists so a future format change can be detected rather than
 * silently mis-parsed.
 */
export const scoreBreakdownEnvelopeSchema = z.object({
  version: z.literal(1),
  criteria: z.array(criterionResultSchema),
  mandatoryPassed: z.boolean(),
  referralBonusApplied: z.number(),
  universityBonusApplied: z.number(),
});

export type ScoreBreakdownEnvelope = z.infer<
  typeof scoreBreakdownEnvelopeSchema
>;

export function buildScoreBreakdown(
  result: ScoringResult,
): ScoreBreakdownEnvelope {
  return {
    version: 1,
    criteria: result.criteriaResults,
    mandatoryPassed: result.mandatoryPassed,
    referralBonusApplied: result.referralBonusApplied,
    universityBonusApplied: result.universityBonusApplied,
  };
}

/**
 * Reads the column back, tolerating both the envelope and a bare array of
 * criteria (the shape a pre-envelope build would have written). Never throws:
 * a row from an older scoring version must not crash the page rendering it.
 */
export function parseScoreBreakdown(value: unknown): ScoreBreakdownEnvelope {
  const empty: ScoreBreakdownEnvelope = {
    version: 1,
    criteria: [],
    mandatoryPassed: false,
    referralBonusApplied: 0,
    universityBonusApplied: 0,
  };

  const envelope = scoreBreakdownEnvelopeSchema.safeParse(value);
  if (envelope.success) return envelope.data;

  if (Array.isArray(value)) {
    const criteria = value
      .map((entry) => criterionResultSchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
    return {
      ...empty,
      criteria,
      mandatoryPassed: criteria
        .filter((c) => c.isMandatory)
        .every((c) => c.met),
    };
  }

  return empty;
}
