import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { FlaskConical, Mail } from "lucide-react";

import { InboxTable } from "@/components/dashboard/inbox-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth";
import { listInboxCandidates } from "@/lib/candidates";
import { getEmailInbox } from "@/lib/email-inbox";
import { listJobPosts } from "@/lib/job-posts";
import { pluralize } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("inbox") };
}

export const dynamic = "force-dynamic";

/**
 * Unassigned resumes.
 *
 * This exists because ingestion landed before matching: resumes arrive with no
 * idea which role they are for, and a recruiter needs to see that they arrived
 * at all. It is explicitly a stopgap — see the TODO in the Inngest function.
 */
export default async function InboxPage() {
  const { orgId } = await requireOrgContext();
  const t = await getTranslations("inbox");

  const [candidates, jobPosts, inbox] = await Promise.all([
    listInboxCandidates(orgId),
    listJobPosts(orgId),
    getEmailInbox(orgId),
  ]);

  const assignable = jobPosts
    .filter((job) => job.status === "OPEN" || job.status === "DRAFT")
    .map((job) => ({ id: job.id, title: job.title }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/settings/email">
              <Mail className="size-4" />
              Email connection
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {candidates.length} unassigned{" "}
          {pluralize(candidates.length, "resume")}
        </span>
        {inbox ? (
          <span className="font-mono text-[11px]">{inbox.forwardingAlias}</span>
        ) : (
          <Link
            href="/dashboard/settings/email"
            className="text-brand hover:underline"
          >
            Connect an inbox to start receiving resumes
          </Link>
        )}
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-md border border-warning/25 bg-warning/10 px-2 py-1 text-xs text-warning">
        <FlaskConical className="size-3.5" />
        Sender name and email come from the forwarded message, not the resume —
        AI extraction replaces them
      </div>

      <InboxTable candidates={candidates} jobPosts={assignable} />
    </div>
  );
}
