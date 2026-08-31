import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getOrgContext } from "@/lib/auth";
import { checkFeature } from "@/lib/entitlements";
import { FEATURES } from "@/lib/plans";
import { updateJobPost } from "@/lib/job-posts";
import { jobPostApiSchema } from "@/lib/validations/job-post";

/**
 * PATCH /api/job-posts/[id] — replace a job post's editable fields.
 *
 * Despite the verb this takes the whole form payload: the criteria builder
 * always submits the complete set, and a partial merge of two JSON criteria
 * arrays has no sane semantics (is a missing row a deletion or an omission?).
 * PATCH is used rather than PUT only because `orgId`, `createdById` and the
 * timestamps are deliberately not part of the request.
 *
 * The org filter lives inside `updateJobPost`'s WHERE clause, so a job post
 * belonging to another tenant is indistinguishable from one that does not
 * exist — both 404.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 401 rather than a redirect — see the POST handler for why.
  const context = await getOrgContext();
  if (!context) {
    return NextResponse.json(
      { error: "Sign in with an active organization to edit a job post." },
      { status: 401 },
    );
  }
  const { orgId } = context;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = jobPostApiSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid job post.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  // Entitlement is checked here, not only in the form: this is a public
  // endpoint, and a lower-tier org can post JSON to it directly.
  if (
    parsed.data.referralPriorityEnabled &&
    !(await checkFeature(orgId, FEATURES.REFERRAL_PRIORITY))
  ) {
    return NextResponse.json(
      {
        error:
          "Referral prioritization requires the Pipeline plan or above. Upgrade in Settings, or turn it off to save this job post.",
      },
      { status: 403 },
    );
  }

  if (
    parsed.data.preferredUniversityIds.length > 0 &&
    !(await checkFeature(orgId, FEATURES.UNIVERSITY_PREFERENCES))
  ) {
    return NextResponse.json(
      {
        error:
          "University preferences require the Pipeline plan or above. Upgrade in Settings, or clear the selection to save this job post.",
      },
      { status: 403 },
    );
  }

  try {
    const updated = await updateJobPost(orgId, id, parsed.data);

    if (!updated) {
      return NextResponse.json(
        { error: "Job post not found." },
        { status: 404 },
      );
    }

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/jobs/${id}`);
    return NextResponse.json({ id: updated.id });
  } catch (cause) {
    console.error(`[PATCH /api/job-posts/${id}] failed`, cause);
    return NextResponse.json(
      { error: "Could not save your changes. Please try again." },
      { status: 500 },
    );
  }
}
