import "server-only";

import type { PlanTier } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isOverageAt } from "@/lib/plans";

/**
 * Application counting.
 *
 * Two things have to happen for every ingested candidate, and they have to
 * agree: the org's counter goes up, and a ledger row records that it did.
 * They run in one transaction so a crash between them cannot produce a billed
 * application with no audit trail, or an audit trail for an application that
 * was never counted.
 */

export interface UsageRecordResult {
  /** The org's count AFTER this application. */
  countAfterIncrement: number;
  /** True when this application is past the included pool and is billable. */
  wasOverage: boolean;
  planTier: PlanTier;
  stripeCustomerId: string | null;
  /** The ledger row, so a later meter report can stamp its Stripe event id. */
  ledgerEntryId: string;
}

/**
 * Counts one application against the org's pool.
 *
 * The increment is `{ increment: 1 }` rather than read-then-write: Prisma emits
 * `SET x = x + 1`, which Postgres applies atomically. Two concurrent ingests
 * therefore produce 2, not 1 — a read-modify-write here would silently
 * under-bill under exactly the load that generates the most revenue.
 *
 * Returns null when the org row is gone (deleted mid-ingest), which the caller
 * treats as "nothing to bill" rather than an error.
 */
export async function recordApplicationUsage(input: {
  orgId: string;
  candidateId: string;
}): Promise<UsageRecordResult | null> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: input.orgId },
      data: { applicationsUsedInCycle: { increment: 1 } },
      select: {
        planTier: true,
        applicationsUsedInCycle: true,
        stripeCustomerId: true,
      },
    });

    const countAfterIncrement = org.applicationsUsedInCycle;
    const wasOverage = isOverageAt(org.planTier, countAfterIncrement);

    // Written for EVERY application, not just billable ones. A disputed invoice
    // is reconciled by counting ledger rows in a window; that only works if the
    // non-billable ones are there too.
    const entry = await tx.usageLedgerEntry.create({
      data: {
        organizationId: input.orgId,
        candidateId: input.candidateId,
        wasOverage,
        // Stamped later, if and when Stripe accepts the meter event.
        stripeMeterEventId: null,
      },
      select: { id: true },
    });

    return {
      countAfterIncrement,
      wasOverage,
      planTier: org.planTier,
      stripeCustomerId: org.stripeCustomerId,
      ledgerEntryId: entry.id,
    };
  });
}

/** Reasons an overage application is deliberately never billed. */
export const BILLING_WAIVED = {
  /** Accrued while the subscription was in its free trial. */
  TRIAL: "TRIAL",
} as const;

/**
 * Records that an overage application will never be billed.
 *
 * Without this, a waived application is indistinguishable from one whose meter
 * event failed to report: both are `wasOverage: true` with a null event id, and
 * the reconciliation query that finds unbilled revenue would count trial usage
 * as money owed forever.
 */
export async function markMeterEventWaived(
  ledgerEntryId: string,
  reason: (typeof BILLING_WAIVED)[keyof typeof BILLING_WAIVED],
): Promise<void> {
  await prisma.usageLedgerEntry.update({
    where: { id: ledgerEntryId },
    data: { billingWaivedReason: reason },
  });
}

/** Marks a ledger entry as successfully reported to Stripe. */
export async function markMeterEventReported(
  ledgerEntryId: string,
  stripeMeterEventId: string,
): Promise<void> {
  await prisma.usageLedgerEntry.update({
    where: { id: ledgerEntryId },
    data: { stripeMeterEventId },
  });
}

/**
 * Overage that was counted but never confirmed by Stripe.
 *
 * The gap between `wasOverage: true` and a null `stripeMeterEventId` is, by
 * definition, unbilled revenue. Worth a dashboard or an alert once billing is
 * live — surfaced here so the query exists rather than being rediscovered
 * during a month-end discrepancy.
 */
export async function countUnreportedOverage(orgId: string): Promise<number> {
  return prisma.usageLedgerEntry.count({
    where: {
      organizationId: orgId,
      wasOverage: true,
      stripeMeterEventId: null,
    },
  });
}
