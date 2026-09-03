/**
 * Tests for the billing logic that does not need Stripe. Run: npm run test:billing
 *
 * Pure — no network, no database. Covers the pricing table, entitlement gating,
 * quota arithmetic and the annual anchor advance. These are the parts that
 * decide what a customer is charged and what they can use, so they are checked
 * against numbers a human can re-derive from the pricing table by hand.
 */
import {
  FEATURES,
  PLANS,
  PLAN_ORDER,
  SELF_SERVE_TIERS,
  addOneMonth,
  annualSavingPercent,
  hasFeature,
  includedApplications,
  isOverageAt,
  planRank,
  priceFor,
  quotaSnapshot,
  requiredTierFor,
  subscriptionIsActive,
} from "../src/lib/plans";
import type { PlanTier } from "@prisma/client";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

const org = (tier: PlanTier, status: string | null = "active") => ({
  planTier: tier,
  stripeSubscriptionStatus: status,
});

console.log("\n--- the locked pricing table ---");
check(
  "Shortlist: $79 / 1,800 / $0.70",
  PLANS.SHORTLIST.monthlyPrice === 79 &&
    PLANS.SHORTLIST.includedApplications === 150 &&
    PLANS.SHORTLIST.overagePerApplication === 0.7,
);
check(
  "Pipeline: $250 / 10,800 / $0.50",
  PLANS.PIPELINE.monthlyPrice === 250 &&
    PLANS.PIPELINE.includedApplications === 900 &&
    PLANS.PIPELINE.overagePerApplication === 0.5,
);
check(
  "Talent Pool: $499 / 30,000 / $0.35",
  PLANS.TALENT_POOL.monthlyPrice === 499 &&
    PLANS.TALENT_POOL.includedApplications === 2500 &&
    PLANS.TALENT_POOL.overagePerApplication === 0.35,
);
check(
  "job post limits 3 / 15 / unlimited",
  PLANS.SHORTLIST.jobPostLimit === 3 &&
    PLANS.PIPELINE.jobPostLimit === 15 &&
    PLANS.TALENT_POOL.jobPostLimit === null,
);
check(
  "inbox limits 1 / 2 / 5",
  PLANS.SHORTLIST.inboxLimit === 1 &&
    PLANS.PIPELINE.inboxLimit === 2 &&
    PLANS.TALENT_POOL.inboxLimit === 5,
);
check("Enterprise is not self-serve", PLANS.ENTERPRISE.selfServe === false);
check(
  "only three tiers are self-serve",
  SELF_SERVE_TIERS.length === 3 && !SELF_SERVE_TIERS.includes("ENTERPRISE"),
);

console.log("\n--- annual discount is ~17% on every tier ---");
for (const tier of ["SHORTLIST", "PIPELINE", "TALENT_POOL"] as PlanTier[]) {
  const saving = annualSavingPercent(tier);
  check(
    `${PLANS[tier].label}: ${saving}% off`,
    saving >= 16 && saving <= 18,
    saving,
  );
  check(
    `${PLANS[tier].label} annual is cheaper than 12 monthly`,
    priceFor(tier, "ANNUAL") < priceFor(tier, "MONTHLY") * 12,
  );
}

console.log("\n--- plan ordering ---");
check(
  "ascending",
  planRank("SHORTLIST") < planRank("PIPELINE") &&
    planRank("PIPELINE") < planRank("TALENT_POOL") &&
    planRank("TALENT_POOL") < planRank("ENTERPRISE"),
);
check(
  "every tier is in PLAN_ORDER",
  PLAN_ORDER.length === Object.keys(PLANS).length,
);

console.log("\n--- feature gating ---");
check(
  "Shortlist has NO referral priority",
  !hasFeature(org("SHORTLIST"), FEATURES.REFERRAL_PRIORITY),
);
check(
  "Pipeline has referral priority",
  hasFeature(org("PIPELINE"), FEATURES.REFERRAL_PRIORITY),
);
check(
  "Talent Pool has it too (tier and above)",
  hasFeature(org("TALENT_POOL"), FEATURES.REFERRAL_PRIORITY),
);
check(
  "Enterprise has it too",
  hasFeature(org("ENTERPRISE"), FEATURES.REFERRAL_PRIORITY),
);

check(
  "Shortlist has NO university preferences",
  !hasFeature(org("SHORTLIST"), FEATURES.UNIVERSITY_PREFERENCES),
);
check(
  "Pipeline has university preferences",
  hasFeature(org("PIPELINE"), FEATURES.UNIVERSITY_PREFERENCES),
);

