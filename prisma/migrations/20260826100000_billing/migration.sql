-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('SHORTLIST', 'PIPELINE', 'TALENT_POOL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "applicationsUsedInCycle" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "billingInterval" "BillingInterval",
ADD COLUMN     "planTier" "PlanTier" NOT NULL DEFAULT 'SHORTLIST',
ADD COLUMN     "poolCycleAnchor" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "stripeSubscriptionStatus" TEXT;

-- CreateTable
CREATE TABLE "usage_ledger_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT,
    "wasOverage" BOOLEAN NOT NULL,
    "stripeMeterEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_ledger_entries_organizationId_createdAt_idx" ON "usage_ledger_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "usage_ledger_entries_organizationId_wasOverage_idx" ON "usage_ledger_entries"("organizationId", "wasOverage");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeCustomerId_key" ON "organizations"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeSubscriptionId_key" ON "organizations"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Row Level Security for the new table
-- =============================================================================
--
-- Not in the billing spec, but required: `usage_ledger_entries` is tenant data
-- and every other tenant table in this schema is locked down. A new table with
-- no policy would be the only unprotected one, and the omission would be
-- invisible — RLS failures are silent.
--
-- The existing `organizations` policies already cover the new billing columns:
-- RLS is row-scoped, not column-scoped, so `stripeCustomerId` and the rest are
-- protected by the same `id = staffly_org_id()` rule with no change needed.
--
-- See the 20260822120100_rls_policies migration for the full reasoning.

grant select, insert, update, delete on public.usage_ledger_entries to authenticated;
revoke all on public.usage_ledger_entries from anon;

alter table public.usage_ledger_entries enable row level security;

create policy "usage_ledger_entries_tenant_isolation"
  on public.usage_ledger_entries
  for all
  to authenticated
  using ("organizationId" = public.staffly_org_id())
  with check ("organizationId" = public.staffly_org_id());
