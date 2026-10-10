import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Org-scoped candidate notes. As everywhere, `orgId` is a required argument
 * because Prisma bypasses RLS — see `src/lib/prisma.ts`.
 */

/** Who is asking, for deciding which notes they may delete. */
export interface NoteViewer {
  clerkUserId: string;
  isAdmin: boolean;
}

export interface CandidateNoteView {
  id: string;
  body: string;
  createdAt: string;
  /** Null when the author is no longer a member of the org. */
  authorName: string | null;
  /** The author can delete their own note; an admin can delete any. */
  canDelete: boolean;
}

/** More than any candidate should accumulate; a bound, not a page size. */
const NOTE_LIST_LIMIT = 200;

async function authorNames(
  orgId: string,
  authorIds: string[],
): Promise<Map<string, string>> {
  if (authorIds.length === 0) return new Map();

  const members = await prisma.orgMember.findMany({
    where: { orgId, clerkUserId: { in: authorIds } },
    select: { clerkUserId: true, name: true, email: true },
  });

  return new Map(
    members.map((member) => [member.clerkUserId, member.name ?? member.email]),
  );
}

/** Oldest first, so the list reads as a conversation. */
export async function listCandidateNotes(
  orgId: string,
  candidateId: string,
  viewer: NoteViewer,
): Promise<CandidateNoteView[]> {
  const rows = await prisma.candidateNote.findMany({
    where: { orgId, candidateId },
    orderBy: { createdAt: "asc" },
    take: NOTE_LIST_LIMIT,
    select: { id: true, body: true, authorId: true, createdAt: true },
  });

  const names = await authorNames(orgId, [
    ...new Set(rows.map((row) => row.authorId)),
  ]);

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    authorName: names.get(row.authorId) ?? null,
    canDelete: viewer.isAdmin || row.authorId === viewer.clerkUserId,
  }));
}

/**
 * Adds a note. Returns null when the candidate is not in the caller's org —
 * the candidate id arrives from the client, so it is verified here rather than
 * trusted, the same as `assignCandidateToJobPost` does for job posts.
 */
export async function addCandidateNote(
  orgId: string,
  candidateId: string,
  viewer: NoteViewer,
  body: string,
): Promise<CandidateNoteView | null> {
  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, orgId },
    select: { id: true },
  });
  if (!candidate) return null;

  const row = await prisma.candidateNote.create({
    data: { orgId, candidateId, authorId: viewer.clerkUserId, body },
    select: { id: true, body: true, createdAt: true },
  });

  const names = await authorNames(orgId, [viewer.clerkUserId]);

  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    authorName: names.get(viewer.clerkUserId) ?? null,
    canDelete: true,
  };
}

/**
 * Deletes a note the viewer is allowed to delete. The ownership rule lives in
 * the WHERE clause, so someone else's note — or another tenant's — matches
 * nothing rather than needing a separate check that could be skipped.
 */
export async function deleteCandidateNote(
  orgId: string,
  noteId: string,
  viewer: NoteViewer,
): Promise<boolean> {
  const result = await prisma.candidateNote.deleteMany({
    where: {
      id: noteId,
      orgId,
      ...(viewer.isAdmin ? {} : { authorId: viewer.clerkUserId }),
    },
  });

  return result.count > 0;
}
