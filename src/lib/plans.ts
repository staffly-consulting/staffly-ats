import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * The pricing table, in code.
 *
 * Quotas and limits are hardcoded here rather than read from Stripe on purpose:
 * ingestion checks the quota on every candidate, and that path must not depend
 * on a network call to a third party. Stripe is the source of truth for *money*;
 * this file is the source of truth for *entitlements*.
 *
 * Prices are here for display only — the amount actually charged is whatever the
 * Stripe Price says. If the two ever disagree, Stripe wins and this file is a
 * lying label, so keep them in step.
 */

export interface PlanDefinition {
  tier: PlanTier;
  label: string;
  /** USD per month on the monthly interval. Display only. */
  monthlyPrice: number;
  /** USD per year on the annual interval (~17% off). Display only. */
  annualPrice: number;
  /** Applications included per POOL MONTH — not per invoice. See poolCycleAnchor. */
  includedApplications: number;
  /** USD per application beyond the included monthly pool. Display only. */
  overagePerApplication: number;
  /** null = unlimited. */
  jobPostLimit: number | null;
  inboxLimit: number;
  /** Self-serve via Checkout, or sales-led. */
  selfServe: boolean;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  SHORTLIST: {
    tier: "SHORTLIST",
    label: "Shortlist",
    monthlyPrice: 79,
    annualPrice: 787,
    includedApplications: 150,
    overagePerApplication: 0.7,
    jobPostLimit: 3,
    inboxLimit: 1,
    selfServe: true,
  },
  PIPELINE: {
    tier: "PIPELINE",
    label: "Pipeline",
    monthlyPrice: 250,
    annualPrice: 2_490,
    includedApplications: 900,
    overagePerApplication: 0.5,
    jobPostLimit: 15,
    inboxLimit: 2,
    selfServe: true,
  },
  TALENT_POOL: {
    tier: "TALENT_POOL",
    label: "Talent Pool",
    monthlyPrice: 499,
    annualPrice: 4_970,
    includedApplications: 2_500,
    overagePerApplication: 0.35,
    jobPostLimit: null,
    inboxLimit: 5,
    selfServe: true,
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    label: "Enterprise",
    // Negotiated. The numbers below exist so the UI has something to render for
    // an org that has been placed on Enterprise out of band; they are not a
    // price anyone is quoted, and there is no self-serve path to this tier.
    monthlyPrice: 0,
    annualPrice: 0,
    includedApplications: Number.MAX_SAFE_INTEGER,
    overagePerApplication: 0,
    jobPostLimit: null,
    inboxLimit: 100,
    selfServe: false,
  },
};

/** Ascending. Index is the comparison key for "this tier and above". */
export const PLAN_ORDER: PlanTier[] = [
  "SHORTLIST",
  "PIPELINE",
  "TALENT_POOL",
  "ENTERPRISE",
];

/** Tiers a customer can reach through Checkout, in display order. */
export const SELF_SERVE_TIERS = PLAN_ORDER.filter(
  (tier) => PLANS[tier].selfServe,
);

export function planRank(tier: PlanTier): number {
  return PLAN_ORDER.indexOf(tier);
}

/* -------------------------------------------------------------------------- */
/* Features                                                                    */
/* -------------------------------------------------------------------------- */

