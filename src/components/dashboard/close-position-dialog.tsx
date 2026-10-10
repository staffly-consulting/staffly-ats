"use client";

import { useTransition } from "react";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { setJobPostLifecycleAction } from "@/app/(dashboard)/dashboard/jobs/lifecycle.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useVisiblePending } from "@/lib/use-visible-pending";

/**
 * Asked right after a candidate is marked hired: is this position now filled?
 *
 * A question rather than an automatic close, because one job post often covers
 * several openings — the first hire for "Sales associate ×3" must not shut the
 * door on the other two. Declining changes nothing; the post can still be
 * closed from its header at any time.
 */
export function ClosePositionDialog({
  jobPostId,
  open,
  onOpenChange,
}: {
  jobPostId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("hiredClosePrompt");
  const [pending, startTransition] = useTransition();
  const showPending = useVisiblePending(pending);

  function close() {
    startTransition(async () => {
      const result = await setJobPostLifecycleAction(jobPostId, "close");
      if (!result.ok) {
        toast.error(t("failed"), { description: result.error });
        return;
      }
      toast.success(t("done"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("keepOpen")}
          </Button>
          <Button type="button" onClick={close} disabled={pending}>
            {showPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {showPending ? t("working") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
