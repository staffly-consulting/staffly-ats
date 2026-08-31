import type { Metadata } from "next";

import { TriangleAlert } from "lucide-react";

import { FailedCandidatesTable } from "@/components/dashboard/failed-candidates-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOrgContext } from "@/lib/auth";
import { listFailedCandidates } from "@/lib/candidates";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Issues" };

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
  const candidates = await listFailedCandidates(orgId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Issues"
        description="Candidates whose resume could not be read or scored. Each one is a real application that has not been reviewed, so they are surfaced here rather than left to be found one at a time."
      />

      {candidates.length > 0 ? (
        <div className="inline-flex items-center gap-1.5 rounded-md border border-danger/25 bg-danger/10 px-2 py-1 text-xs text-danger">
          <TriangleAlert className="size-3.5" />
          {candidates.length} {pluralize(candidates.length, "candidate")} need
          {candidates.length === 1 ? "s" : ""} attention
        </div>
      ) : null}

      <FailedCandidatesTable candidates={candidates} />
    </div>
  );
}
