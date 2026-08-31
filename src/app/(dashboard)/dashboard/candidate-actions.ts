"use server";

import { revalidatePath } from "next/cache";

import { inngest } from "@/inngest/client";
import { requireOrgContext } from "@/lib/auth";
import {
  assignCandidateToJobPost,
  getCandidateResumeKey,
} from "@/lib/candidates";
import { prisma } from "@/lib/prisma";
import { createSignedUrl } from "@/lib/storage";

/**
 * Candidate actions shared by the Inbox and the job post candidate table.
 *
 * Both surfaces need the same two operations, so they live at the top of the
 * dashboard segment rather than being duplicated or imported across sibling
 * routes.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/**
 * Short-lived signed URL for a stored resume.
 *
 * The bucket is private and signing is unauthenticated by nature, so ownership
 * is established first: `getCandidateResumeKey` only returns a key when the
 * candidate belongs to the caller's org. The candidate id comes from the client
 * and is never trusted on its own.
 */
export async function getResumeUrlAction(
  candidateId: string,
): Promise<ActionResult<string>> {
  const { orgId } = await requireOrgContext();

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  const key = await getCandidateResumeKey(orgId, candidateId);
  if (!key) return { ok: false, error: "Resume not found." };

  const url = await createSignedUrl(key);
  if (!url) {
    return {
      ok: false,
      error:
        "Could not open that file. If the resumes bucket was only just created, the upload may not have run yet.",
    };
  }

  return { ok: true, data: url };
}

/**
 * Re-runs extraction for one candidate.
 *
 * Two uses: recovering a candidate stuck in `ERROR`, and re-running extraction
 * after a prompt change without having to send a fresh test email. The Inngest
 * function is idempotent on status, so a double-click is harmless.
 */
export async function retryExtractionAction(
  candidateId: string,
): Promise<ActionResult> {
  const { orgId } = await requireOrgContext();

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  // Org-scoped lookup before emitting: the event carries an orgId that the
  // extraction function trusts, so it must be established here, not supplied.
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, orgId },
    select: { id: true, status: true },
  });

  if (!candidate) return { ok: false, error: "Candidate not found." };

  if (candidate.status === "PROCESSING") {
    return { ok: false, error: "Extraction is already running." };
  }

  try {
    // Reset to NEW so the extraction function's status guard lets it through —
    // it deliberately refuses to re-process an already EXTRACTED candidate.
    await prisma.candidate.updateMany({
      where: { id: candidateId, orgId },
      data: { status: "NEW" },
    });

    await inngest.send({
      name: "candidate/created",
      data: { orgId, candidateId, retry: true },
    });

    revalidatePath("/dashboard/inbox");
    return { ok: true };
  } catch (cause) {
    console.error("[retryExtractionAction] failed", cause);
    return { ok: false, error: "Could not queue extraction. Try again." };
  }
}

/**
 * Re-runs scoring for one candidate, overwriting the existing `CandidateScore`.
 *
 * Needed because criteria edits do not currently trigger a bulk re-score: after
 * changing a job post's requirements, this is how a recruiter refreshes a
 * candidate against the new definition. Also useful after fixing an extraction.
 */
export async function rescoreCandidateAction(
  candidateId: string,
): Promise<ActionResult> {
  const { orgId } = await requireOrgContext();

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, orgId },
    select: { jobPostId: true, extractedData: true, status: true },
  });

  if (!candidate) return { ok: false, error: "Candidate not found." };
  if (!candidate.jobPostId) {
    return {
      ok: false,
      error: "Assign this candidate to a job post before scoring.",
    };
  }
  if (
    candidate.extractedData === null ||
    candidate.extractedData === undefined
  ) {
    return {
      ok: false,
      error: "This resume has not been extracted yet. Run extraction first.",
    };
  }
  if (candidate.status === "PROCESSING") {
    return { ok: false, error: "This candidate is already being processed." };
  }

  try {
    await inngest.send({
      name: "candidate/ready-for-scoring",
      // `force` is what lets this overwrite; without it the function treats an
      // existing score as "already done" and exits.
      data: { orgId, candidateId, force: true },
    });

    revalidatePath(`/dashboard/jobs/${candidate.jobPostId}`);
    return { ok: true };
  } catch (cause) {
    console.error("[rescoreCandidateAction] failed", cause);
    return { ok: false, error: "Could not queue scoring. Try again." };
  }
}

/**
 * Manual routing of a candidate to a role, and un-assignment back to the inbox.
 * Both ids are validated against the caller's org inside
 * `assignCandidateToJobPost`.
 */
export async function assignCandidateAction(
  candidateId: string,
  jobPostId: string | null,
): Promise<ActionResult> {
  const { orgId } = await requireOrgContext();

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  try {
    const assigned = await assignCandidateToJobPost(
      orgId,
      candidateId,
      jobPostId,
    );

    if (!assigned) {
      return { ok: false, error: "Candidate or job post not found." };
    }

    // Scoring needs an extracted profile *and* an assignment. If extraction has
    // already run, this assignment was the last missing piece — hand off. The
    // extraction function fires the same event when the order is reversed.
    if (jobPostId) {
      const candidate = await prisma.candidate.findFirst({
        where: { id: candidateId, orgId },
        select: { status: true, extractedData: true },
      });

      const readyToScore =
        candidate?.extractedData !== null &&
        candidate?.extractedData !== undefined &&
        candidate.status !== "PROCESSING";

      if (readyToScore) {
        await inngest.send({
          name: "candidate/ready-for-scoring",
          data: { orgId, candidateId },
        });
      }
    }

    revalidatePath("/dashboard/inbox");
    if (jobPostId) revalidatePath(`/dashboard/jobs/${jobPostId}`);
    return { ok: true };
  } catch (cause) {
    console.error("[assignCandidateAction] failed", cause);
    return { ok: false, error: "Could not assign the candidate." };
  }
}
