-- The hiring pipeline past the shortlist: interview, offer, hired.
--
-- `BEFORE 'REJECTED'` so enum order keeps following the real sequence and
-- mirrors the schema file — see the EXTRACTED migration for why that matters.
--
-- Safe inside Prisma's migration transaction on PG 12+ as long as the new
-- values are not *used* in the same transaction — nothing below references them.
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'INTERVIEW' BEFORE 'REJECTED';
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'OFFER' BEFORE 'REJECTED';
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'HIRED' BEFORE 'REJECTED';

-- CreateTable
-- Team notes on a candidate. `authorId` is a Clerk user id with no foreign key
-- on purpose: removing a member must not delete what they wrote.
CREATE TABLE "candidate_notes" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_notes_candidateId_createdAt_idx" ON "candidate_notes"("candidateId", "createdAt");

-- AddForeignKey
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS, the same shape as every other tenant table. No grant accompanies it: the
-- rls_hardening migration revoked the PostgREST roles' default privileges, so
-- this table is born unreachable and the policy is what holds the line the day
-- a grant is added. `npm run test:rls` checks both.
alter table public.candidate_notes enable row level security;

create policy "candidate_notes_tenant_isolation"
  on public.candidate_notes
  for all
  to authenticated
  using ("orgId" = public.staffly_org_id())
  with check ("orgId" = public.staffly_org_id());
