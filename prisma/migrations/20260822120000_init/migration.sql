-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ADMIN', 'RECRUITER', 'VIEWER');

-- CreateEnum
CREATE TYPE "JobPostStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('NEW', 'PROCESSING', 'SCORED', 'SHORTLISTED', 'REJECTED', 'ERROR');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'starter',
    "applicationQuota" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_members" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'RECRUITER',
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_posts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "JobPostStatus" NOT NULL DEFAULT 'OPEN',
    "mandatoryCriteria" JSONB NOT NULL,
    "optionalCriteria" JSONB NOT NULL,
    "referralPriorityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "referralBonusWeight" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "job_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university_preferences" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "university_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_inboxes" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "forwardingAlias" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "email_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobPostId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "nationality" TEXT,
    "extractedData" JSONB,
    "resumeFileUrl" TEXT NOT NULL,
    "rawEmailSource" TEXT,
    "status" "CandidateStatus" NOT NULL DEFAULT 'NEW',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "referredById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_scores" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobPostId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_members_clerkUserId_idx" ON "org_members"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_orgId_clerkUserId_key" ON "org_members"("orgId", "clerkUserId");

-- CreateIndex
CREATE INDEX "job_posts_orgId_status_idx" ON "job_posts"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "university_preferences_orgId_name_key" ON "university_preferences"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "email_inboxes_forwardingAlias_key" ON "email_inboxes"("forwardingAlias");

-- CreateIndex
CREATE INDEX "candidates_orgId_jobPostId_idx" ON "candidates"("orgId", "jobPostId");

-- CreateIndex
CREATE INDEX "candidates_orgId_status_idx" ON "candidates"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_candidateId_key" ON "referrals"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_scores_candidateId_jobPostId_key" ON "candidate_scores"("candidateId", "jobPostId");

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_preferences" ADD CONSTRAINT "university_preferences_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_inboxes" ADD CONSTRAINT "email_inboxes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "job_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_scores" ADD CONSTRAINT "candidate_scores_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_scores" ADD CONSTRAINT "candidate_scores_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "job_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
