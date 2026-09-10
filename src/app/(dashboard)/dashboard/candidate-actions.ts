"use server";

import { revalidatePath } from "next/cache";

import { inngest } from "@/inngest/client";
import { permissionError, requireOrgContext } from "@/lib/auth";
import {
  assignCandidateToJobPost,
  getCandidateResumeKey,
} from "@/lib/candidates";
import { PERMISSIONS } from "@/lib/permissions";
import type { CandidateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSignedUrl } from "@/lib/storage";

/**
 * Candidate actions shared by the Inbox and the job post candidate table.
 *
 * Both surfaces need the same two operations, so they live at the top of the
 * dashboard segment rather than being duplicated or imported across sibling
 * routes.
 */

/**
 * Forced re-scores allowed per candidate, lifetime.
 *
 * Twenty is far past any honest workflow — a recruiter re-scoring one person
 * twenty times has a problem the button will not solve — and far short of the
 * bill an unbounded loop would produce. Recovering an ERROR candidate is not
 * counted against it; see `rescoreCandidateAction`.
 */
const RESCORE_LIMIT = 20;

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
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.CANDIDATE_WRITE);
  if (denied) return denied;

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
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.CANDIDATE_WRITE);
  if (denied) return denied;

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, orgId },
    select: {
      jobPostId: true,
      extractedData: true,
      status: true,
      rescoreCount: true,
    },
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

  // Recovering a broken candidate is free. Re-running a working one is not:
  // that is a fresh model call against an application already paid for once.
  const isRecovery = candidate.status === "ERROR";

  if (!isRecovery && candidate.rescoreCount >= RESCORE_LIMIT) {
    return {
      ok: false,
      error: `This candidate has been re-scored ${RESCORE_LIMIT} times. Edit the job post's criteria if the score still looks wrong.`,
    };
  }

  // Claim the candidate BEFORE enqueuing, in one conditional update.
  //
  // This is what makes the disabled button real rather than cosmetic. A
  // `useTransition` ends when the action returns, but the Inngest job has not
  // run yet — so without this the button re-enables while scoring is still
  // queued, and a second click, a refresh, another tab or a direct POST all
  // start another paid model call.
  //
  // `status: { not: "PROCESSING" }` in the WHERE clause makes the claim atomic:
  // two simultaneous clicks race in Postgres and exactly one updates a row.
  // A read-then-write here would let both through.
  const claimed = await prisma.candidate.updateMany({
    where: { id: candidateId, orgId, status: { not: "PROCESSING" } },
    data: {
      status: "PROCESSING",
      ...(isRecovery ? {} : { rescoreCount: { increment: 1 } }),
    },
  });

  if (claimed.count === 0) {
    return { ok: false, error: "This candidate is already being processed." };
  }

  try {
    await inngest.send({
      name: "candidate/ready-for-scoring",
      // `force` is what lets this overwrite; without it the function treats an
      // existing score as "already done" and exits.
      data: { orgId, candidateId, force: true },
    });

    revalidatePath("/dashboard/inbox");
    revalidatePath(`/dashboard/jobs/${candidate.jobPostId}`);
    return { ok: true };
  } catch (cause) {
    // The claim above is only safe because of this: without a revert, a failed
    // send would strand the candidate in PROCESSING with no job coming to move
    // it out, and the guard we just added would block every future attempt.
    await prisma.candidate.updateMany({
      where: { id: candidateId, orgId },
      data: {
        status: candidate.status,
        ...(isRecovery ? {} : { rescoreCount: { decrement: 1 } }),
      },
    });

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
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.CANDIDATE_WRITE);
  if (denied) return denied;

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

/* -------------------------------------------------------------------------- */
/* The hiring decision                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Statuses a human decision may be applied to, and returned to.
 *
 * Deliberately excludes NEW, PROCESSING and ERROR: those describe where a
 * candidate is in the PIPELINE, and letting a decision overwrite one would
 * lose the fact that a resume is mid-extraction or failed to parse. A recruiter
 * shortlisting someone whose CV never read is a state the product cannot
 * honour, so it is refused rather than silently accepted.
 */
const DECIDABLE: CandidateStatus[] = [
  "EXTRACTED",
  "SCORED",
  "SHORTLISTED",
  "REJECTED",
];

export type CandidateDecision = "SHORTLISTED" | "REJECTED" | "UNDECIDED";

function parseDecision(value: unknown): CandidateDecision | null {
  return value === "SHORTLISTED" ||
    value === "REJECTED" ||
    value === "UNDECIDED"
    ? value
    : null;
}

