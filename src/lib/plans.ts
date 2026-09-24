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

/**
 * Free trial length, in days, applied at the first Checkout only.
 *
 * Fourteen rather than seven because of how this product delivers value: an
 * application has to *arrive* before anything is scored, and that means
 * forwarding a careers inbox — often an IT ticket — then posting a job and
 * waiting for candidates. A week can easily elapse with nothing ingested, which
 * charges the customer before they have seen the product work.
 *
 * Stripe owns the trial itself: this is passed as `trial_period_days` on the
 * Checkout session, the subscription sits in `trialing`, and Stripe converts it
 * without us tracking a date. Nothing in this codebase should compute a trial
 * end — read `currentPeriodEnd`, which during a trial is the trial end.
 */
export const TRIAL_PERIOD_DAYS = 14;

/**
 * Applications a trial may ingest in total, on every tier.
 *
 * Trial overage is waived, so without a cap a trial is unlimited model calls
 * that can be cancelled before the first charge. Flat rather than the plan's
 * pool: the tier a trialist picked says nothing about what they will pay, and
 * 50 is enough to see screening work on a real job post.
 */
export const TRIAL_APPLICATION_CAP = 50;

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
  API_ACCESS: "API_ACCESS",
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

/** Minimum tier each feature requires. */
const FEATURE_MINIMUM: Record<Feature, PlanTier> = {
  REFERRAL_PRIORITY: "PIPELINE",
  UNIVERSITY_PREFERENCES: "PIPELINE",
  API_ACCESS: "TALENT_POOL",
};

export const FEATURE_LABELS: Record<Feature, string> = {
  REFERRAL_PRIORITY: "Referral prioritization",
  UNIVERSITY_PREFERENCES: "University preferences",
  API_ACCESS: "API access and integrations",
};

/**
 * NOTE ON EXPORT — deliberately absent from the table above.
 *
 * This was once `API_EXPORT`, "API access and candidate export", gated at
 * TALENT_POOL. Those are two different products wearing one flag, and only one
 * of them belongs behind a paywall.
 *
 * Downloading a shortlist is the core recruiter workflow — screen two hundred
 * applicants, take the best twelve to the hiring manager. Charging $499/month
 * for it does not sell upgrades; it makes a company's own candidate data feel
 * held hostage, which is the fastest way to lose a deal for a screening tool.
 * The data is also personal information belonging to real applicants, and
 * "pay us to get it out" is an argument nobody wants to have with a regulator
 * under GDPR or Thailand's PDPA.
 *
 * So export ships on every plan and is gated on ROLE instead — see
 * `PERMISSIONS.CANDIDATE_EXPORT`. Programmatic access stays paid as
 * `API_ACCESS`, where the tier boundary is defensible.
 */

/**
 * Subscription statuses that revoke access.
 *
 * Access is gated on `stripeSubscriptionStatus` rather than on a free member of
 * `PlanTier`: Stripe already owns that column and sets it to `canceled` itself,
 * so there is one source of truth instead of two that can disagree. `planTier`
 * records what the org *bought*; status records whether they are still paying.
 *
 * `trialing` is deliberately absent — a trial is active access. `past_due` is
 * absent too: Stripe is still retrying the card, and cutting a customer off
 * mid-dunning turns a recoverable payment failure into a churn event.
 */
const REVOKED_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

/** Statuses that mean "paying or in trial", for display. */
export function isTrialing(org: BillableOrg): boolean {
  return org.stripeSubscriptionStatus === "trialing";
}

/** The subset of an Organization that entitlement checks need. */
export interface BillableOrg {
  planTier: PlanTier;
  stripeSubscriptionStatus: string | null;
  /** False for orgs granted access without a subscription. See the schema. */
  requiresSubscription: boolean;
}

/**
 * Whether the org may use paid features right now.
 *
 * The null-status case is the one that needs the extra column. A null status is
 * two different situations wearing the same value — "signed up and never
 * subscribed" and "existed before billing shipped" — and only the first should
 * lose access. `requiresSubscription` is what tells them apart: it defaults to
 * true for every new org, and the paywall migration backfilled it to false for
 * everyone who was already here.
 */
export function subscriptionIsActive(org: BillableOrg): boolean {
  if (!org.stripeSubscriptionStatus) return !org.requiresSubscription;
  return !REVOKED_STATUSES.has(org.stripeSubscriptionStatus);
}

/**
 * True when the org has simply never bought anything — as opposed to having
 * bought and lapsed. The two need different words in the UI: one is "choose a
 * plan", the other is "your subscription ended".
 */
export function needsFirstSubscription(org: BillableOrg): boolean {
  return org.requiresSubscription && org.stripeSubscriptionStatus === null;
}

/**
 * Whether this org's next Checkout carries the free trial.
 *
 * Pure, and the single definition of the rule: `createCheckoutSession` decides
 * what Stripe is asked for, and the UI decides whether to promise a trial. If
 * those two ever disagreed, the buyer would be told "free for 14 days" on a
 * page whose button charges them immediately.
 *
 * A trial is a once-per-org thing. Both columns are checked because they fail
 * in different directions: the id can be present while a status write is still
 * in flight, and a status of `canceled` outlives a subscription that is gone.
 */
export function isTrialEligible(org: {
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
}): boolean {
  return (
    org.stripeSubscriptionId === null && org.stripeSubscriptionStatus === null
  );
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

export type IngestionAllowance =
  /** `remaining` is null when uncapped — JSON-safe, unlike Infinity. */
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: "subscription-inactive" | "trial-cap-reached" };

/**
 * How many more applications this org may ingest right now.
 *
 * Every ingested application costs a Claude call, so this is the gate that
 * stops an org with no paying subscription from spending our Anthropic budget.
 *
 * A trial is capped at `TRIAL_APPLICATION_CAP`. Paying orgs stay uncapped:
 * past the pool they are billed overage, which is the point.
 */
export function ingestionAllowance(
  org: BillableOrg & { applicationsUsedInCycle: number },
): IngestionAllowance {
  if (!subscriptionIsActive(org)) {
    return { allowed: false, reason: "subscription-inactive" };
  }
  if (!isTrialing(org)) return { allowed: true, remaining: null };

  const remaining =
    TRIAL_APPLICATION_CAP - Math.max(0, org.applicationsUsedInCycle);
  return remaining > 0
    ? { allowed: true, remaining }
    : { allowed: false, reason: "trial-cap-reached" };
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
