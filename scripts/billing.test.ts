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
    PLANS.SHORTLIST.includedApplications === 1800 &&
    PLANS.SHORTLIST.overagePerApplication === 0.7,
);
check(
  "Pipeline: $250 / 10,800 / $0.50",
  PLANS.PIPELINE.monthlyPrice === 250 &&
    PLANS.PIPELINE.includedApplications === 10800 &&
    PLANS.PIPELINE.overagePerApplication === 0.5,
);
check(
  "Talent Pool: $499 / 30,000 / $0.35",
  PLANS.TALENT_POOL.monthlyPrice === 499 &&
    PLANS.TALENT_POOL.includedApplications === 30000 &&
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
    applicationsUsedInCycle: 1799,
  });
  check(
    "1,799 of 1,800 is not over quota",
    !within.isOverQuota && within.overage === 0,
  );

  const exact = quotaSnapshot({
    ...org("SHORTLIST"),
    applicationsUsedInCycle: 1800,
  });
  check(
    "exactly 1,800 is NOT over quota (inclusive)",
    !exact.isOverQuota,
    exact,
  );
  check("...and fraction is exactly 1", exact.fraction === 1);

  const over = quotaSnapshot({
    ...org("SHORTLIST"),
    applicationsUsedInCycle: 1900,
  });
  check("1,900 is 100 over", over.overage === 100);
  check(
    "100 × $0.70 = $70.00",
    over.overageCostUsd === 70,
    over.overageCostUsd,
  );
  check("fraction clamps at 1", over.fraction === 1);

  const pipeline = quotaSnapshot({
    ...org("PIPELINE"),
    applicationsUsedInCycle: 11_000,
  });
  check(
    "Pipeline: 200 over × $0.50 = $100.00",
    pipeline.overage === 200 && pipeline.overageCostUsd === 100,
    pipeline,
  );

  const talent = quotaSnapshot({
    ...org("TALENT_POOL"),
    applicationsUsedInCycle: 30_010,
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
check("application 1,800 is included", !isOverageAt("SHORTLIST", 1800));
check(
  "application 1,801 is the FIRST billed one",
  isOverageAt("SHORTLIST", 1801),
);
check(
  "Pipeline boundary at 10,801",
  !isOverageAt("PIPELINE", 10800) && isOverageAt("PIPELINE", 10801),
);
check(
  "Talent Pool boundary at 30,001",
  !isOverageAt("TALENT_POOL", 30000) && isOverageAt("TALENT_POOL", 30001),
);
check("Enterprise never bills overage", !isOverageAt("ENTERPRISE", 5_000_000));
check(
  "included quota lookup matches the table",
  includedApplications("PIPELINE") === 10800,
);

console.log("\n--- annual anchor advance (no drift) ---");
{
  // Mirrors the loop in reset-usage-pools.ts.
  const addOneYear = (d: Date) => {
    const n = new Date(d);
    n.setUTCFullYear(n.getUTCFullYear() + 1);
    return n;
  };
  const advance = (anchorIso: string, nowIso: string) => {
    let anchor = new Date(anchorIso);
    const now = new Date(nowIso);
    let cycles = 0;
    while (addOneYear(anchor) <= now) {
      anchor = addOneYear(anchor);
      cycles += 1;
    }
    return { anchor: anchor.toISOString(), cycles };
  };

  const oneYear = advance(
    "2025-03-15T09:00:00.000Z",
    "2026-03-16T03:00:00.000Z",
  );
  check(
    "advances exactly one year",
    oneYear.anchor === "2026-03-15T09:00:00.000Z",
    oneYear,
  );
  check("one cycle", oneYear.cycles === 1);

  // The drift test: the job runs late, at 03:00 rather than 09:00. Advancing
  // from `now` would move the anniversary six hours earlier, every year.
  check(
    "anchor keeps its original time-of-day even when the job runs late",
    oneYear.anchor.endsWith("T09:00:00.000Z"),
    oneYear.anchor,
  );

  const late = advance("2020-06-01T00:00:00.000Z", "2026-08-26T03:00:00.000Z");
  check("a 6-year-stale anchor catches up in one run", late.cycles === 6, late);
  check(
    "...landing on the correct anniversary",
    late.anchor === "2026-06-01T00:00:00.000Z",
    late.anchor,
  );

  const notDue = advance(
    "2026-06-01T00:00:00.000Z",
    "2026-08-26T03:00:00.000Z",
  );
  check("an anchor under a year old does not advance", notDue.cycles === 0);

  const exactlyOneYear = advance(
    "2025-08-26T03:00:00.000Z",
    "2026-08-26T03:00:00.000Z",
  );
  check(
    "exactly one year to the second does advance",
    exactlyOneYear.cycles === 1,
  );

  // Feb 29 → JS clamps to Mar 1 in a non-leap year. Documented, not a bug, but
  // worth knowing: a Feb 29 anchor drifts to Mar 1 permanently.
  const leap = advance("2024-02-29T00:00:00.000Z", "2025-03-02T00:00:00.000Z");
  check(
    "Feb 29 anchor rolls to Mar 1 in a non-leap year (known, documented)",
    leap.anchor.startsWith("2025-03-01"),
    leap.anchor,
  );
}

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
