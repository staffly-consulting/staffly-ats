import { SCORE_THRESHOLDS } from "@/lib/score";
import type { Criterion } from "@/lib/types";
import type {
  CriterionJudgement,
  CriterionResult,
  ScoringResult,
} from "@/lib/validations/scoring";

/**
 * The deterministic half of scoring.
 *
 * Pure functions, no I/O, no model. Given the model's per-criterion verdicts
 * and the job post's definition, this computes the number. It is exhaustively
 * tested in `scripts/scoring.test.ts` because it is the part a customer will
 * one day ask us to justify.
 *
 * ## The formula
 *
 *   Any mandatory criterion unmet
 *     → score = 20 × (mandatory met / mandatory total)
 *       A proportional ramp rather than a flat 0: someone who clears 2 of 3
 *       hard requirements is genuinely closer than someone who clears none,
 *       and a recruiter scanning a rejected pile should be able to see that.
 *
 *   All mandatory criteria met
 *     → 50 base, plus each met optional criterion's weighted share of a further
 *       50, so the optional set can double the score but never gate it.
 *
 *   Bonuses (referral, preferred university) are added last and capped
 *   together, then the whole thing is clamped to 0–100.
 */

/** Everything below is expressed against a 0–100 scale. */
export const SCORING = {
  /** Ceiling for a candidate who misses any mandatory requirement. */
  UNQUALIFIED_MAX: 20,
  /** Awarded for clearing every mandatory requirement. */
  QUALIFIED_BASE: 50,
  /** Total distributable across met optional criteria, by weight. */
  OPTIONAL_ALLOCATION: 50,
  /** Referral + university bonuses combined can never exceed this. */
  MAX_COMBINED_BONUS: 10,
  /** Flat bonus when the candidate's university is on the org's preferred list. */
  UNIVERSITY_BONUS: 5,
} as const;

export interface ScoringInputs {
  mandatoryCriteria: Criterion[];
  optionalCriteria: Criterion[];
  judgements: CriterionJudgement[];
  overallRationale: string;
  /** `JobPost.referralBonusWeight`, already gated on `referralPriorityEnabled`. */
  referralBonusWeight: number;
  /** True only when a `Referral` row exists — never the candidate's own claim. */
  hasVerifiedReferral: boolean;
  /** The candidate's extracted university, if any. */
  candidateUniversity: string | null;
  /** Names of the job post's preferred universities. */
  preferredUniversityNames: string[];
}

const UNIVERSITY_STOPWORDS = new Set([
  "the",
  "university",
  "universities",
  "of",
  "college",
  "institute",
  "school",
  "at",
  "and",
]);

function significantWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !UNIVERSITY_STOPWORDS.has(word));
}

/**
 * Words an institutional acronym conventionally skips.
 *
 * This is *not* the stopword list above: "Institute" and "University" are part
 * of the acronym (MIT, NYU) while "of" and "and" are not. Getting this wrong
 * turns "Massachusetts Institute of Technology" into "miot" and the match
 * silently never fires.
 */
const ACRONYM_SKIP = new Set(["the", "of", "and", "at", "for", "in"]);

function acronym(value: string): string {
  const initials = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !ACRONYM_SKIP.has(word))
    .map((word) => word[0])
    .join("");
  // A single initial is not an acronym, it is a coincidence waiting to happen.
  return initials.length >= 2 ? initials : "";
}

/**
 * Loose match between a resume's university string and the org's preferred
 * list. Handles the three shapes that actually occur:
 *
 *   "Stanford University" ↔ "Stanford"                  (substring, after stopwords)
 *   "Massachusetts Institute of Technology" ↔ "MIT"     (acronym)
 *   "MIT" ↔ "MIT"                                       (exact)
 *
 * Deliberately generous — this is a +5 nudge on a curated list, not a gate, so
 * a false positive is cheap and a miss is the annoying outcome.
 */
