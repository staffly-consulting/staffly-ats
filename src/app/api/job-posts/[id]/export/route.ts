import { NextResponse } from "next/server";

import { checkPermission, getCurrentMember, getOrgContext } from "@/lib/auth";
import {
  CANDIDATE_EXPORT_LIMIT,
  listJobPostCandidates,
  type CandidateQueryFilters,
} from "@/lib/candidates";
import { buildCandidateWorkbook, exportFilename } from "@/lib/candidate-export";
import { getJobPost } from "@/lib/job-posts";
import { PERMISSIONS } from "@/lib/permissions";

/**
 * GET /api/job-posts/[id]/export — the candidate list as an .xlsx workbook.
 *
 * A route handler rather than a server action because the response is a binary
 * file: an action would have to marshal a megabyte of spreadsheet back through
 * the RSC payload for the browser to re-encode and save. A GET also means the
 * button is an ordinary link, and the browser's own download machinery handles
 * the rest.
 *
 * Filters arrive as the SAME query parameters the job post page uses, so the
 * link is just the current URL with `/export` on the end and the file matches
 * what the recruiter is looking at. They are re-parsed and re-applied in SQL
 * here — nothing is trusted from the page.
 *
 * NOT gated on a plan. Getting your own candidate data out is not a paid
 * feature; see the note in `lib/plans.ts`. It IS gated on role, because a bulk
 * download of applicants' personal data is a different act from reading one
 * profile on screen.
 */

const MAX_FILTER_LENGTH = 200;

/** Mirrors `readFilters` on the job post page, re-validated from scratch. */
function readFilters(params: URLSearchParams): CandidateQueryFilters {
  // Length-capped: these reach a Prisma query and a human-readable summary in
  // the file, and neither needs an unbounded string.
  const one = (key: string) => {
    const value = params.get(key)?.trim();
    return value ? value.slice(0, MAX_FILTER_LENGTH) : undefined;
  };

  const minScore = Number(params.get("minScore") ?? "0");

  return {
    minScore: Number.isFinite(minScore) && minScore > 0 ? minScore : undefined,
    referralOnly: params.get("referral") === "1",
    flaggedOnly: params.get("flagged") === "1",
    unreadOnly: params.get("unread") === "1",
    university: one("university"),
    nationality: one("nationality"),
    decision:
      params.get("decision") === "SHORTLISTED" ||
      params.get("decision") === "REJECTED" ||
      params.get("decision") === "undecided"
        ? (params.get("decision") as "SHORTLISTED" | "REJECTED" | "undecided")
        : undefined,
  };
}

/** Plain-English description of the filters, for the "About" sheet. */
function describeFilters(filters: CandidateQueryFilters): string | null {
  const parts: string[] = [];

  if (filters.minScore) parts.push(`score ${filters.minScore} or above`);
  if (filters.referralOnly) parts.push("referrals only");
  if (filters.flaggedOnly) parts.push("flagged only");
  if (filters.unreadOnly) parts.push("not yet opened");
  if (filters.decision) {
    parts.push(
      filters.decision === "undecided"
        ? "not yet decided"
        : `marked ${filters.decision.toLowerCase()}`,
    );
  }
  if (filters.university) parts.push(`university: ${filters.university}`);
  if (filters.nationality) parts.push(`nationality: ${filters.nationality}`);

  return parts.length === 0 ? null : parts.join("; ");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const context = await getOrgContext();
  if (!context) {
    return NextResponse.json(
      { error: "Sign in with an active organization to export candidates." },
      { status: 401 },
    );
  }

  if (!(await checkPermission(context, PERMISSIONS.CANDIDATE_EXPORT))) {
    return NextResponse.json(
      {
        error:
          "Your role does not allow exporting candidate data. Ask an admin in your organization to change your role.",
      },
      { status: 403 },
    );
  }

  // Org-scoped, so another tenant's job post id 404s exactly as one that never
  // existed does.
  const job = await getJobPost(context.orgId, id);
  if (!job) {
    return NextResponse.json({ error: "Job post not found." }, { status: 404 });
  }

  const filters = readFilters(new URL(request.url).searchParams);
  const exportedAt = new Date();

  try {
    const [candidates, member] = await Promise.all([
      listJobPostCandidates(context.orgId, id, filters, {
        limit: CANDIDATE_EXPORT_LIMIT,
      }),
      getCurrentMember(context),
    ]);

    const workbook = await buildCandidateWorkbook({
      job,
      candidates,
      filterSummary: describeFilters(filters),
      // Equality, not >=: the query asked for exactly the limit, so hitting it
      // means there may be more rows behind it. The About sheet says so.
      truncated: candidates.length === CANDIDATE_EXPORT_LIMIT,
      exportedBy: member?.name ?? member?.email ?? "Unknown",
      exportedAt,
    });

    console.info(
      `[export] org ${context.orgId} user ${context.clerkUserId} exported ${candidates.length} candidate(s) from job post ${id}`,
    );

    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${exportFilename(job.title, exportedAt)}"`,
        // Personal data: never cached by a proxy, never held by the browser.
        "Cache-Control": "no-store, private",
        "Content-Length": String(workbook.byteLength),
      },
    });
  } catch (cause) {
    console.error(`[GET /api/job-posts/${id}/export] failed`, cause);
    return NextResponse.json(
      { error: "Could not build the export. Please try again." },
      { status: 500 },
    );
  }
}
