import "server-only";

import type { CandidateStatus } from "@prisma/client";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  parseExtractedData,
  type ExtractedResumeData,
} from "@/lib/validations/resume";
import {
  parseScoreBreakdown,
  type CriterionResult,
} from "@/lib/validations/scoring";

/**
 * Org-scoped candidate queries. As everywhere, `orgId` is a required argument
 * because Prisma bypasses RLS — see `src/lib/prisma.ts`.
 */

export interface InboxCandidate {
  id: string;
  name: string | null;
  email: string | null;
  resumeFileUrl: string;
  /** Filename pulled off the storage key, for display. */
  resumeFilename: string;
  ingestedAt: string;
}

/**
 * The unassigned queue: everything ingested that no one has routed to a role
 * yet. This is the stopgap surface until automatic job matching exists.
 */
export async function listInboxCandidates(
  orgId: string,
): Promise<InboxCandidate[]> {
  const rows = await prisma.candidate.findMany({
    where: { orgId, jobPostId: null, status: "NEW" },
    orderBy: { ingestedAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      resumeFileUrl: true,
      ingestedAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    resumeFilename: row.resumeFileUrl.split("/").pop() ?? "resume",
    ingestedAt: row.ingestedAt.toISOString(),
  }));
}

/**
 * A candidate as the job post table renders it.
 *
 * Almost every field here is either provisional or absent, and the type says so
 * rather than pretending otherwise:
 *
 *   - `name` / `email` / `phone` come from the email ENVELOPE (Step 4), not the
 *     resume. The sender is frequently the forwarding recruiter, not the
 *     applicant.
 *   - `extractedData` is null until the extraction step exists.
 *   - `score` is null until scoring exists — there is no `CandidateScore` row.
 *
 * The UI reads these nulls literally. Nothing is filled in with a plausible
 * default, because a plausible default here is indistinguishable from real data.
 */
export interface JobPostCandidate {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  status: CandidateStatus;
  resumeFileUrl: string;
  resumeFilename: string;
  ingestedAt: string;
  /** Null until the scoring step writes a `CandidateScore`. */
  score: number | null;
  /** Per-criterion breakdown from the score, empty when unscored. */
  scoreBreakdown: CriterionResult[];
  scoreRationale: string | null;
  /** Null when unscored. False means a hard requirement is unmet. */
  mandatoryPassed: boolean | null;
  referralBonusApplied: number;
  universityBonusApplied: number;
  flagged: boolean;
  flagReason: string | null;
  scoredAt: string | null;
  /** Parsed `extractedData`, or null when extraction has not run (or failed). */
  extracted: ExtractedResumeData | null;
  /** True when a `Referral` row points at this candidate. */
  referral: boolean;
}

/**
 * Filters applied in SQL, not in the browser.
 *
 * Client-side filtering would mean shipping every candidate to render a subset,
 * which stops working somewhere around the first few hundred applicants — and
 * this is a product whose whole point is high application volume.
 */
export interface CandidateQueryFilters {
  /** Minimum `CandidateScore.overallScore`. Excludes unscored candidates. */
  minScore?: number;
  referralOnly?: boolean;
  /** Matched against `extractedData.university` inside the Json column. */
  university?: string;
  nationality?: string;
  flaggedOnly?: boolean;
}

function buildWhere(
  orgId: string,
  jobPostId: string,
  filters: CandidateQueryFilters = {},
): Prisma.CandidateWhereInput {
  const where: Prisma.CandidateWhereInput = { orgId, jobPostId };

  if (filters.minScore && filters.minScore > 0) {
    // `some` on the relation: a candidate qualifies when they have a score for
    // THIS job post at or above the threshold. Unscored candidates drop out,
    // which is the honest reading of "show me everyone above 70".
    where.scores = {
      some: { jobPostId, overallScore: { gte: filters.minScore } },
    };
  }

  if (filters.flaggedOnly) {
    where.scores = {
      ...(where.scores ?? {}),
      some: { ...(where.scores?.some ?? {}), jobPostId, flagged: true },
    };
  }

  // `isNot: null` on a one-to-one relation is how Prisma expresses "has one".
  if (filters.referralOnly) where.referral = { isNot: null };

  if (filters.nationality) where.nationality = filters.nationality;

  if (filters.university) {
    // University lives inside the extractedData Json column, so this is a JSON
    // path filter rather than a column comparison.
    where.extractedData = {
      path: ["university"],
      equals: filters.university,
    };
  }

  return where;
}

/**
 * Candidates assigned to one job post.
 *
 * Scoped by `orgId` as well as `jobPostId`: the job post id arrives from the
 * URL and is therefore attacker-controlled. Filtering on both means a guessed
 * id from another tenant returns nothing rather than that tenant's candidates.
 */
