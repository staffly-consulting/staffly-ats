"use client";

import { useState, useTransition } from "react";

import { FileText, Inbox, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  assignCandidateAction,
  getResumeUrlAction,
} from "@/app/(dashboard)/dashboard/candidate-actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InboxCandidate } from "@/lib/candidates";
import { formatDateTime } from "@/lib/utils";

/**
 * The unassigned queue. Intentionally thin: name and email are taken from the
 * *email envelope*, not the resume, so they are provisional — often the
 * forwarding recruiter rather than the applicant. Extraction replaces them.
 */
export function InboxTable({
  candidates,
  jobPosts,
}: {
  candidates: InboxCandidate[];
  jobPosts: { id: string; title: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("inbox");
  const [assigningId, setAssigningId] = useState<string | null>(null);

  function assign(candidateId: string, jobPostId: string) {
    setAssigningId(candidateId);
    startTransition(async () => {
      const result = await assignCandidateAction(candidateId, jobPostId);
      setAssigningId(null);

      if (!result.ok) {
        toast.error(t("assignFailed"), { description: result.error });
        return;
      }
      const post = jobPosts.find((job) => job.id === jobPostId);
      toast.success(
        t("assigned", { title: post?.title ?? t("jobPostFallback") }),
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
        <Inbox className="size-8 text-muted-foreground/60" />
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
              <TableHead className="min-w-55">{t("columnSender")}</TableHead>
              <TableHead className="min-w-45">{t("columnResume")}</TableHead>
              <TableHead>{t("columnReceived")}</TableHead>
              <TableHead className="min-w-55 text-right">
                {t("columnAssign")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => (
              <TableRow key={candidate.id} className="hover:bg-transparent">
                <TableCell>
                  <div className="font-medium">
                    {candidate.name ?? t("unknownSender")}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="size-3" />
                    {candidate.email ?? t("noAddress")}
                  </div>
                </TableCell>

                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 max-w-full justify-start px-1.5 text-xs"
                    disabled={pending}
                    onClick={() => openResume(candidate.id)}
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="truncate">{candidate.resumeFilename}</span>
                  </Button>
                </TableCell>

                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(candidate.ingestedAt)}
                </TableCell>

                <TableCell className="text-right">
                  {jobPosts.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No job posts yet
                    </span>
                  ) : (
                    <Select
                      disabled={pending && assigningId === candidate.id}
                      onValueChange={(value) => assign(candidate.id, value)}
                    >
                      <SelectTrigger
                        className="ml-auto w-56"
                        aria-label={t("assignAria", {
                          name: candidate.name ?? t("candidateFallback"),
                        })}
                      >
                        <SelectValue placeholder="Choose a role…" />
                      </SelectTrigger>
                      <SelectContent>
                        {jobPosts.map((job) => (
                          <SelectItem key={job.id} value={job.id}>
                            {job.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
