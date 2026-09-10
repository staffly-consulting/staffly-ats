"use server";

import { revalidatePath } from "next/cache";

import { permissionError, requireOrgContext } from "@/lib/auth";
import { setJobPostLifecycle, type LifecycleAction } from "@/lib/job-posts";
import { PERMISSIONS } from "@/lib/permissions";
import type { JobPostStatus } from "@prisma/client";

/**
 * Close, reopen, archive and restore.
 *
 * One action rather than four: they take the same arguments, need the same
 * permission check and revalidate the same paths, and the only thing that
 * differs is a string the server re-validates anyway. Four near-identical
 * exports would be four places to forget the permission check.
 *
 * Archiving is a SOFT delete — see `setJobPostLifecycle` for what each state
 * means and why nothing here removes rows.
 */

export type LifecycleResult =
  { ok: true; status: JobPostStatus } | { ok: false; error: string };

const ACTIONS: LifecycleAction[] = ["close", "reopen", "archive", "restore"];

function parseAction(value: unknown): LifecycleAction | null {
  return typeof value === "string" && (ACTIONS as string[]).includes(value)
    ? (value as LifecycleAction)
    : null;
}

export async function setJobPostLifecycleAction(
  jobPostId: unknown,
  actionInput: unknown,
): Promise<LifecycleResult> {
  const context = await requireOrgContext();

  const denied = await permissionError(context, PERMISSIONS.JOB_POST_WRITE);
  if (denied) return denied;

  if (typeof jobPostId !== "string" || jobPostId === "") {
    return { ok: false, error: "Missing job post." };
  }

  const action = parseAction(actionInput);
  if (!action) return { ok: false, error: "Unknown action." };

  try {
    const result = await setJobPostLifecycle(context.orgId, jobPostId, action);

    // Scoped by orgId inside the query, so another tenant's id is
    // indistinguishable from one that never existed.
    if (!result) return { ok: false, error: "Job post not found." };

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/jobs/${jobPostId}`);
    // The assignment picker is built from the job post list, and archiving
    // removes a post from it.
    revalidatePath("/dashboard/inbox");

    return { ok: true, status: result.status };
  } catch (cause) {
    console.error(`[setJobPostLifecycleAction] ${action} failed`, cause);
    return { ok: false, error: "Could not update that job post. Try again." };
  }
}
