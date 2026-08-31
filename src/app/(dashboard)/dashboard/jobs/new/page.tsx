import type { Metadata } from "next";
import Link from "next/link";

import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { JobPostForm } from "@/components/forms/job-post-form";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth";
import { listUniversityPreferences } from "@/lib/universities";

export const metadata: Metadata = { title: "New job post" };

export const dynamic = "force-dynamic";

export default async function NewJobPostPage() {
  const { orgId } = await requireOrgContext();
  const universities = await listUniversityPreferences(orgId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
        title="New job post"
        description="Describe the role, then define the requirements applications are scored against. You can edit both later without losing existing scores."
      />

      <JobPostForm universities={universities} />
    </div>
  );
}
