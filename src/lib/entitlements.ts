import "server-only";

import { prisma } from "@/lib/prisma";
import {
  hasFeature,
  ingestionAllowance,
  needsFirstSubscription,
  quotaSnapshot,
  requiredTierFor,
  subscriptionIsActive,
  type BillableOrg,
  type Feature,
  type IngestionAllowance,
  type QuotaSnapshot,
} from "@/lib/plans";
import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * Server-side entitlement checks.
 *
 * `hasFeature` in `lib/plans.ts` is pure and takes a plain object so it can be
 * used in components with data already loaded. This module is the version that
 * fetches — for route handlers and server actions, where the caller controls
 * the request and hiding a button proves nothing.
 */

export interface OrgBilling extends BillableOrg {
  planTier: PlanTier;
  billingInterval: BillingInterval | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  /** End of the current paid period, ISO. Null until a subscription exists. */
  currentPeriodEnd: string | null;
  /** Cancelled but still inside a paid period — "ends on", not "renews on". */
  cancelAtPeriodEnd: boolean;
  applicationsUsedInCycle: number;
  poolCycleAnchor: string | null;
  quota: QuotaSnapshot;
}

export async function getOrgBilling(orgId: string): Promise<OrgBilling | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      planTier: true,
      billingInterval: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripeSubscriptionStatus: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      applicationsUsedInCycle: true,
      poolCycleAnchor: true,
      requiresSubscription: true,
    },
  });

  if (!org) return null;

  return {
    ...org,
    poolCycleAnchor: org.poolCycleAnchor?.toISOString() ?? null,
    currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
    quota: quotaSnapshot(org),
  };
}

/**
 * Whether the org may use the product at all, as opposed to a specific feature.
 *
 * `hasFeature` guards the three optional add-ons; this guards the paid product
 * itself. Both read `subscriptionIsActive`, so a lapsed or never-subscribed org
 * fails both — but they answer different questions and belong at different call
 * sites. Creating a job post is not a "feature", it is the thing being sold.
 *
 * Returns the reason as well as the verdict so a caller can say "choose a plan"
 * to a new org and "your subscription ended" to a lapsed one, rather than
 * showing both of them the same wrong sentence.
 */
export async function checkSubscription(
  orgId: string,
): Promise<
  | { active: true }
  | { active: false; reason: "never-subscribed" | "lapsed" | "no-org" }
> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      planTier: true,
      stripeSubscriptionStatus: true,
      requiresSubscription: true,
    },
  });

  if (!org) return { active: false, reason: "no-org" };
  if (subscriptionIsActive(org)) return { active: true };

  return {
    active: false,
    reason: needsFirstSubscription(org) ? "never-subscribed" : "lapsed",
  };
}

/** Fetching variant of `ingestionAllowance`, for the ingestion pipeline. */
export async function checkIngestionAllowance(
  orgId: string,
): Promise<IngestionAllowance> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      planTier: true,
      stripeSubscriptionStatus: true,
      requiresSubscription: true,
      applicationsUsedInCycle: true,
    },
  });

  // A deleted org gets nothing, same as a lapsed one.
  if (!org) return { allowed: false, reason: "subscription-inactive" };
  return ingestionAllowance(org);
}

export class FeatureLockedError extends Error {
  constructor(
    readonly feature: Feature,
    readonly currentTier: PlanTier,
  ) {
    super(
      `${feature} requires the ${requiredTierFor(feature).label} plan or above.`,
    );
    this.name = "FeatureLockedError";
  }
}

/**
 * Throws unless the org is entitled to the feature.
 *
 * The message names the plan needed, because a 403 that says only "forbidden"
 * turns an upsell into a support ticket.
 */
export async function assertFeature(
  orgId: string,
  feature: Feature,
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      planTier: true,
      stripeSubscriptionStatus: true,
      requiresSubscription: true,
    },
  });

  // No org row is a harder failure than a locked feature — treat it as locked
  // rather than granting access to something that does not exist.
  if (!org) throw new FeatureLockedError(feature, "SHORTLIST");

  if (!hasFeature(org, feature)) {
    throw new FeatureLockedError(feature, org.planTier);
  }
}

/** Non-throwing variant, for rendering. */
export async function checkFeature(
  orgId: string,
  feature: Feature,
): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      planTier: true,
      stripeSubscriptionStatus: true,
      requiresSubscription: true,
    },
  });
  return org ? hasFeature(org, feature) : false;
}
