"use client";

import { useState, useTransition } from "react";

import {
  Archive,
  ArchiveRestore,
  CircleCheck,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { setJobPostLifecycleAction } from "@/app/(dashboard)/dashboard/jobs/lifecycle.actions";
import { Button } from "@/components/ui/button";
import { useVisiblePending } from "@/lib/use-visible-pending";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobPostStatus } from "@prisma/client";

/**
 * Close / reopen / archive / restore, for the job post header.
 *
 * Which controls appear is decided by the current status, so a recruiter is
 * never offered a transition that does not apply — reopening a draft, closing
 * something already closed. The server re-derives nothing from this; it simply
 * validates the action name and applies it.
 *
 * Archiving and closing both confirm first. Neither destroys anything, but both
 * change what the rest of the team sees, and "archive" reads like "delete" to
 * most people — the dialog is where we say that it is not.
 */

type Transition = "close" | "reopen" | "archive" | "restore";

/** Transitions offered per status, in button order. */
const AVAILABLE: Record<JobPostStatus, Transition[]> = {
  OPEN: ["close", "archive"],
  DRAFT: ["archive"],
  CLOSED: ["reopen", "archive"],
  ARCHIVED: ["restore"],
};

/** The two that change what colleagues see get a confirmation step. */
const CONFIRMS: Transition[] = ["close", "archive"];

const ICONS: Record<Transition, typeof Archive> = {
  close: CircleCheck,
  reopen: RotateCcw,
  archive: Archive,
  restore: ArchiveRestore,
};

/**
 * Icon tint per transition, so the row is readable at a glance.
 *
 * Archive is muted rather than red: it is reversible, and colouring it like a
 * deletion would misrepresent what it does.
 */
const TONES: Record<Transition, string> = {
  close: "text-success",
  reopen: "text-brand",
  archive: "text-muted-foreground",
  restore: "text-brand",
};

export function JobLifecycleActions({
  jobPostId,
  status,
}: {
  jobPostId: string;
  status: JobPostStatus;
}) {
  const t = useTranslations("jobLifecycle");
  const [confirming, setConfirming] = useState<Transition | null>(null);
  /**
   * Which transition is in flight.
   *
   * Tracked separately from `confirming`, because the two do not coincide:
   * reopen and restore run without a dialog, so keying the spinner off
   * `confirming` would leave those buttons silent while they worked.
   */
  const [running, setRunning] = useState<Transition | null>(null);
  const [pending, startTransition] = useTransition();
  // The raw flag is too brief to perceive — see `useVisiblePending`.
  const showPending = useVisiblePending(pending);

  function run(transition: Transition) {
    setRunning(transition);
    startTransition(async () => {
      const result = await setJobPostLifecycleAction(jobPostId, transition);

      if (!result.ok) {
        toast.error(t(`${transition}.failed`), { description: result.error });
        setRunning(null);
        return;
      }

      toast.success(t(`${transition}.done`));
      setConfirming(null);
      setRunning(null);
    });
  }

  function activate(transition: Transition) {
    if (CONFIRMS.includes(transition)) setConfirming(transition);
    else run(transition);
  }

  return (
    <>
      {AVAILABLE[status].map((transition) => {
        const Icon = ICONS[transition];
        // Only the transition actually running spins. Sharing one `pending`
        // across every button would spin all of them and hide which was
        // pressed.
        const isRunning = showPending && running === transition;

        return (
          <Button
            key={transition}
            type="button"
            variant={transition === "archive" ? "ghost" : "outline"}
            onClick={() => activate(transition)}
            disabled={pending}
          >
            {isRunning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Icon className={cn("size-4", TONES[transition])} />
            )}
            {t(`${transition}.label`)}
          </Button>
        );
      })}

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {confirming ? (
            <>
              <DialogHeader>
                <DialogTitle>{t(`${confirming}.confirmTitle`)}</DialogTitle>
                <DialogDescription>
                  {t(`${confirming}.confirmDescription`)}
                </DialogDescription>
              </DialogHeader>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirming(null)}
                  disabled={pending}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={() => run(confirming)}
                  disabled={pending}
                >
                  {showPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {showPending
                    ? t(`${confirming}.working`)
                    : t(`${confirming}.confirm`)}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
