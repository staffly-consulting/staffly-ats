/**
 * Tests for the deterministic scoring layer. Run: npm run test:scoring
 *
 * Pure — no model, no database, no network. This is the half of scoring a
 * customer might one day ask us to justify, so it is tested exhaustively and
 * every number below is one a human can re-derive by hand.
 */
import { SCORING, computeScore, type ScoringInputs } from "../src/lib/scoring";
import type { Criterion } from "../src/lib/types";
import { scoringResultSchema } from "../src/lib/validations/scoring";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

const mandatory = (id: string, label = id): Criterion => ({
  id,
  type: "custom",
  label,
  weight: 10,
});
const optional = (id: string, weight: number, label = id): Criterion => ({
  id,
  type: "custom",
  label,
  weight,
});

function score(overrides: Partial<ScoringInputs>) {
  const base: ScoringInputs = {
    mandatoryCriteria: [],
    optionalCriteria: [],
    judgements: [],
    overallRationale: "test",
    referralBonusWeight: 0,
    hasVerifiedReferral: false,
    candidateUniversity: null,
    preferredUniversityNames: [],
  };
  return computeScore({ ...base, ...overrides });
}

/** Every criterion met. */
function allMet(...criteria: Criterion[]) {
  return criteria.map((c) => ({
    criterionId: c.id,
    met: true,
    rationale: `met ${c.id}`,
  }));
}

console.log("\n--- mandatory gate ---");
{
  const m = [mandatory("m1"), mandatory("m2"), mandatory("m3")];

  const none = score({
    mandatoryCriteria: m,
    judgements: m.map((c) => ({
      criterionId: c.id,
      met: false,
      rationale: "no",
    })),
  });
  check("0 of 3 mandatory → 0", none.overallScore === 0, none.overallScore);
  check("mandatoryPassed false", none.mandatoryPassed === false);

  const one = score({
    mandatoryCriteria: m,
    judgements: [
      { criterionId: "m1", met: true, rationale: "y" },
      { criterionId: "m2", met: false, rationale: "n" },
      { criterionId: "m3", met: false, rationale: "n" },
    ],
  });
  check(
    "1 of 3 mandatory → 7 (20 × 1/3)",
    one.overallScore === 7,
    one.overallScore,
  );

  const two = score({
    mandatoryCriteria: m,
    judgements: [
      { criterionId: "m1", met: true, rationale: "y" },
      { criterionId: "m2", met: true, rationale: "y" },
      { criterionId: "m3", met: false, rationale: "n" },
    ],
  });
  check(
    "2 of 3 mandatory → 13 (20 × 2/3)",
    two.overallScore === 13,
    two.overallScore,
  );
  check(
    "the ramp is monotonic, not a cliff",
    none.overallScore < one.overallScore && one.overallScore < two.overallScore,
  );
  check(
    "never exceeds the unqualified ceiling",
    two.overallScore <= SCORING.UNQUALIFIED_MAX,
  );
}

console.log("\n--- qualified: base + weighted optional ---");
{
  const m = [mandatory("m1")];
  const o = [optional("o1", 7), optional("o2", 4), optional("o3", 5)]; // total 16

  const noOptionalMet = score({
    mandatoryCriteria: m,
    optionalCriteria: o,
    judgements: allMet(...m),
  });
  check(
    "all mandatory, no optional met → 50",
    noOptionalMet.overallScore === 50,
  );

  const allOptionalMet = score({
    mandatoryCriteria: m,
    optionalCriteria: o,
    judgements: allMet(...m, ...o),
  });
  check(
    "all mandatory + all optional → 100",
    allOptionalMet.overallScore === 100,
  );

  const partial = score({
    mandatoryCriteria: m,
    optionalCriteria: o,
    judgements: [
      ...allMet(...m),
      { criterionId: "o1", met: true, rationale: "y" },
    ],
  });
  // 50 + (7/16 × 50) = 50 + 21.875 → 72
  check(
    "weight 7 of 16 met → 72",
    partial.overallScore === 72,
    partial.overallScore,
  );
  check(
    "points recorded on the met criterion",
    Math.abs(
      (partial.criteriaResults.find((r) => r.criterionId === "o1")?.points ??
        0) - 21.88,
    ) < 0.02,
    partial.criteriaResults.find((r) => r.criterionId === "o1")?.points,
  );

  const heavier = score({
    mandatoryCriteria: m,
    optionalCriteria: o,
    judgements: [
      ...allMet(...m),
      { criterionId: "o2", met: true, rationale: "y" },
      { criterionId: "o3", met: true, rationale: "y" },
    ],
  });
  // 50 + ((4+5)/16 × 50) = 78.125 → 78
  check(
    "weights 4+5 of 16 → 78",
    heavier.overallScore === 78,
    heavier.overallScore,
  );
  check(
    "heavier weight scores higher",
    partial.overallScore < heavier.overallScore,
  );
}

