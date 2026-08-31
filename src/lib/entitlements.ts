import "server-only";

import { prisma } from "@/lib/prisma";
import {
  hasFeature,
  quotaSnapshot,
  requiredTierFor,
  type BillableOrg,
  type Feature,
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
      applicationsUsedInCycle: true,
      poolCycleAnchor: true,
    },
  });

  if (!org) return null;

  return {
    ...org,
    poolCycleAnchor: org.poolCycleAnchor?.toISOString() ?? null,
    quota: quotaSnapshot(org),
  };
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
    select: { planTier: true, stripeSubscriptionStatus: true },
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
    select: { planTier: true, stripeSubscriptionStatus: true },
  });
  return org ? hasFeature(org, feature) : false;
}
