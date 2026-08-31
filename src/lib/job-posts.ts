import "server-only";

import type { JobPostStatus, Prisma } from "@prisma/client";

import {
  readMandatoryCriteria,
  readOptionalCriteria,
  writeMandatoryCriteria,
  writeOptionalCriteria,
} from "@/lib/criteria";
import { prisma } from "@/lib/prisma";
import { SCORE_THRESHOLDS } from "@/lib/score";
import type { Criterion } from "@/lib/types";
import { filterOwnedUniversityIds } from "@/lib/universities";
import type { JobPostFormValues } from "@/lib/validations/job-post";

/**
 * Org-scoped job post queries.
 *
 * Prisma bypasses RLS, so `orgId` is a required argument on every function here
 * and every `where` clause includes it. There is no unscoped variant on
 * purpose — if you find yourself wanting one, you want a different function.
 * The orgId must come from `requireOrgContext()`, never from a route param.
 */

export interface JobPostStats {
  applicantCount: number;
  averageScore: number | null;
  shortlistedCount: number;
  pendingScoreCount: number;
}

export interface JobPostSummary {
  id: string;
  title: string;
  description: string | null;
  status: JobPostStatus;
  mandatoryCriteria: Criterion[];
  optionalCriteria: Criterion[];
  preferredUniversityIds: string[];
  referralPriorityEnabled: boolean;
  referralBonusWeight: number;
  createdAt: string;
  closedAt: string | null;
  createdByName: string | null;
  stats: JobPostStats;
}

type JobPostRow = Prisma.JobPostGetPayload<{
  include: {
    _count: { select: { candidates: true } };
    createdBy: { select: { name: true; email: true } };
  };
}>;

function toSummary(post: JobPostRow, stats: JobPostStats): JobPostSummary {
  const optional = readOptionalCriteria(post.optionalCriteria);

  return {
    id: post.id,
    title: post.title,
    description: post.description,
    status: post.status,
    mandatoryCriteria: readMandatoryCriteria(post.mandatoryCriteria),
    optionalCriteria: optional.criteria,
    preferredUniversityIds: optional.preferredUniversityIds,
    referralPriorityEnabled: post.referralPriorityEnabled,
    referralBonusWeight: post.referralBonusWeight,
    createdAt: post.createdAt.toISOString(),
    closedAt: post.closedAt?.toISOString() ?? null,
    createdByName: post.createdBy?.name ?? post.createdBy?.email ?? null,
    stats,
  };
}

const jobPostInclude = {
  _count: { select: { candidates: true } },
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.JobPostInclude;

export async function listJobPosts(orgId: string): Promise<JobPostSummary[]> {
  const posts = await prisma.jobPost.findMany({
    where: { orgId },
    include: jobPostInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  if (posts.length === 0) return [];

  const jobPostIds = posts.map((post) => post.id);

  // Aggregate scores separately: Prisma cannot average a related table's column
  // inside `findMany`. Both groupBy calls stay org-scoped through the relation
  // filter rather than trusting the id list alone.
  const [scoreAggregates, shortlistAggregates] = await Promise.all([
    prisma.candidateScore.groupBy({
      by: ["jobPostId"],
      where: { jobPostId: { in: jobPostIds }, jobPost: { orgId } },
      _avg: { overallScore: true },
      _count: { _all: true },
    }),
    prisma.candidateScore.groupBy({
      by: ["jobPostId"],
      where: {
        jobPostId: { in: jobPostIds },
        jobPost: { orgId },
        overallScore: { gte: SCORE_THRESHOLDS.strong },
      },
      _count: { _all: true },
    }),
  ]);

  const scoresByPost = new Map(
    scoreAggregates.map((row) => [
      row.jobPostId,
      { average: row._avg.overallScore, scored: row._count._all },
    ]),
  );
  const shortlistByPost = new Map(
    shortlistAggregates.map((row) => [row.jobPostId, row._count._all]),
  );

  return posts.map((post) => {
    const scores = scoresByPost.get(post.id);
    const applicantCount = post._count.candidates;
    const average = scores?.average ?? null;

    return toSummary(post, {
      applicantCount,
      averageScore: average === null ? null : Math.round(average),
      shortlistedCount: shortlistByPost.get(post.id) ?? 0,
      // Candidates with no score row yet — the screening pipeline has not run.
      pendingScoreCount: Math.max(0, applicantCount - (scores?.scored ?? 0)),
    });
  });
}

/**
 * `findFirst` with both id and orgId, deliberately not `findUnique` by id:
 * a job post id belonging to another tenant must come back as null, not as a
 * row we then have to remember to check.
 */
export async function getJobPost(
  orgId: string,
  jobPostId: string,
): Promise<JobPostSummary | null> {
  const post = await prisma.jobPost.findFirst({
    where: { id: jobPostId, orgId },
    include: jobPostInclude,
  });

  if (!post) return null;

  const [scoreAggregate, shortlistCount] = await Promise.all([
    prisma.candidateScore.aggregate({
      where: { jobPostId: post.id, jobPost: { orgId } },
      _avg: { overallScore: true },
      _count: { _all: true },
    }),
    prisma.candidateScore.count({
      where: {
        jobPostId: post.id,
        jobPost: { orgId },
        overallScore: { gte: SCORE_THRESHOLDS.strong },
      },
    }),
  ]);

  const average = scoreAggregate._avg.overallScore;

  return toSummary(post, {
    applicantCount: post._count.candidates,
    averageScore: average === null ? null : Math.round(average),
    shortlistedCount: shortlistCount,
    pendingScoreCount: Math.max(
      0,
      post._count.candidates - scoreAggregate._count._all,
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Builds the column values shared by create and update.
 *
 * `preferredUniversityIds` arrives from the client, so it is filtered against
 * the org's own rows before being persisted — see `filterOwnedUniversityIds`.
 */
async function toColumns(orgId: string, values: JobPostFormValues) {
  const ownedUniversityIds = await filterOwnedUniversityIds(
    orgId,
    values.preferredUniversityIds,
  );

  return {
    title: values.title.trim(),
    description: values.description.trim() || null,
    status: values.status,
    mandatoryCriteria: writeMandatoryCriteria(values.mandatoryCriteria),
    optionalCriteria: writeOptionalCriteria(
      values.optionalCriteria,
      ownedUniversityIds,
    ),
    referralPriorityEnabled: values.referralPriorityEnabled,
    // Belt and braces with the Zod refinement: a disabled toggle must never
    // leave a stale bonus behind for the scoring step to pick up.
    referralBonusWeight: values.referralPriorityEnabled
      ? values.referralBonusWeight
      : 0,
  };
}

export async function createJobPost(
  orgId: string,
  createdById: string | null,
  values: JobPostFormValues,
) {
  return prisma.jobPost.create({
    data: { orgId, createdById, ...(await toColumns(orgId, values)) },
    select: { id: true },
  });
}

/**
 * Returns null when the post does not exist *in this org*, which the caller
 * turns into a 404. `updateMany` rather than `update` so the org filter is part
 * of the WHERE clause instead of a check we could forget.
 */
export async function updateJobPost(
  orgId: string,
  jobPostId: string,
  values: JobPostFormValues,
): Promise<{ id: string } | null> {
  const result = await prisma.jobPost.updateMany({
    where: { id: jobPostId, orgId },
    data: await toColumns(orgId, values),
  });

  return result.count === 0 ? null : { id: jobPostId };
}