console.log("\n--- mandatory points are always zero ---");
{
  const m = [mandatory("m1"), mandatory("m2")];
  const result = score({ mandatoryCriteria: m, judgements: allMet(...m) });
  check(
    "mandatory criteria contribute 0 points (they gate, not add)",
    result.criteriaResults.every((r) => !r.isMandatory || r.points === 0),
  );
}

console.log("\n--- optional points suppressed when the gate fails ---");
{
  const m = [mandatory("m1")];
  const o = [optional("o1", 10)];
  const result = score({
    mandatoryCriteria: m,
    optionalCriteria: o,
    judgements: [
      { criterionId: "m1", met: false, rationale: "n" },
      { criterionId: "o1", met: true, rationale: "y" },
    ],
  });
  check(
    "optional shows met",
    result.criteriaResults.find((r) => r.criterionId === "o1")?.met === true,
  );
  check(
    "but contributes 0 points, since nothing counted",
    result.criteriaResults.find((r) => r.criterionId === "o1")?.points === 0,
  );
  check(
    "score stays on the unqualified ramp",
    result.overallScore === 0,
    result.overallScore,
  );
}

console.log("\n--- degenerate criteria sets ---");
{
  const m = [mandatory("m1")];
  const noOptional = score({ mandatoryCriteria: m, judgements: allMet(...m) });
  check(
    "no optional criteria + all mandatory met → 100, not 50",
    noOptional.overallScore === 100,
    noOptional.overallScore,
  );

  const zeroWeights = score({
    mandatoryCriteria: m,
    optionalCriteria: [optional("o1", 0), optional("o2", 0)],
    judgements: [
      ...allMet(...m),
      { criterionId: "o1", met: true, rationale: "y" },
    ],
  });
  check(
    "all-zero optional weights split evenly instead of NaN",
    zeroWeights.overallScore === 75,
    zeroWeights.overallScore,
  );
  check("score is a real number", Number.isFinite(zeroWeights.overallScore));

  const noMandatory = score({
    optionalCriteria: [optional("o1", 5)],
    judgements: [{ criterionId: "o1", met: true, rationale: "y" }],
  });
  check(
    "no mandatory criteria passes the gate vacuously",
    noMandatory.mandatoryPassed,
  );
  check("and scores on the optional scale", noMandatory.overallScore === 100);

  const empty = score({});
  check(
    "no criteria at all does not crash",
    Number.isFinite(empty.overallScore),
  );
}

console.log("\n--- bonuses ---");
{
  const m = [mandatory("m1")];
  const o = [optional("o1", 10)];
  const qualified = {
    mandatoryCriteria: m,
    optionalCriteria: o,
    judgements: allMet(...m),
  };

  const referral = score({
    ...qualified,
    referralBonusWeight: 5,
    hasVerifiedReferral: true,
  });
  check(
    "referral adds its weight → 55",
    referral.overallScore === 55,
    referral.overallScore,
  );
  check("recorded as applied", referral.referralBonusApplied === 5);

  const unverified = score({
    ...qualified,
    referralBonusWeight: 5,
    hasVerifiedReferral: false,
  });
  check(
    "no Referral row → no bonus (a candidate's own claim is not enough)",
    unverified.overallScore === 50 && unverified.referralBonusApplied === 0,
  );

  const university = score({
    ...qualified,
    candidateUniversity: "Massachusetts Institute of Technology",
    preferredUniversityNames: ["MIT"],
  });
  check(
    "fuzzy university match applies the bonus",
    university.universityBonusApplied === SCORING.UNIVERSITY_BONUS,
    university.universityBonusApplied,
  );

  const acronymReverse = score({
    ...qualified,
    candidateUniversity: "MIT",
    preferredUniversityNames: ["Massachusetts Institute of Technology"],
  });
  check(
    "acronym match works in reverse too",
    acronymReverse.universityBonusApplied === SCORING.UNIVERSITY_BONUS,
    acronymReverse.universityBonusApplied,
  );

  const substring = score({
    ...qualified,
    candidateUniversity: "Stanford University",
    preferredUniversityNames: ["Stanford"],
  });
  check(
    "substring match after stopwords",
    substring.universityBonusApplied === SCORING.UNIVERSITY_BONUS,
  );

  const noMatch = score({
    ...qualified,
    candidateUniversity: "University of Nowhere",
    preferredUniversityNames: ["MIT", "Stanford"],
  });
  check(
    "unrelated university gets nothing",
    noMatch.universityBonusApplied === 0,
  );

  const capped = score({
    ...qualified,
    referralBonusWeight: 10,
    hasVerifiedReferral: true,
    candidateUniversity: "Stanford University",
    preferredUniversityNames: ["Stanford"],
  });
  check(
    "referral + university capped at +10 combined",
    capped.referralBonusApplied + capped.universityBonusApplied ===
      SCORING.MAX_COMBINED_BONUS,
    [capped.referralBonusApplied, capped.universityBonusApplied],
  );
  check(
    "both are scaled down, neither zeroed",
    capped.universityBonusApplied > 0,
  );

  const unqualifiedReferral = score({
    mandatoryCriteria: m,
    judgements: [{ criterionId: "m1", met: false, rationale: "n" }],
    referralBonusWeight: 10,
    hasVerifiedReferral: true,
  });
  check(
    "a referral cannot buy past a failed mandatory requirement",
    unqualifiedReferral.referralBonusApplied === 0 &&
      unqualifiedReferral.overallScore === 0,
  );

  const clamped = score({
    ...qualified,
    judgements: allMet(...m, ...o),
    referralBonusWeight: 10,
    hasVerifiedReferral: true,
  });
  check("100 + bonus clamps to 100", clamped.overallScore === 100);
}

