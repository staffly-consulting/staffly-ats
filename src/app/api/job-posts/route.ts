import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { checkPermission, getCurrentMember, getOrgContext } from "@/lib/auth";
import { checkFeature, checkSubscription } from "@/lib/entitlements";
import { PERMISSIONS } from "@/lib/permissions";
import { FEATURES, TRIAL_PERIOD_DAYS } from "@/lib/plans";
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

  // 403, not 401: they are authenticated and in the right org, their role just
  // does not permit this. Checked before parsing so a VIEWER gets the same
  // answer whatever they send.
  if (!(await checkPermission(context, PERMISSIONS.JOB_POST_WRITE))) {
    return NextResponse.json(
      {
        error:
          "Your role does not allow creating job posts. Ask an admin in your organization to change your role.",
      },
      { status: 403 },
    );
  }

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

  // The paywall. There is no free tier, so an org with no live subscription
  // cannot create the thing that receives applications — which is what makes
  // "no free tier" true in practice rather than only on the pricing page.
  //
  // Enforced on creation only. An org whose subscription lapses keeps its
  // existing posts and candidates: they paid for that data, and deleting or
  // hiding it would be a punishment rather than a paywall.
  const subscription = await checkSubscription(orgId);
  if (!subscription.active) {
    return NextResponse.json(
      {
        error:
          subscription.reason === "never-subscribed"
            ? `Choose a plan to create job posts. Your first ${TRIAL_PERIOD_DAYS} days are free and you can cancel within them without being charged.`
            : "Your subscription is no longer active, so new job posts cannot be created. Reactivate it in Settings — your existing posts and candidates are untouched.",
        // Lets the client route straight to Checkout instead of guessing.
        upgradeUrl: "/dashboard/settings",
      },
      { status: 403 },
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