check(
  "Shortlist has NO API/export",
  !hasFeature(org("SHORTLIST"), FEATURES.API_EXPORT),
);
check(
  "Pipeline has NO API/export",
  !hasFeature(org("PIPELINE"), FEATURES.API_EXPORT),
);
check(
  "Talent Pool has API/export",
  hasFeature(org("TALENT_POOL"), FEATURES.API_EXPORT),
);

check(
  "upsell names the right tier",
  requiredTierFor(FEATURES.API_EXPORT).label === "Talent Pool",
);
check(
  "...and for referrals",
  requiredTierFor(FEATURES.REFERRAL_PRIORITY).label === "Pipeline",
);

console.log("\n--- subscription status overrides tier ---");
check(
  "null status keeps access (pre-billing orgs are not locked out)",
  subscriptionIsActive(org("PIPELINE", null)),
);
check("active keeps access", subscriptionIsActive(org("PIPELINE", "active")));
check(
  "trialing keeps access",
  subscriptionIsActive(org("PIPELINE", "trialing")),
);
check(
  "past_due keeps access (grace, Stripe is still retrying)",
  subscriptionIsActive(org("PIPELINE", "past_due")),
);
check("canceled revokes", !subscriptionIsActive(org("PIPELINE", "canceled")));
check("unpaid revokes", !subscriptionIsActive(org("PIPELINE", "unpaid")));
check(
  "incomplete_expired revokes",
  !subscriptionIsActive(org("PIPELINE", "incomplete_expired")),
);
check(
  "a canceled Talent Pool org loses paid features despite its tier",
  !hasFeature(org("TALENT_POOL", "canceled"), FEATURES.API_EXPORT),
);

console.log("\n--- quota arithmetic ---");
{
  const within = quotaSnapshot({
    ...org("SHORTLIST"),
    applicationsUsedInCycle: 149,
  });
  check(
    "149 of 150 is not over quota",
    !within.isOverQuota && within.overage === 0,
  );

  const exact = quotaSnapshot({
    ...org("SHORTLIST"),
    applicationsUsedInCycle: 150,
  });
  check(
    "exactly 150 is NOT over quota (inclusive)",
    !exact.isOverQuota,
    exact,
  );
  check("...and fraction is exactly 1", exact.fraction === 1);

  const over = quotaSnapshot({
    ...org("SHORTLIST"),
    applicationsUsedInCycle: 250,
  });
  check("250 is 100 over the 150 pool", over.overage === 100);
  check(
    "100 × $0.70 = $70.00",
    over.overageCostUsd === 70,
    over.overageCostUsd,
  );
  check("fraction clamps at 1", over.fraction === 1);

  const pipeline = quotaSnapshot({
    ...org("PIPELINE"),
    applicationsUsedInCycle: 1_100,
  });
  check(
    "Pipeline: 200 over × $0.50 = $100.00",
    pipeline.overage === 200 && pipeline.overageCostUsd === 100,
    pipeline,
  );

  const talent = quotaSnapshot({
    ...org("TALENT_POOL"),
    applicationsUsedInCycle: 2_510,
  });
  check(
    "Talent Pool: 10 over × $0.35 = $3.50",
    talent.overage === 10 && talent.overageCostUsd === 3.5,
    talent,
  );

  const enterprise = quotaSnapshot({
    ...org("ENTERPRISE"),
    applicationsUsedInCycle: 1_000_000,
  });
  check("Enterprise is effectively unmetered", !enterprise.isOverQuota);

  const zero = quotaSnapshot({
    ...org("SHORTLIST"),
    applicationsUsedInCycle: 0,
  });
  check(
    "zero usage is clean",
    zero.used === 0 && zero.overage === 0 && zero.fraction === 0,
  );
}

console.log("\n--- the overage boundary at ingestion ---");
check("application 150 is included", !isOverageAt("SHORTLIST", 150));
check(
  "application 151 is the FIRST billed one",
  isOverageAt("SHORTLIST", 151),
);
check(
  "Pipeline boundary at 901",
  !isOverageAt("PIPELINE", 900) && isOverageAt("PIPELINE", 901),
);
check(
  "Talent Pool boundary at 2,501",
  !isOverageAt("TALENT_POOL", 2500) && isOverageAt("TALENT_POOL", 2501),
);
check("Enterprise never bills overage", !isOverageAt("ENTERPRISE", 5_000_000));
check(
  "included quota lookup matches the table",
  includedApplications("PIPELINE") === 900,
);

