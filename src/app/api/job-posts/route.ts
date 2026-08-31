import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentMember, getOrgContext } from "@/lib/auth";
import { checkFeature } from "@/lib/entitlements";
import { FEATURES } from "@/lib/plans";
import { createJobPost } from "@/lib/job-posts";
import { jobPostApiSchema } from "@/lib/validations/job-post";

/**
 * POST /api/job-posts — create a job post.
 *
 * This is a public HTTP endpoint. The browser form validates with the same Zod
 * schema before it gets here, but that check is a convenience for the user, not
 * a guarantee: anything reaching this handler is re-validated from scratch.
 *
 * Tenancy comes from the Clerk session via `requireOrgContext()` and is never
 * read from the payload — a caller has no way to name an org.
 */
export async function POST(request: Request) {
  // 401 rather than a redirect: `fetch` follows redirects, so sending the
  // sign-in page back with a 200 would look like success to the caller.
  const context = await getOrgContext();
  if (!context) {
    return NextResponse.json(
      { error: "Sign in with an active organization to create a job post." },
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
        // Full issue list so a non-browser client can act on more than the first.
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

  // Attribution is best-effort. `ensureTenantProvisioned` will have created the
  // member row by now in the normal case; a user with no email address on their
  // Clerk profile gets a null `createdById` rather than being blocked.
  const member = await getCurrentMember(context);

  try {
    const post = await createJobPost(orgId, member?.id ?? null, parsed.data);
    revalidatePath("/dashboard");
    return NextResponse.json({ id: post.id }, { status: 201 });
  } catch (cause) {
    console.error("[POST /api/job-posts] failed", cause);
    return NextResponse.json(
      { error: "Could not save the job post. Please try again." },
      { status: 500 },
    );
  }
}