export async function listJobPostCandidates(
  orgId: string,
  jobPostId: string,
  filters: CandidateQueryFilters = {},
): Promise<JobPostCandidate[]> {
  const rows = await prisma.candidate.findMany({
    where: buildWhere(orgId, jobPostId, filters),
    orderBy: { ingestedAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      nationality: true,
      status: true,
      resumeFileUrl: true,
      extractedData: true,
      ingestedAt: true,
      referral: { select: { id: true } },
      // Ordered so the newest score wins if several ever exist.
      scores: {
        select: {
          overallScore: true,
          breakdown: true,
          rationale: true,
          flagged: true,
          flagReason: true,
          scoredAt: true,
        },
        orderBy: { scoredAt: "desc" },
        take: 1,
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    nationality: row.nationality,
    status: row.status,
    resumeFileUrl: row.resumeFileUrl,
    resumeFilename: row.resumeFileUrl.split("/").pop() ?? "resume",
    ingestedAt: row.ingestedAt.toISOString(),
    score: row.scores[0]?.overallScore ?? null,
    scoreBreakdown: parseScoreBreakdown(row.scores[0]?.breakdown).criteria,
    scoreRationale: row.scores[0]?.rationale ?? null,
    mandatoryPassed:
      row.scores.length === 0
        ? null
        : parseScoreBreakdown(row.scores[0]?.breakdown).mandatoryPassed,
    referralBonusApplied: parseScoreBreakdown(row.scores[0]?.breakdown)
      .referralBonusApplied,
    universityBonusApplied: parseScoreBreakdown(row.scores[0]?.breakdown)
      .universityBonusApplied,
    flagged: row.scores[0]?.flagged ?? false,
    flagReason: row.scores[0]?.flagReason ?? null,
    scoredAt: row.scores[0]?.scoredAt.toISOString() ?? null,
    // Parsed defensively: the column can hold output from an older prompt
    // version, and a render must not crash because a field moved.
    extracted: parseExtractedData(row.extractedData),
    referral: row.referral !== null,
  }));
}

export async function countInboxCandidates(orgId: string): Promise<number> {
  return prisma.candidate.count({
    where: { orgId, jobPostId: null, status: "NEW" },
  });
}

/**
 * Manual routing of a candidate to a job post.
 *
 * Both ids are checked against the caller's org in the same statement rather
 * than trusted from the request: `updateMany` puts `orgId` in the WHERE clause,
 * and the job post is verified separately before being referenced. Without the
 * second check a caller could attach their candidate to another tenant's post.
 */
export async function assignCandidateToJobPost(
  orgId: string,
  candidateId: string,
  jobPostId: string | null,
): Promise<boolean> {
  if (jobPostId) {
    const jobPost = await prisma.jobPost.findFirst({
      where: { id: jobPostId, orgId },
      select: { id: true },
    });
    if (!jobPost) return false;
  }

  const result = await prisma.candidate.updateMany({
    where: { id: candidateId, orgId },
    data: { jobPostId },
  });

  return result.count > 0;
}

/**
 * Resolves a candidate's storage key, scoped to the org.
 *
 * Signing a URL is unauthenticated by nature, so the ownership check has to
 * happen before signing — this is that check.
 */
export async function getCandidateResumeKey(
  orgId: string,
  candidateId: string,
): Promise<string | null> {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, orgId },
    select: { resumeFileUrl: true },
  });

  return candidate?.resumeFileUrl ?? null;
}

/**
 * Distinct values available to filter on, for this job post's candidates.
 *
 * Computed from the unfiltered set so the options do not vanish as soon as a
 * filter is applied — a select whose only option is the one already chosen is
 * a dead end.
 */
export async function getCandidateFacets(
  orgId: string,
  jobPostId: string,
): Promise<{ universities: string[]; nationalities: string[]; total: number }> {
  const rows = await prisma.candidate.findMany({
    where: { orgId, jobPostId },
    select: { nationality: true, extractedData: true },
    take: 1000,
  });

  const universities = new Set<string>();
  const nationalities = new Set<string>();

  for (const row of rows) {
    if (row.nationality) nationalities.add(row.nationality);
    const parsed = parseExtractedData(row.extractedData);
    if (parsed?.university) universities.add(parsed.university);
  }

  return {
    universities: [...universities].sort(),
    nationalities: [...nationalities].sort(),
    total: rows.length,
  };
}

export interface FailedCandidate {
  id: string;
  name: string | null;
  email: string | null;
  resumeFilename: string;
  ingestedAt: string;
  updatedAt: string;
  jobPostId: string | null;
  jobPostTitle: string | null;
  /** True when extraction never produced anything — the likely failure point. */
  hasExtractedData: boolean;
  /** True when a score exists, so the failure came after scoring started. */
  hasScore: boolean;
}

/**
 * Every candidate stuck in `ERROR`, across all job posts in the org.
 *
 * Exists because a failed candidate was previously only discoverable by opening
 * one drawer at a time — a recruiter had no way to notice that six resumes
 * silently never made it. There is no error-message column in the schema, so
 * the row carries the signals that narrow it down instead: whether extraction
 * produced data, and whether scoring got as far as writing one.
 */
export async function listFailedCandidates(
  orgId: string,
): Promise<FailedCandidate[]> {
  const rows = await prisma.candidate.findMany({
    where: { orgId, status: "ERROR" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      resumeFileUrl: true,
      extractedData: true,
      ingestedAt: true,
      updatedAt: true,
      jobPostId: true,
      jobPost: { select: { title: true } },
      scores: { select: { id: true }, take: 1 },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    resumeFilename: row.resumeFileUrl.split("/").pop() ?? "resume",
    ingestedAt: row.ingestedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    jobPostId: row.jobPostId,
    jobPostTitle: row.jobPost?.title ?? null,
    hasExtractedData:
      row.extractedData !== null && row.extractedData !== undefined,
    hasScore: row.scores.length > 0,
  }));
}

export async function countFailedCandidates(orgId: string): Promise<number> {
  return prisma.candidate.count({ where: { orgId, status: "ERROR" } });
}
