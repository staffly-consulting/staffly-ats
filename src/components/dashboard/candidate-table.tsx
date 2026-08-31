"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { FileText, Flag, Inbox, Mail } from "lucide-react";
import { toast } from "sonner";

import { getResumeUrlAction } from "@/app/(dashboard)/dashboard/candidate-actions";
import { CandidateDetailSheet } from "@/components/dashboard/candidate-detail-sheet";
import { CandidateFilterBar } from "@/components/dashboard/candidate-filters";
import { CandidateStatusPill } from "@/components/dashboard/status-pill";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { JobPostCandidate } from "@/lib/candidates";
import {
  SCORE_BAND_BADGE_CLASSES,
  SCORE_BAND_LABELS,
  getScoreBand,
} from "@/lib/score";
import { cn, formatDate } from "@/lib/utils";

/**
 * Candidates assigned to a job post.
 *
 * Every column here reflects what the database actually holds today. Score,
 * nationality and university are null until extraction and scoring exist, and
 * they render as explicit "pending" states rather than dashes that could pass
 * for real absent values — a recruiter should be able to tell "we do not know
 * yet" from "this candidate has none".
 */

/** Shared placeholder for a field no pipeline has filled in yet. */
function Pending({ label = "Pending extraction" }: { label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default text-xs text-muted-foreground/70 italic">
          —
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CandidateTable({
  candidates,
  universities,
  nationalities,
  totalCount,
}: {
  candidates: JobPostCandidate[];
  universities: string[];
  nationalities: string[];
  /** Unfiltered count, for the "showing X of Y" line. */
  totalCount: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  // Name/email search stays client-side; every other filter is applied in SQL.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.name?.toLowerCase().includes(needle) ||
        candidate.email?.toLowerCase().includes(needle),
    );
  }, [candidates, query]);

  const selected = candidates.find((c) => c.id === selectedId) ?? null;

  function openResume(candidateId: string) {
    startTransition(async () => {
      const result = await getResumeUrlAction(candidateId);
      if (!result.ok) {
        toast.error("Could not open resume", { description: result.error });
        return;
      }
      window.open(result.data, "_blank", "noopener,noreferrer");
    });
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Inbox className="size-8 text-muted-foreground/60" />
        <div>
          <p className="text-sm font-medium">No candidates assigned yet</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Resumes forwarded to your inbox alias arrive unassigned. Route them
            to this role from the Inbox.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/inbox">Go to Inbox</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CandidateFilterBar
        universities={universities}
        nationalities={nationalities}
        resultCount={visible.length}
        totalCount={totalCount}
        query={query}
        onQueryChange={setQuery}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-23">Score</TableHead>
                <TableHead className="min-w-55">Candidate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-40">Resume</TableHead>
                <TableHead>Nationality</TableHead>
                <TableHead className="min-w-40">University</TableHead>
                <TableHead className="text-center">Referral</TableHead>
                <TableHead className="text-right">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="py-14 text-center">
                    <p className="text-sm font-medium">
                      No candidates match these filters
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Try widening the score threshold or clearing a filter.
                    </p>
                  </TableCell>
                </TableRow>
              ) : null}
              {visible.map((candidate) => (
                <TableRow
                  key={candidate.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open details for ${candidate.name ?? "candidate"}`}
                  onClick={() => setSelectedId(candidate.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(candidate.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer transition-colors",
                    "focus-visible:bg-accent focus-visible:outline-none",
                    selectedId === candidate.id && "bg-accent/60",
                  )}
                >
                  <TableCell>
                    {candidate.score === null ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-normal text-muted-foreground"
                      >
                        Not scored
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-semibold tabular-nums",
                                SCORE_BAND_BADGE_CLASSES[
                                  getScoreBand(candidate.score)
                                ],
                              )}
                            >
                              {candidate.score}
                              <span className="font-normal opacity-70">
                                /100
                              </span>
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {SCORE_BAND_LABELS[getScoreBand(candidate.score)]}
                            {candidate.mandatoryPassed === false
                              ? " — a mandatory requirement is unmet"
                              : ""}
                          </TooltipContent>
                        </Tooltip>
                        {candidate.flagged ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Flag className="size-3.5 shrink-0 text-warning" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              {candidate.flagReason ?? "Needs a human look"}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="font-medium">
                      {candidate.name ?? (
                        <span className="text-muted-foreground italic">
                          Unknown sender
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="size-3 shrink-0" />
                      <span className="truncate">
                        {candidate.email ?? "no address"}
                      </span>
                    </div>
                    {!candidate.extracted ? (
                      <span className="text-[10px] text-muted-foreground/70">
                        from email sender
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    <CandidateStatusPill status={candidate.status} />
                  </TableCell>

                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 max-w-full justify-start px-1.5 text-xs"
                      disabled={pending}
                      onClick={() => openResume(candidate.id)}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {candidate.resumeFilename}
                      </span>
                    </Button>
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {candidate.nationality ??
                      (candidate.extracted ? (
                        <Pending label="Not stated on the resume" />
                      ) : (
                        <Pending />
                      ))}
                  </TableCell>

                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    {candidate.extracted?.university ??
                      (candidate.extracted ? (
                        <Pending label="Not stated on the resume" />
                      ) : (
                        <Pending />
                      ))}
                  </TableCell>

                  <TableCell className="text-center">
                    {candidate.referral ? (
                      <Badge
                        variant="outline"
                        className="border-brand/25 bg-brand/10 text-brand"
                      >
                        Yes
                      </Badge>
                    ) : (
                      <Pending label="Referrals are recorded manually; none for this candidate" />
                    )}
                  </TableCell>

                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatDate(candidate.ingestedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <CandidateDetailSheet
        candidate={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onOpenResume={openResume}
        resumePending={pending}
      />
    </div>
  );
}
