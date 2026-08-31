import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArrowLeft,
  Inbox,
  Pencil,
  Target,
  TrendingUp,
  UserPlus,
} from "lucide-react";

import { CandidateTable } from "@/components/dashboard/candidate-table";
import { CriteriaSummary } from "@/components/dashboard/criteria-summary";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatTile } from "@/components/dashboard/stat-tile";
import { JobStatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth";
import { getJobPost } from "@/lib/job-posts";
import {
  getCandidateFacets,
  listJobPostCandidates,
  type CandidateQueryFilters,
} from "@/lib/candidates";
import { SCORE_THRESHOLDS } from "@/lib/score";
import { listUniversityPreferences } from "@/lib/universities";
import { formatDate } from "@/lib/utils";

type PageProps = {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Filters live in the URL so the SQL query, not the browser, does the work. */
function readFilters(
  params: Record<string, string | string[] | undefined>,
): CandidateQueryFilters {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const minScore = Number(one("minScore") ?? "0");

  return {
    minScore: Number.isFinite(minScore) && minScore > 0 ? minScore : undefined,
    referralOnly: one("referral") === "1",
    flaggedOnly: one("flagged") === "1",
    university: one("university") || undefined,
    nationality: one("nationality") || undefined,
  };
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { jobId } = await params;
  const { orgId } = await requireOrgContext();
  const job = await getJobPost(orgId, jobId);
  return { title: job?.title ?? "Job post" };
}

export default async function JobCandidatesPage({
  params,
  searchParams,
}: PageProps) {
  const { jobId } = await params;
  const filters = readFilters(await searchParams);
  const { orgId } = await requireOrgContext();

  // Scoped by org inside the query: a job post id from another tenant returns
  // null and 404s rather than rendering.
  const [job, allUniversities] = await Promise.all([
    getJobPost(orgId, jobId),
    listUniversityPreferences(orgId),
  ]);

  // `getJobPost` filters on orgId, so another tenant's id resolves to null and
  // 404s here — deliberately indistinguishable from an id that never existed.
  if (!job) notFound();

  const [candidates, facets] = await Promise.all([
    listJobPostCandidates(orgId, job.id, filters),
    getCandidateFacets(orgId, job.id),
  ]);

  const preferredUniversities = allUniversities.filter((university) =>
    job.preferredUniversityIds.includes(university.id),
  );

  return (
    <div className="space-y-6">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 text-muted-foreground"
      >
        <Link href="/dashboard">
          <ArrowLeft className="size-3.5" />
          All job posts
        </Link>
      </Button>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {job.title}
            <JobStatusPill status={job.status} />
          </span>
        }
        description={job.description ?? "No description yet."}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/dashboard/jobs/${job.id}/edit`}>
                <Pencil className="size-4" />
                Edit
              </Link>
            </Button>
            <Button disabled>Export shortlist</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span>Created {formatDate(job.createdAt)}</span>
        {job.createdByName ? <span>by {job.createdByName}</span> : null}
        {job.referralPriorityEnabled ? (
          <span className="inline-flex items-center gap-1.5 text-brand">
            <UserPlus className="size-3.5" />
            Referral bonus: +{job.referralBonusWeight}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Applicants"
          value={facets.total}
          hint={
            facets.total === 0
              ? "Assign resumes from the Inbox"
              : `${candidates.filter((c) => c.score === null).length} of the shown candidates unscored`
          }
          icon={Inbox}
        />
        <StatTile
          label="Above threshold"
          value={job.stats.shortlistedCount}
          hint={`Scoring ${SCORE_THRESHOLDS.strong} or higher`}
          icon={Target}
          valueClassName="text-success"
        />
        <StatTile
          label="Average score"
          value={job.stats.averageScore ?? "—"}
          hint="Across scored applications"
          icon={TrendingUp}
        />
        <StatTile
          label="Requirements"
          value={job.mandatoryCriteria.length + job.optionalCriteria.length}
          hint={`${job.mandatoryCriteria.length} mandatory · ${job.optionalCriteria.length} optional`}
          icon={Target}
        />
      </div>

      <CriteriaSummary
        mandatoryCriteria={job.mandatoryCriteria}
        optionalCriteria={job.optionalCriteria}
        referralPriorityEnabled={job.referralPriorityEnabled}
        referralBonusWeight={job.referralBonusWeight}
        universities={preferredUniversities}
      />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Candidates</h2>
          {candidates.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              Assigned from the{" "}
              <Link
                href="/dashboard/inbox"
                className="text-brand hover:underline"
              >
                Inbox
              </Link>
            </span>
          ) : null}
        </div>
        <CandidateTable
          candidates={candidates}
          universities={facets.universities}
          nationalities={facets.nationalities}
          totalCount={facets.total}
        />
      </section>
    </div>
  );
}
