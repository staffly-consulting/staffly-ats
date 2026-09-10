-- AlterTable
-- New orgs must subscribe; there is no free tier.
ALTER TABLE "organizations" ADD COLUMN     "requiresSubscription" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: every organization that already exists predates the paywall and
-- never agreed to pay for anything. Leaving them on the `true` default would
-- revoke access for the entire customer base the moment this deploys.
--
-- Runs before any new row can be written, so it cannot catch a genuine new
-- signup: the column is added and backfilled inside one transaction.
UPDATE "organizations" SET "requiresSubscription" = false;

-- AlterTable
-- Overage that was deliberately not billed (today: accrued during a free
-- trial). Distinguishes a waived application from one whose meter event has
-- simply not been reported yet, which would otherwise look identical.
ALTER TABLE "usage_ledger_entries" ADD COLUMN     "billingWaivedReason" TEXT;