/**
 * Records what a person decided about a candidate.
 *
 * This is the counterpart to the score, and the distinction is the point: the
 * model produces a SUGGESTION (a number, from evidence) and a human makes the
 * DECISION (this status). Nothing in the scoring pipeline ever writes
 * SHORTLISTED or REJECTED — if it did, "shortlisted" would stop meaning
 * "somebody chose this person" and the recruiter would have no way to record
 * disagreeing with the score.
 *
 * Requires CANDIDATE_WRITE, so a VIEWER can read a shortlist but not change
 * it. That is the whole reason unlimited viewer seats are safe.
 */
export async function setCandidateDecisionAction(
  candidateId: unknown,
  decisionInput: unknown,
): Promise<ActionResult<CandidateStatus>> {
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.CANDIDATE_WRITE);
  if (denied) return denied;

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  const decision = parseDecision(decisionInput);
  if (!decision) return { ok: false, error: "Unknown decision." };

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, orgId },
    select: {
      status: true,
      jobPostId: true,
      // Whether a score exists decides where "undecided" returns to.
      scores: { select: { id: true }, take: 1 },
    },
  });

  if (!candidate) return { ok: false, error: "Candidate not found." };

  if (!DECIDABLE.includes(candidate.status)) {
    return {
      ok: false,
      error:
        candidate.status === "ERROR"
          ? "This resume could not be read, so there is nothing to decide on yet. Retry extraction first."
          : "This candidate is still being processed. Try again in a moment.",
    };
  }

  // Clearing a decision restores the pipeline state the candidate would have
  // had, rather than a fixed default: a scored candidate goes back to SCORED,
  // one whose resume was read but never scored to EXTRACTED. Sending them all
  // to SCORED would claim a score that does not exist.
  const next: CandidateStatus =
    decision === "UNDECIDED"
      ? candidate.scores.length > 0
        ? "SCORED"
        : "EXTRACTED"
      : decision;

  if (next === candidate.status) return { ok: true, data: next };

  try {
    // `updateMany` with orgId in the WHERE clause, as everywhere else here.
    // The status guard is repeated so a decision cannot land on a candidate
    // that entered PROCESSING between the read above and this write.
    const result = await prisma.candidate.updateMany({
      where: { id: candidateId, orgId, status: { in: DECIDABLE } },
      data: { status: next },
    });

    if (result.count === 0) {
      return {
        ok: false,
        error:
          "That candidate changed while you were deciding. Refresh and try again.",
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/inbox");
    if (candidate.jobPostId) {
      revalidatePath(`/dashboard/jobs/${candidate.jobPostId}`);
    }

    return { ok: true, data: next };
  } catch (cause) {
    console.error("[setCandidateDecisionAction] failed", cause);
    return { ok: false, error: "Could not save that decision. Try again." };
  }
}

/* -------------------------------------------------------------------------- */
/* Read state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Marks a candidate read, or puts them back in the unread queue.
 *
 * NOT gated on CANDIDATE_WRITE, deliberately. Reading is the one thing every
 * role can do, VIEWER included, so gating this would mean a hiring manager
 * could open twenty candidates and none of them would ever leave the unread
 * queue. Org scoping is still the boundary that matters, and it is enforced in
 * the WHERE clause as everywhere else.
 *
 * `readAt` is org-wide, so this records that SOMEONE has looked — see the
 * schema note for why that is the question being answered.
 */
export async function setCandidateReadAction(
  candidateId: unknown,
  read: unknown,
): Promise<ActionResult> {
  const { orgId } = await requireOrgContext();

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }
  if (typeof read !== "boolean") {
    return { ok: false, error: "Invalid read state." };
  }

  try {
    // `updateMany` so a candidate from another tenant silently matches nothing
    // rather than throwing — the same shape as every other write here.
    //
    // Marking read only stamps a candidate that has none, so the timestamp
    // keeps meaning "first opened" rather than "last opened". Re-opening
    // someone should not quietly rewrite when they were first seen.
    await prisma.candidate.updateMany({
      where: {
        id: candidateId,
        orgId,
        ...(read ? { readAt: null } : {}),
      },
      data: { readAt: read ? new Date() : null },
    });

    // No revalidate on the read path: marking read fires on every sheet open,
    // and re-rendering the whole table each time would make opening a
    // candidate feel slow for a change that only moves a dot. The client
    // updates optimistically; the next navigation picks up the truth.
    if (!read) revalidatePath("/dashboard/inbox");

    return { ok: true };
  } catch (cause) {
    console.error("[setCandidateReadAction] failed", cause);
    return { ok: false, error: "Could not update read state." };
  }
}