export const FEATURES = {
  REFERRAL_PRIORITY: "REFERRAL_PRIORITY",
  UNIVERSITY_PREFERENCES: "UNIVERSITY_PREFERENCES",
  API_EXPORT: "API_EXPORT",
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

/** Minimum tier each feature requires. */
const FEATURE_MINIMUM: Record<Feature, PlanTier> = {
  REFERRAL_PRIORITY: "PIPELINE",
  UNIVERSITY_PREFERENCES: "PIPELINE",
  API_EXPORT: "TALENT_POOL",
};

export const FEATURE_LABELS: Record<Feature, string> = {
  REFERRAL_PRIORITY: "Referral prioritization",
  UNIVERSITY_PREFERENCES: "University preferences",
  API_EXPORT: "API access and candidate export",
};

/**
 * Subscription statuses that revoke access.
 *
 * ASSUMPTION, flagged for review: the spec asks for a "suspended/free state" on
 * `planTier` for a cancelled subscription, but no such convention exists in this
 * codebase and `PlanTier` has no free member. Rather than invent one, access is
 * gated on `stripeSubscriptionStatus` — which Stripe already owns and sets to
 * `canceled` itself, so there is one source of truth instead of two that can
 * disagree. `planTier` then records what the org *bought*, and status records
 * whether they are currently paying.
 *
 * A null status means "no subscription record at all": every org today, and any
 * org created before billing shipped. Those keep access — revoking on null
 * would lock out every existing customer the moment this deploys.
 */
const REVOKED_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

/** The subset of an Organization that entitlement checks need. */
export interface BillableOrg {
  planTier: PlanTier;
  stripeSubscriptionStatus: string | null;
}

export function subscriptionIsActive(org: BillableOrg): boolean {
  if (!org.stripeSubscriptionStatus) return true;
  return !REVOKED_STATUSES.has(org.stripeSubscriptionStatus);
}

/**
 * The entitlement check. Must be called at the point of use — a route handler
 * or server action — not only where a nav item is rendered. Hiding a button
 * stops nobody from calling the endpoint directly.
 */
export function hasFeature(org: BillableOrg, feature: Feature): boolean {
  if (!subscriptionIsActive(org)) return false;
  return planRank(org.planTier) >= planRank(FEATURE_MINIMUM[feature]);
}

/** The tier a customer would need to buy to unlock this feature. */
export function requiredTierFor(feature: Feature): PlanDefinition {
  return PLANS[FEATURE_MINIMUM[feature]];
}

/* -------------------------------------------------------------------------- */
/* Quotas                                                                      */
/* -------------------------------------------------------------------------- */

export function includedApplications(tier: PlanTier): number {
  return PLANS[tier].includedApplications;
}

export interface QuotaSnapshot {
  used: number;
  included: number;
  /** Applications past the included pool. 0 when within quota. */
  overage: number;
  /** 0–1, clamped. Meaningless for ENTERPRISE, which is effectively unmetered. */
  fraction: number;
  isOverQuota: boolean;
  overageCostUsd: number;
}

export function quotaSnapshot(
  org: BillableOrg & { applicationsUsedInCycle: number },
): QuotaSnapshot {
  const plan = PLANS[org.planTier];
  const included = plan.includedApplications;
  const used = Math.max(0, org.applicationsUsedInCycle);
  const overage = Math.max(0, used - included);

  return {
    used,
    included,
    overage,
    fraction: included === 0 ? 0 : Math.min(1, used / included),
    isOverQuota: overage > 0,
    overageCostUsd: Number((overage * plan.overagePerApplication).toFixed(2)),
  };
}

/**
 * Whether the application at 1-based position `count` is billable overage.
 *
 * Used at ingestion time with the *post-increment* count, so the first
 * application past the included pool is the first one billed.
 */
export function isOverageAt(
  tier: PlanTier,
  countAfterIncrement: number,
): boolean {
  return countAfterIncrement > includedApplications(tier);
}

/* -------------------------------------------------------------------------- */
/* Pool cycle arithmetic                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One month on from `date`, clamped to the end of shorter months.
 *
 * Lives here, in the one module both the server cron and the client billing
 * panel already import, because the two must agree exactly. If the cron rolls
 * an org over on the 28th while the panel promises the 3rd, the customer sees a
 * date that never arrives.
 *
 * Naive `setUTCMonth(+1)` overflows: 31 January becomes 3 March, which skips
 * February entirely and then permanently shifts the anchor to the 3rd. Anchors
 * on the 29th-31st are roughly a tenth of sign-ups, so this is routine.
 */
export function addOneMonth(date: Date): Date {
  const day = date.getUTCDate();
  const next = new Date(date);

  // Move to the 1st before shifting the month, so the shift cannot overflow.
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);

  // Then restore the day, clamped to what the target month actually has.
  const daysInTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, daysInTargetMonth));

  return next;
}

/**
 * The next reset date at or after `now`, given the org's anchor.
 *
 * Walks forward a month at a time rather than computing a difference, so an
 * anchor several cycles stale (dormant account, cron outage) lands on a real
 * anniversary of the anchor instead of a month after today.
 */
export function nextPoolReset(anchor: Date, now: Date = new Date()): Date {
  let next = addOneMonth(anchor);
  while (next <= now) {
    next = addOneMonth(next);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Display helpers                                                             */
/* -------------------------------------------------------------------------- */

export function priceFor(tier: PlanTier, interval: BillingInterval): number {
  return interval === "ANNUAL"
    ? PLANS[tier].annualPrice
    : PLANS[tier].monthlyPrice;
}

/** Percentage saved by paying annually, rounded — ~17% across all tiers. */
export function annualSavingPercent(tier: PlanTier): number {
  const plan = PLANS[tier];
  if (plan.monthlyPrice === 0) return 0;
  const yearlyAtMonthlyRate = plan.monthlyPrice * 12;
  return Math.round(
    ((yearlyAtMonthlyRate - plan.annualPrice) / yearlyAtMonthlyRate) * 100,
  );
}
