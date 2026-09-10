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
  /**
   * Candidates scoring at or above `SCORE_THRESHOLDS.strong`.
   *
   * NOT the shortlist. This is what the MODEL suggests; `CandidateStatus.
   * SHORTLISTED` is what a PERSON decided, and the two routinely disagree —
   * that disagreement is the recruiter doing their job. It was once called
   * `shortlistedCount`, which made the stat tile and the shortlist filter
   * return different numbers for what looked like the same question.
   */
  strongMatchCount: number;
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

/**
 * Every job post in the org, archived ones excluded by default.
 *
 * ARCHIVED is this codebase's soft delete (see the lifecycle section below), so
 * omitting it here is what makes "deleted" mean anything: a caller has to ask
 * for archived posts on purpose. Everything that feeds a picker, a count or a
 * dashboard therefore gets the un-archived set without having to remember to
 * filter — the default is the safe one.
 */
export async function listJobPosts(
  orgId: string,
  options: { includeArchived?: boolean } = {},
): Promise<JobPostSummary[]> {
  const posts = await prisma.jobPost.findMany({
    where: {
      orgId,
      ...(options.includeArchived ? {} : { status: { not: "ARCHIVED" } }),
    },
    include: jobPostInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  if (posts.length === 0) return [];

  const jobPostIds = posts.map((post) => post.id);

  // Aggregate scores separately: Prisma cannot average a related table's column
  // inside `findMany`. Both groupBy calls stay org-scoped through the relation
  // filter rather than trusting the id list alone.
  const [scoreAggregates, strongMatchAggregates] = await Promise.all([
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
  const strongMatchByPost = new Map(
    strongMatchAggregates.map((row) => [row.jobPostId, row._count._all]),
  );

  return posts.map((post) => {
    const scores = scoresByPost.get(post.id);
    const applicantCount = post._count.candidates;
    const average = scores?.average ?? null;

    return toSummary(post, {
      applicantCount,
      averageScore: average === null ? null : Math.round(average),
      strongMatchCount: strongMatchByPost.get(post.id) ?? 0,
      // Candidates with no score row yet — the screening pipeline has not run.
      pendingScoreCount: Math.max(0, applicantCount - (scores?.scored ?? 0)),
    });
  });
}

/**
 * Only the soft-deleted posts, for the Archived tab and nothing else.
 *
 * A named function rather than a second boolean at every call site: "give me
 * the deleted ones" is a deliberate request, and it should read like one.
 */
export async function listArchivedJobPosts(
  orgId: string,
): Promise<JobPostSummary[]> {
  const all = await listJobPosts(orgId, { includeArchived: true });
  return all.filter((post) => post.status === "ARCHIVED");
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

  const [scoreAggregate, strongMatchCount] = await Promise.all([
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
    strongMatchCount: strongMatchCount,
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

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Closing and archiving, kept out of `updateJobPost` on purpose.
 *
 * The edit form owns the fields a recruiter types; these own the status column
 * and `closedAt`. Folding them together would mean every ordinary save had to
 * reason about whether it was also a state transition, and the form only ever
 * submits DRAFT or OPEN — see `jobPostApiSchema`.
 *
 * WHAT THE TWO INACTIVE STATES MEAN:
 *
 *   CLOSED   — the search is over. Fully visible, candidates and scores intact,
 *              still its own tab. This is "we hired someone".
 *   ARCHIVED — the SOFT DELETE. Hidden from every default listing and from the
 *              candidate-assignment picker, but nothing is destroyed and it can
 *              be restored. This is "get this off my dashboard".
 *
 * Nothing here deletes rows. A job post owns candidates, scores and referrals
 * through cascading foreign keys, so a hard delete would take real applications
 * — people who applied — with it. That is not a thing to offer behind a button.
 */

/** The status a restored post returns to. Derived, so no column is needed. */
function statusAfterRestore(closedAt: Date | null): JobPostStatus {
  // A post with a `closedAt` was a live search that ended, so CLOSED is where it
  // belongs. One without never went live, so it goes back to being a DRAFT.
  // Restoring straight to OPEN is deliberately not an option: un-deleting
  // something should not also start it accepting candidates again.
  return closedAt ? "CLOSED" : "DRAFT";
}

export type LifecycleAction = "close" | "reopen" | "archive" | "restore";

/**
 * Applies a lifecycle transition, org-scoped.
 *
 * Returns null when the post does not exist in this org — the same 404 contract
 * as `updateJobPost`, and for the same reason.
 */
export async function setJobPostLifecycle(
  orgId: string,
  jobPostId: string,
  action: LifecycleAction,
): Promise<{ id: string; status: JobPostStatus } | null> {
  const post = await prisma.jobPost.findFirst({
    where: { id: jobPostId, orgId },
    select: { id: true, status: true, closedAt: true },
  });

  if (!post) return null;

  // `closedAt` means "when this stopped being active", so it is stamped on the
  // way out of an active state and cleared on the way back in. Existing dates
  // are never overwritten: closing an already-closed post (which is what
  // archiving one does) must not move the date the search actually ended.
  const endedAt = post.closedAt ?? new Date();

  const transition: Record<
    LifecycleAction,
    { status: JobPostStatus; closedAt: Date | null }
  > = {
    close: { status: "CLOSED", closedAt: endedAt },
    // Cleared, so a post that is reopened and later archived is correctly
    // treated as one that never ended.
    reopen: { status: "OPEN", closedAt: null },
    // Archiving an OPEN post also ends it. Without the stamp it could come back
    // from the archive as a DRAFT despite having run and collected candidates.
    archive: { status: "ARCHIVED", closedAt: endedAt },
    restore: {
      status: statusAfterRestore(post.closedAt),
      closedAt: post.closedAt,
    },
  };

  const next = transition[action];

  await prisma.jobPost.updateMany({
    where: { id: jobPostId, orgId },
    data: { status: next.status, closedAt: next.closedAt },
  });

  return { id: jobPostId, status: next.status };
}