function universityMatches(
  candidate: string | null,
  preferred: string[],
): boolean {
  if (!candidate) return false;

  const candidateKey = significantWords(candidate).join(" ");
  const candidateAcronym = acronym(candidate);
  if (candidateKey === "" && candidateAcronym === "") return false;

  return preferred.some((name) => {
    const key = significantWords(name).join(" ");
    const nameAcronym = acronym(name);

    if (key !== "" && candidateKey !== "") {
      if (
        candidateKey === key ||
        candidateKey.includes(key) ||
        key.includes(candidateKey)
      ) {
        return true;
      }
    }

    // One side spelled out, the other abbreviated.
    if (
      candidateAcronym !== "" &&
      key.replace(/\s+/g, "") === candidateAcronym
    ) {
      return true;
    }
    if (
      nameAcronym !== "" &&
      candidateKey.replace(/\s+/g, "") === nameAcronym
    ) {
      return true;
    }

    return false;
  });
}

/**
 * Distributes the optional allocation across met optional criteria by weight.
 *
 * Two degenerate cases the criteria builder cannot produce but old rows can:
 *   - no optional criteria at all → see `computeScore`, handled there
 *   - optional criteria whose weights all sum to zero → split evenly, because
 *     dividing by the total would be a NaN that silently poisons the score
 */
function optionalPoints(
  optionalCriteria: Criterion[],
  isMet: (criterionId: string) => boolean,
): Map<string, number> {
  const points = new Map<string, number>();
  if (optionalCriteria.length === 0) return points;

  const totalWeight = optionalCriteria.reduce(
    (sum, criterion) => sum + Math.max(0, criterion.weight),
    0,
  );

  for (const criterion of optionalCriteria) {
    const share =
      totalWeight > 0
        ? Math.max(0, criterion.weight) / totalWeight
        : 1 / optionalCriteria.length;

    points.set(
      criterion.id,
      isMet(criterion.id) ? share * SCORING.OPTIONAL_ALLOCATION : 0,
    );
  }

  return points;
}

/**
 * Flagging rules. Deterministic on purpose — a flag is a claim about the
 * scoring, so the model does not get to decide when to raise one.
 */
function evaluateFlags(context: {
  mandatoryPassed: boolean;
  mandatoryTotal: number;
  mandatoryUnmet: number;
  baseScore: number;
  finalScore: number;
  bonusApplied: number;
  referralBonusApplied: number;
  missingJudgements: string[];
}): { flagged: boolean; flagReason: string | null } {
  const reasons: string[] = [];

  // The model failed to judge something. Those criteria were counted as unmet,
  // which is the safe direction, but a human should confirm.
  if (context.missingJudgements.length > 0) {
    reasons.push(
      `the model returned no verdict for ${context.missingJudgements.length} requirement(s), counted as unmet`,
    );
  }

  // Near-miss: one hard requirement short. Auto-rejecting these loses good
  // people over a requirement that was maybe worded too tightly.
  if (
    !context.mandatoryPassed &&
    context.mandatoryUnmet === 1 &&
    context.mandatoryTotal >= 2
  ) {
    reasons.push(
      `only 1 of ${context.mandatoryTotal} mandatory requirements is unmet`,
    );
  }

  // A referral should tip a close call, not manufacture a qualified candidate.
  if (
    context.referralBonusApplied > 0 &&
    context.baseScore < SCORE_THRESHOLDS.moderate &&
    context.finalScore >= SCORE_THRESHOLDS.moderate
  ) {
    reasons.push(
      `the referral bonus lifted this candidate over the review threshold (base qualification was ${Math.round(context.baseScore)})`,
    );
  }

  // TODO(compliance): hook for nationality-based restrictions. Nothing in the
  // schema records a restriction today, so there is nothing to check — this is
  // deliberately left as a seam rather than invented policy. When it lands, the
  // check belongs here, deterministic and auditable, never in the prompt.

  return reasons.length > 0
    ? {
        flagged: true,
        flagReason: `Needs a human look: ${reasons.join("; ")}.`,
      }
    : { flagged: false, flagReason: null };
}