console.log("\n--- flagging (deterministic, never model-decided) ---");
{
  const three = [mandatory("m1"), mandatory("m2"), mandatory("m3")];

  const nearMiss = score({
    mandatoryCriteria: three,
    judgements: [
      { criterionId: "m1", met: true, rationale: "y" },
      { criterionId: "m2", met: true, rationale: "y" },
      { criterionId: "m3", met: false, rationale: "n" },
    ],
  });
  check("1 of 3 mandatory unmet is flagged", nearMiss.flagged);
  check(
    "with a readable reason",
    /only 1 of 3/.test(nearMiss.flagReason ?? ""),
    nearMiss.flagReason,
  );

  const farMiss = score({
    mandatoryCriteria: three,
    judgements: three.map((c) => ({
      criterionId: c.id,
      met: false,
      rationale: "n",
    })),
  });
  check("3 of 3 unmet is NOT flagged (clearly unqualified)", !farMiss.flagged);

  const single = score({
    mandatoryCriteria: [mandatory("m1")],
    judgements: [{ criterionId: "m1", met: false, rationale: "n" }],
  });
  check("a lone unmet mandatory is not a near-miss", !single.flagged);

  const clean = score({
    mandatoryCriteria: [mandatory("m1")],
    optionalCriteria: [optional("o1", 5)],
    judgements: allMet(mandatory("m1"), optional("o1", 5)),
  });
  check(
    "a clean pass is not flagged",
    !clean.flagged && clean.flagReason === null,
  );

  // Base 50, referral +10 → 60. Base is above threshold already, so no flag.
  const strongReferral = score({
    mandatoryCriteria: [mandatory("m1")],
    optionalCriteria: [optional("o1", 5)],
    judgements: [
      ...allMet(mandatory("m1")),
      { criterionId: "o1", met: false, rationale: "n" },
    ],
    referralBonusWeight: 10,
    hasVerifiedReferral: true,
  });
  check(
    "referral on an already-qualified candidate is not flagged",
    !strongReferral.flagged,
    strongReferral.flagReason,
  );

  const missing = score({
    mandatoryCriteria: [mandatory("m1"), mandatory("m2")],
    judgements: [{ criterionId: "m1", met: true, rationale: "y" }],
  });
  check("a missing model verdict is flagged", missing.flagged);
  check("and counted as unmet, not as met", !missing.mandatoryPassed);
  check(
    "with the count in the reason",
    /no verdict for 1/.test(missing.flagReason ?? ""),
    missing.flagReason,
  );
}

console.log("\n--- output validates against the persisted schema ---");
{
  const result = score({
    mandatoryCriteria: [mandatory("m1", "5+ years React")],
    optionalCriteria: [optional("o1", 7, "TypeScript")],
    judgements: allMet(mandatory("m1"), optional("o1", 7)),
    referralBonusWeight: 3,
    hasVerifiedReferral: true,
  });
  const parsed = scoringResultSchema.safeParse(result);
  check(
    "scoringResultSchema accepts the output",
    parsed.success,
    parsed.success ? "" : parsed.error.issues,
  );
  check("overallScore is an integer", Number.isInteger(result.overallScore));
  check(
    "labels are copied for display",
    result.criteriaResults[0].label === "5+ years React",
  );
}

console.log("\n--- determinism ---");
{
  const inputs: Partial<ScoringInputs> = {
    mandatoryCriteria: [mandatory("m1")],
    optionalCriteria: [optional("o1", 3), optional("o2", 9)],
    judgements: [
      { criterionId: "m1", met: true, rationale: "y" },
      { criterionId: "o2", met: true, rationale: "y" },
    ],
    referralBonusWeight: 4,
    hasVerifiedReferral: true,
  };
  const runs = Array.from({ length: 25 }, () => score(inputs).overallScore);
  check("25 identical inputs → 25 identical scores", new Set(runs).size === 1, [
    ...new Set(runs),
  ]);
  console.log(`       (score: ${runs[0]})`);
}

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