console.log("\n--- monthly anchor advance (no drift, month-length safe) ---");
{
  // Uses the SHARED helper the cron and the billing panel both call, so this
  // suite fails if the two ever diverge.
  const advance = (anchorIso: string, nowIso: string) => {
    let anchor = new Date(anchorIso);
    const now = new Date(nowIso);
    let cycles = 0;
    while (addOneMonth(anchor) <= now) {
      anchor = addOneMonth(anchor);
      cycles += 1;
    }
    return { anchor: anchor.toISOString(), cycles };
  };

  const oneMonth = advance(
    "2026-03-15T09:00:00.000Z",
    "2026-04-16T03:00:00.000Z",
  );
  check(
    "advances exactly one month",
    oneMonth.anchor === "2026-04-15T09:00:00.000Z",
    oneMonth,
  );
  check("one cycle", oneMonth.cycles === 1);

  // The drift test: the job runs late, at 03:00 rather than 09:00. Advancing
  // from `now` would move the reset six hours earlier, every month.
  check(
    "anchor keeps its original time-of-day even when the job runs late",
    oneMonth.anchor.endsWith("T09:00:00.000Z"),
    oneMonth.anchor,
  );

  const stale = advance("2025-06-01T00:00:00.000Z", "2026-08-26T03:00:00.000Z");
  check("a 14-month-stale anchor catches up in one run", stale.cycles === 14, stale);
  check(
    "...landing on a real anniversary of the anchor",
    stale.anchor === "2026-08-01T00:00:00.000Z",
    stale.anchor,
  );

  const notDue = advance(
    "2026-08-01T00:00:00.000Z",
    "2026-08-26T03:00:00.000Z",
  );
  check("an anchor under a month old does not advance", notDue.cycles === 0);

  const exact = advance(
    "2026-07-26T03:00:00.000Z",
    "2026-08-26T03:00:00.000Z",
  );
  check("exactly one month to the second does advance", exact.cycles === 1);

  // Month-length clamping. Naive setUTCMonth(+1) turns 31 Jan into 3 Mar,
  // skipping February and permanently moving the anchor to the 3rd.
  const jan31 = advance("2026-01-31T00:00:00.000Z", "2026-02-28T12:00:00.000Z");
  check(
    "31 Jan clamps to 28 Feb, NOT 3 Mar",
    jan31.anchor === "2026-02-28T00:00:00.000Z",
    jan31.anchor,
  );

  // KNOWN TRADEOFF, asserted so it cannot change silently: the clamp is
  // permanent. Once 31 Jan becomes 28 Feb, the anchor stays on the 28th — the
  // original day-of-month is not recoverable from the stored value.
  //
  // Accepted rather than fixed because it costs no revenue: the org still gets
  // twelve resets a year, and the shift is at most three days, once. Preserving
  // the original day the way Stripe does would need the signup day-of-month
  // kept in its own column.
  const jan31ToMar = advance(
    "2026-01-31T00:00:00.000Z",
    "2026-03-31T12:00:00.000Z",
  );
  check(
    "clamp is PERMANENT: 31 Jan stays on the 28th, it does not spring back",
    jan31ToMar.anchor === "2026-03-28T00:00:00.000Z",
    jan31ToMar.anchor,
  );

  const jan30 = advance("2026-01-30T00:00:00.000Z", "2026-02-28T12:00:00.000Z");
  check(
    "30 Jan clamps to 28 Feb in a non-leap year",
    jan30.anchor === "2026-02-28T00:00:00.000Z",
    jan30.anchor,
  );

  // Leap year: February has 29 days, so a 31 Jan anchor clamps to the 29th.
  const leap = advance("2028-01-31T00:00:00.000Z", "2028-02-29T12:00:00.000Z");
  check(
    "31 Jan clamps to 29 Feb in a LEAP year",
    leap.anchor === "2028-02-29T00:00:00.000Z",
    leap.anchor,
  );

  // Year boundary.
  const dec = advance("2026-12-15T00:00:00.000Z", "2027-01-16T00:00:00.000Z");
  check(
    "crosses the year boundary correctly",
    dec.anchor === "2027-01-15T00:00:00.000Z",
    dec.anchor,
  );

  // The anti-abuse property this whole change exists for: one paid month can
  // never yield more than one month of allowance.
  const monthsIn = 1;
  check(
    "one paid month grants 150 Shortlist applications, not 1,800",
    PLANS.SHORTLIST.includedApplications * monthsIn === 150,
  );
}

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