export function computeScore(inputs: ScoringInputs): ScoringResult {
  const verdicts = new Map(
    inputs.judgements.map((judgement) => [judgement.criterionId, judgement]),
  );

  const missingJudgements: string[] = [];
  const verdictFor = (criterion: Criterion) => {
    const judgement = verdicts.get(criterion.id);
    if (judgement) return judgement;
    missingJudgements.push(criterion.id);
    return {
      criterionId: criterion.id,
      met: false,
      rationale:
        "The scoring model did not return a verdict for this requirement, so it is counted as unmet.",
    };
  };

  // ---- mandatory: pass/fail gate, never contributes points ----------------
  const mandatoryResults: CriterionResult[] = inputs.mandatoryCriteria.map(
    (criterion) => {
      const judgement = verdictFor(criterion);
      return {
        criterionId: criterion.id,
        label: criterion.label,
        isMandatory: true,
        met: judgement.met,
        points: 0,
        rationale: judgement.rationale,
      };
    },
  );

  const mandatoryTotal = mandatoryResults.length;
  const mandatoryMet = mandatoryResults.filter((r) => r.met).length;
  const mandatoryUnmet = mandatoryTotal - mandatoryMet;
  // A job post with no mandatory criteria passes the gate vacuously.
  const mandatoryPassed = mandatoryUnmet === 0;

  // ---- optional: weighted contribution ------------------------------------
  const optionalPointsByCriterion = optionalPoints(
    inputs.optionalCriteria,
    (id) => verdicts.get(id)?.met === true,
  );

  const optionalResults: CriterionResult[] = inputs.optionalCriteria.map(
    (criterion) => {
      const judgement = verdictFor(criterion);
      return {
        criterionId: criterion.id,
        label: criterion.label,
        isMandatory: false,
        met: judgement.met,
        // Points are only real once the mandatory gate is cleared; showing them
        // regardless would imply they counted toward a score they did not.
        points: mandatoryPassed
          ? Number(
              (
                (judgement.met
                  ? optionalPointsByCriterion.get(criterion.id)
                  : 0) ?? 0
              ).toFixed(2),
            )
          : 0,
        rationale: judgement.rationale,
      };
    },
  );

  // ---- base score ---------------------------------------------------------
  let baseScore: number;

  if (!mandatoryPassed) {
    baseScore =
      mandatoryTotal === 0
        ? 0
        : SCORING.UNQUALIFIED_MAX * (mandatoryMet / mandatoryTotal);
  } else if (inputs.optionalCriteria.length === 0) {
    // No optional criteria means the optional half of the scale is undefined.
    // Awarding only the 50-point base would show a candidate who meets every
    // stated requirement as a mediocre 50, which reads as a broken score. They
    // met everything that was asked, so they score full marks.
    baseScore = 100;
  } else {
    baseScore =
      SCORING.QUALIFIED_BASE +
      optionalResults.reduce((sum, result) => sum + result.points, 0);
  }

  // ---- bonuses ------------------------------------------------------------
  // Only ever applied on top of a passing base; a referral cannot buy past a
  // hard requirement.
  const universityMatched =
    mandatoryPassed &&
    universityMatches(
      inputs.candidateUniversity,
      inputs.preferredUniversityNames,
    );

  const rawReferralBonus =
    mandatoryPassed && inputs.hasVerifiedReferral
      ? Math.max(0, inputs.referralBonusWeight)
      : 0;
  const rawUniversityBonus = universityMatched ? SCORING.UNIVERSITY_BONUS : 0;

  // Cap the pair together, scaling both down proportionally so neither silently
  // swallows the other's share.
  const rawBonusTotal = rawReferralBonus + rawUniversityBonus;
  const bonusScale =
    rawBonusTotal > SCORING.MAX_COMBINED_BONUS
      ? SCORING.MAX_COMBINED_BONUS / rawBonusTotal
      : 1;

  const referralBonusApplied = Number(
    (rawReferralBonus * bonusScale).toFixed(2),
  );
  const universityBonusApplied = Number(
    (rawUniversityBonus * bonusScale).toFixed(2),
  );

  const finalScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(baseScore + referralBonusApplied + universityBonusApplied),
    ),
  );

  const flags = evaluateFlags({
    mandatoryPassed,
    mandatoryTotal,
    mandatoryUnmet,
    baseScore,
    finalScore,
    bonusApplied: referralBonusApplied + universityBonusApplied,
    referralBonusApplied,
    missingJudgements,
  });

  return {
    overallScore: finalScore,
    mandatoryPassed,
    criteriaResults: [...mandatoryResults, ...optionalResults],
    referralBonusApplied,
    universityBonusApplied,
    overallRationale: inputs.overallRationale,
    ...flags,
  };
}
