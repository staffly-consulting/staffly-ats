import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { JobPostForm } from "@/components/forms/job-post-form";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth";
import { getJobPost } from "@/lib/job-posts";
import { listUniversityPreferences } from "@/lib/universities";
import type { JobPostFormValues } from "@/lib/validations/job-post";

type PageProps = { params: Promise<{ jobId: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { jobId } = await params;
  const { orgId } = await requireOrgContext();
  const job = await getJobPost(orgId, jobId);
  return { title: job ? `Edit ${job.title}` : "Edit job post" };
}

export default async function EditJobPostPage({ params }: PageProps) {
  const { jobId } = await params;
  const { orgId } = await requireOrgContext();

  const [job, universities] = await Promise.all([
    getJobPost(orgId, jobId),
    listUniversityPreferences(orgId),
  ]);

  if (!job) notFound();

  // A CLOSED or ARCHIVED post can still be edited, but the form only offers
  // DRAFT and OPEN as submit targets, so anything else is normalised to OPEN
  // rather than silently failing validation on a status the schema rejects.
  const defaultValues: JobPostFormValues = {
    title: job.title,
    description: job.description ?? "",
    status: job.status === "DRAFT" ? "DRAFT" : "OPEN",
    mandatoryCriteria: job.mandatoryCriteria,
    optionalCriteria: job.optionalCriteria,
    referralPriorityEnabled: job.referralPriorityEnabled,
    referralBonusWeight: job.referralBonusWeight,
    preferredUniversityIds: job.preferredUniversityIds,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 text-muted-foreground"
      >
        <Link href={`/dashboard/jobs/${job.id}`}>
          <ArrowLeft className="size-3.5" />
          Back to {job.title}
        </Link>
      </Button>

      <PageHeader
        eyebrow="Editing"
        title={job.title}
        description="Changes apply to future screening runs. Scores already assigned to candidates are not recalculated."
      />

      <JobPostForm
        universities={universities}
        jobPostId={job.id}
        defaultValues={defaultValues}
      />
    </div>
  );
}
