import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";
import Link from "next/link";

import type { JobPostStatus } from "@prisma/client";
import { Briefcase, Inbox, Plus, Target, TrendingUp } from "lucide-react";

import { JobCard } from "@/components/dashboard/job-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireOrgContext } from "@/lib/auth";
import { listJobPosts, type JobPostSummary } from "@/lib/job-posts";
import { prisma } from "@/lib/prisma";
import { SCORE_THRESHOLDS } from "@/lib/score";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("jobPosts") };
}

// Org-scoped and session-dependent: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** `labelKey` indexes the `dashboard` namespace; the label itself is resolved
 * at render so a translator never edits this list. */
const TABS: { value: string; labelKey: string; match?: JobPostStatus[] }[] = [
  { value: "all", labelKey: "tabAll" },
  { value: "open", labelKey: "tabOpen", match: ["OPEN"] },
  { value: "draft", labelKey: "tabDraft", match: ["DRAFT"] },
  {
    value: "archived",
    labelKey: "tabArchived",
    match: ["CLOSED", "ARCHIVED"],
  },
];

async function JobGrid({ jobs }: { jobs: JobPostSummary[] }) {
  const t = await getTranslations("dashboard");

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Inbox className="size-8 text-muted-foreground/60" />
        <div>
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="text-sm text-muted-foreground">
            {t("emptyDescription")}
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/jobs/new">{t("newJobPost")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const { orgId } = await requireOrgContext();
  const t = await getTranslations("dashboard");

  const [organization, jobs] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    }),
    listJobPosts(orgId),
  ]);

  const openJobs = jobs.filter((job) => job.status === "OPEN");
  const totalApplicants = jobs.reduce(
    (sum, job) => sum + job.stats.applicantCount,
    0,
  );
  const totalShortlisted = jobs.reduce(
    (sum, job) => sum + job.stats.shortlistedCount,
    0,
  );
  const scoredJobs = jobs.filter((job) => job.stats.averageScore !== null);
  const portfolioAverage = scoredJobs.length
    ? Math.round(
        scoredJobs.reduce(
          (sum, job) => sum + (job.stats.averageScore ?? 0),
          0,
        ) / scoredJobs.length,
      )
    : null;
  const pendingScores = jobs.reduce(
    (sum, job) => sum + job.stats.pendingScoreCount,
    0,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        // The org row is created by the Clerk webhook; if it has not landed yet
        // the header just omits the name rather than rendering "undefined".
        eyebrow={organization?.name ?? undefined}
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild>
            <Link href="/dashboard/jobs/new">
              <Plus className="size-4" />
              {t("newJobPost")}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("statOpenRoles")}
          value={openJobs.length}
          hint={t("statPostsTotal", { count: jobs.length })}
          icon={Briefcase}
        />
        <StatTile
          label={t("statApplicants")}
          value={totalApplicants}
          hint={
            pendingScores > 0
              ? t("statAwaitingScore", { count: pendingScores })
              : t("statAllScored")
          }
          icon={Inbox}
        />
        <StatTile
          label={t("statAboveThreshold")}
          value={totalShortlisted}
          hint={t("statScoringOrHigher", { threshold: SCORE_THRESHOLDS.strong })}
          icon={Target}
          valueClassName="text-success"
        />
        <StatTile
          label={t("statAverageScore")}
          value={portfolioAverage ?? "—"}
          hint={t("statAcrossScored")}
          icon={TrendingUp}
        />
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <JobGrid
              jobs={
                tab.match
                  ? jobs.filter((job) => tab.match?.includes(job.status))
                  : jobs
              }
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
