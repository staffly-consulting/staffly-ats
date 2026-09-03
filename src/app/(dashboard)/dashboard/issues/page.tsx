import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { TriangleAlert } from "lucide-react";

import { FailedCandidatesTable } from "@/components/dashboard/failed-candidates-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOrgContext } from "@/lib/auth";
import { listFailedCandidates } from "@/lib/candidates";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("issues") };
}

export const dynamic = "force-dynamic";

/**
 * Org-wide view of every candidate stuck in `ERROR`.
 *
 * Org-wide rather than per-job because a candidate can fail *before* being
 * assigned to anything — a resume that fails extraction never gets a job post,
 * so a per-job view would hide exactly the cases most likely to be missed.
 */
export default async function IssuesPage() {
  const { orgId } = await requireOrgContext();
  const t = await getTranslations("issues");
  const candidates = await listFailedCandidates(orgId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {candidates.length > 0 ? (
        <div className="inline-flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/10 px-2 py-1 text-xs text-danger">
          <TriangleAlert className="size-3.5" />
          {t("needAttention", { count: candidates.length })}
        </div>
      ) : null}

      <FailedCandidatesTable candidates={candidates} />
    </div>
  );
}
