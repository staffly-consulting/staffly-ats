"use client";

import { useTransition } from "react";
import Link from "next/link";

import { CheckCircle2, FileText, Mail, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  getResumeUrlAction,
  rescoreCandidateAction,
  retryExtractionAction,
} from "@/app/(dashboard)/dashboard/candidate-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FailedCandidate } from "@/lib/candidates";
import { formatDateTime } from "@/lib/utils";

/**
 * The failed queue.
 *
 * The schema stores no error message, so rather than showing a blank column
 * this infers *where* the pipeline stopped from what did and did not get
 * written — which is the question a recruiter actually has, and determines
 * which retry button is the right one.
 */
function failurePoint(candidate: FailedCandidate): {
  action: "extraction" | "scoring";
} {
  // Returns the stage only; the label, the explanation and the retry wording all
  // come from the message catalogue, keyed off this. "Retry extraction" is a
  // separate key from "Extraction" rather than a lowercased concatenation —
  // that trick only works in English.
  return {
    action: candidate.hasExtractedData ? "scoring" : "extraction",
  };
}

export function FailedCandidatesTable({
  candidates,
}: {
  candidates: FailedCandidate[];
}) {
  const t = useTranslations("failures");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  function retry(candidate: FailedCandidate) {
    const { action } = failurePoint(candidate);
    startTransition(async () => {
      const result =
        action === "extraction"
          ? await retryExtractionAction(candidate.id)
          : await rescoreCandidateAction(candidate.id);

      if (!result.ok) {
        toast.error(t("retryFailed"), { description: result.error });
        return;
      }
      toast.success(
        action === "extraction" ? t("extractionQueued") : t("scoringQueued"),
        { description: t("queuedDescription") },
      );
    });
  }

  function openResume(candidateId: string) {
    startTransition(async () => {
      const result = await getResumeUrlAction(candidateId);
      if (!result.ok) {
        toast.error(t("openResumeFailed"), { description: result.error });
        return;
      }
      window.open(result.data, "_blank", "noopener,noreferrer");
    });
  }

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <CheckCircle2 className="size-8 text-success/70" />
        <div>
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="text-sm text-muted-foreground">
            {t("emptyDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-55">{t("columnCandidate")}</TableHead>
              <TableHead>{t("columnFailedAt")}</TableHead>
              <TableHead className="min-w-40">{t("columnJobPost")}</TableHead>
              <TableHead>{t("columnWhen")}</TableHead>
              <TableHead className="text-right">{t("retry")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => {
              const point = failurePoint(candidate);
              return (
                <TableRow key={candidate.id} className="hover:bg-transparent">
                  <TableCell>
                    <div className="font-medium">
                      {candidate.name ?? t("unknownSender")}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="size-3 shrink-0" />
                      <span className="truncate">
                        {candidate.email ?? "no address"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-6 max-w-full justify-start px-1 text-xs"
                      disabled={pending}
                      onClick={() => openResume(candidate.id)}
                    >
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate">
                        {candidate.resumeFilename}
                      </span>
                    </Button>
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-danger/25 bg-danger/10 text-danger"
                    >
                      {t(point.action)}
                    </Badge>
                    <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                      {point.action === "extraction"
                        ? t("extractionExplanation")
                        : t("scoringExplanation")}
                    </p>
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {candidate.jobPostId && candidate.jobPostTitle ? (
                      <Link
                        href={`/dashboard/jobs/${candidate.jobPostId}`}
                        className="text-brand hover:underline"
                      >
                        {candidate.jobPostTitle}
                      </Link>
                    ) : (
                      <span className="italic">{t("unassigned")}</span>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(candidate.updatedAt, locale)}
                  </TableCell>

                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => retry(candidate)}
                    >
                      <RefreshCw
                        className={
                          pending ? "size-3.5 animate-spin" : "size-3.5"
                        }
                      />
                      {point.action === "extraction"
                        ? t("retryExtraction")
                        : t("retryScoring")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
