"use server";

import { getCurrentRole, requireOrgContext, type OrgContext } from "@/lib/auth";
import {
  addCandidateNote,
  deleteCandidateNote,
  listCandidateNotes,
  type CandidateNoteView,
  type NoteViewer,
} from "@/lib/candidate-notes";
import { noteBodySchema } from "@/lib/validations/candidate-note";

import type { ActionResult } from "./candidate-actions";

/**
 * Notes on a candidate.
 *
 * NOT gated on CANDIDATE_WRITE, deliberately. The person whose opinion a note
 * most often records is the hiring manager, and the hiring manager is a VIEWER.
 * A note changes nothing about the candidate — not the score, the stage or the
 * data — and takes nothing out of the app, which are the two lines
 * `lib/permissions.ts` draws. Org scoping is still enforced on every query.
 *
 * Nothing here revalidates a path: notes are loaded when the sheet opens and
 * the client applies each change from the action's own result.
 */

async function viewerFor(context: OrgContext): Promise<NoteViewer> {
  return {
    clerkUserId: context.clerkUserId,
    isAdmin: (await getCurrentRole(context)) === "ADMIN",
  };
}

export async function listCandidateNotesAction(
  candidateId: unknown,
): Promise<ActionResult<CandidateNoteView[]>> {
  const context = await requireOrgContext();

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  try {
    const notes = await listCandidateNotes(
      context.orgId,
      candidateId,
      await viewerFor(context),
    );
    return { ok: true, data: notes };
  } catch (cause) {
    console.error("[listCandidateNotesAction] failed", cause);
    return { ok: false, error: "Could not load notes." };
  }
}

export async function addCandidateNoteAction(
  candidateId: unknown,
  body: unknown,
): Promise<ActionResult<CandidateNoteView>> {
  const context = await requireOrgContext();

  if (typeof candidateId !== "string" || candidateId === "") {
    return { ok: false, error: "Missing candidate." };
  }

  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid note.",
    };
  }

  try {
    const note = await addCandidateNote(
      context.orgId,
      candidateId,
      await viewerFor(context),
      parsed.data,
    );
    if (!note) return { ok: false, error: "Candidate not found." };

    return { ok: true, data: note };
  } catch (cause) {
    console.error("[addCandidateNoteAction] failed", cause);
    return { ok: false, error: "Could not save that note. Try again." };
  }
}

/** The author may delete their own note; an admin may delete anyone's. */
export async function deleteCandidateNoteAction(
  noteId: unknown,
): Promise<ActionResult> {
  const context = await requireOrgContext();

  if (typeof noteId !== "string" || noteId === "") {
    return { ok: false, error: "Missing note." };
  }

  try {
    const deleted = await deleteCandidateNote(
      context.orgId,
      noteId,
      await viewerFor(context),
    );
    if (!deleted) {
      return {
        ok: false,
        error: "Only the author or an admin can delete that note.",
      };
    }

    return { ok: true };
  } catch (cause) {
    console.error("[deleteCandidateNoteAction] failed", cause);
    return { ok: false, error: "Could not delete that note. Try again." };
  }
}
