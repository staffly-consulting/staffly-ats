"use client";

import { useEffect, useState, useTransition } from "react";

import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  addCandidateNoteAction,
  deleteCandidateNoteAction,
  listCandidateNotesAction,
} from "@/app/(dashboard)/dashboard/candidate-note-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CandidateNoteView } from "@/lib/candidate-notes";
import { NOTE_MAX_LENGTH } from "@/lib/validations/candidate-note";
import { formatDateTime } from "@/lib/utils";

/**
 * Team notes on one candidate.
 *
 * Loaded when the sheet opens rather than with the table: the table can hold
 * five hundred candidates and almost none of their notes will be read on any
 * given visit. The parent keys this component on the candidate id, so switching
 * candidates starts from a clean "loading" state instead of briefly showing the
 * previous person's notes.
 */
export function CandidateNotes({ candidateId }: { candidateId: string }) {
  /** Null while the first load is in flight. */
  const [notes, setNotes] = useState<CandidateNoteView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, startSave] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void listCandidateNotesAction(candidateId).then((result) => {
      if (cancelled) return;
      if (result.ok) setNotes(result.data);
      else setLoadError(result.error);
    });

    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  function add() {
    const body = draft.trim();
    if (body === "") return;

    startSave(async () => {
      const result = await addCandidateNoteAction(candidateId, body);
      if (!result.ok) {
        toast.error("Could not save that note", { description: result.error });
        return;
      }
      setNotes((current) => [...(current ?? []), result.data]);
      setDraft("");
    });
  }

  async function remove(noteId: string) {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;

    setDeletingId(noteId);
    const result = await deleteCandidateNoteAction(noteId);
    setDeletingId(null);

    if (!result.ok) {
      toast.error("Could not delete that note", { description: result.error });
      return;
    }
    setNotes((current) => (current ?? []).filter((note) => note.id !== noteId));
  }

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <MessageSquare className="size-3.5 text-brand" />
        Notes{notes && notes.length > 0 ? ` (${notes.length})` : ""}
      </h3>

      {loadError ? (
        <p className="mt-2 text-sm text-danger">{loadError}</p>
      ) : notes === null ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading notes…
        </p>
      ) : notes.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No notes yet. Anything written here is visible to your whole team.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-lg border border-border bg-muted/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {note.authorName ?? "Former member"}
                  </span>{" "}
                  · {formatDateTime(note.createdAt)}
                </div>
                {note.canDelete ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mt-1 -mr-1 size-6 shrink-0"
                    aria-label="Delete note"
                    disabled={deletingId === note.id}
                    onClick={() => void remove(note.id)}
                  >
                    {deletingId === note.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    )}
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Offered even when the list failed to load: a failed read is no reason
          to stop someone writing down what they just heard in an interview. */}
      <div className="mt-3 space-y-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a note for your team…"
          aria-label="New note"
          maxLength={NOTE_MAX_LENGTH}
          disabled={saving}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={saving || draft.trim() === ""}
            onClick={add}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add note
          </Button>
        </div>
      </div>
    </section>
  );
}
