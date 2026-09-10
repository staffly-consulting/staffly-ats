"use client";

import { useTransition } from "react";

import {
  AlertTriangle,
  Award,
  Check,
  Flag,
  Loader2,
  Minus,
  Target,
  Briefcase,
  FileText,
  GraduationCap,
  Globe,
  Hourglass,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Sparkles,
  UserPlus,
  Star,
  ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";

import {
  rescoreCandidateAction,
  setCandidateDecisionAction,
  retryExtractionAction,
} from "@/app/(dashboard)/dashboard/candidate-actions";
import { CandidateStatusPill } from "@/components/dashboard/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { JobPostCandidate } from "@/lib/candidates";
import type { ExtractedResumeData } from "@/lib/validations/resume";
import {
  SCORE_BAND_BADGE_CLASSES,
  SCORE_BAND_LABELS,
  getScoreBand,
} from "@/lib/score";
import { useVisiblePending } from "@/lib/use-visible-pending";
import { cn, formatDateTime, pluralize } from "@/lib/utils";

/**
 * Candidate detail drawer.
 *
 * Three distinct states, because conflating them misleads a recruiter:
 *   - extraction has not run (or is running) → pending panel
 *   - extraction failed → error panel with a retry
 *   - extraction succeeded → the structured data below
 *
 * Scoring keeps its own pending panel regardless, since Step 7 has not landed.
 */

const EDUCATION_LABELS: Record<
  NonNullable<ExtractedResumeData["educationLevel"]>,
  string
> = {
  high_school: "High school",
  bachelors: "Bachelor's degree",
  masters: "Master's degree",
  phd: "PhD",
  other: "Other qualification",
};

function DetailRow({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate">{value}</div>
        {hint ? (
          <div className="text-[10px] text-muted-foreground/70">{hint}</div>
        ) : null}
      </div>
    </div>
  );
}

const NOT_CAPTURED = (
  <span className="text-muted-foreground italic">Not captured yet</span>
);

const NOT_STATED = (
  <span className="text-muted-foreground italic">Not stated on resume</span>
);

function SectionHeading({
  icon: Icon,
  tone = "text-brand",
  children,
}: {
  icon: React.ElementType;
  /**
   * Colour for the icon only — the label stays muted.
   *
   * Tinting the glyph rather than the text is what keeps a long sheet
   * scannable: the eye finds "the orange one" faster than it reads six
   * identical grey headings, and the type hierarchy is unchanged.
   */
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      <Icon className={cn("size-3.5", tone)} />
      {children}
    </h3>
  );
}

function ExtractedPanel({ data }: { data: ExtractedResumeData }) {
  return (
    <>
      <section className="rounded-lg border border-border bg-muted/40 p-3">
        <SectionHeading icon={Sparkles} tone="text-brand">
          Summary
        </SectionHeading>
        <p className="mt-2 text-sm leading-relaxed">{data.rawSummary}</p>
      </section>

      {data.referralMentioned ? (
        <section className="rounded-lg border border-brand/25 bg-brand/5 p-3">
          <SectionHeading icon={UserPlus} tone="text-brand">
            Referral mentioned
          </SectionHeading>
          <p className="mt-2 text-sm leading-relaxed">
            {data.referralNote ??
              "The resume mentions a referral but names no referrer."}
          </p>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Claimed by the candidate — not verified against your team.
          </p>
        </section>
      ) : null}

      {data.skills.length > 0 ? (
        <section>
          <SectionHeading icon={Sparkles} tone="text-brand">
            Skills ({data.skills.length})
          </SectionHeading>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.skills.map((skill) => (
              <Badge key={skill} variant="secondary">
                {skill}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeading icon={GraduationCap} tone="text-violet-500">
          Education
        </SectionHeading>
        <div className="mt-2 space-y-1 text-sm">
          <div>
            {data.educationLevel
              ? EDUCATION_LABELS[data.educationLevel]
              : NOT_STATED}
          </div>
          {data.degree ? (
            <div className="text-muted-foreground">{data.degree}</div>
          ) : null}
          {data.university ? (
            <div className="text-muted-foreground">{data.university}</div>
          ) : null}
        </div>
      </section>

      {data.workHistory.length > 0 ? (
        <section>
          <SectionHeading icon={Briefcase} tone="text-sky-500">
            Work history ({data.workHistory.length}{" "}
            {pluralize(data.workHistory.length, "role")})
          </SectionHeading>
          {/* Timeline: the left border is the spine, each dot a role. */}
          <ol className="mt-3 space-y-4 border-l border-border pl-4">
            {data.workHistory.map((role, index) => (
              <li
                key={`${role.company}-${role.title}-${index}`}
                className="relative"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-brand ring-4 ring-card"
                />
                <div className="text-sm font-medium">{role.title}</div>
                <div className="text-sm text-muted-foreground">
                  {role.company}
                </div>
                {role.startDate || role.endDate ? (
                  <div className="text-xs text-muted-foreground/80">
                    {[role.startDate, role.endDate].filter(Boolean).join(" – ")}
                  </div>
                ) : null}
                {role.description ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {role.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {data.certifications.length > 0 ? (
        <section>
          <SectionHeading icon={Award} tone="text-amber-500">
            Certifications
          </SectionHeading>
          <ul className="mt-2 space-y-1.5">
            {data.certifications.map((cert, index) => (
              <li key={`${cert.name}-${index}`} className="text-sm">
                {cert.credentialUrl ? (
                  <a
                    href={cert.credentialUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-brand hover:underline"
                  >
                    {cert.name}
                  </a>
                ) : (
                  cert.name
                )}
                {cert.dateObtained ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {cert.dateObtained}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function ScorePanel({
  candidate,
  onRescore,
  rescoring,
}: {
  candidate: JobPostCandidate;
  onRescore: () => void;
  rescoring: boolean;
}) {
  const band = getScoreBand(candidate.score);
  const mandatory = candidate.scoreBreakdown.filter((r) => r.isMandatory);
  const optional = candidate.scoreBreakdown.filter((r) => !r.isMandatory);
  const bonuses =
    candidate.referralBonusApplied + candidate.universityBonusApplied;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      {/* Headline: the number, and whether the hard gate was cleared. Those
          two facts together are what a recruiter acts on. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionHeading icon={Target} tone="text-brand">
            Score
          </SectionHeading>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                "text-3xl font-semibold tabular-nums",
                band === "strong" && "text-success",
                band === "moderate" && "text-warning",
                band === "weak" && "text-danger",
              )}
            >
              {candidate.score}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
            <Badge
              variant="outline"
              className={cn("ml-1", SCORE_BAND_BADGE_CLASSES[band])}
            >
              {SCORE_BAND_LABELS[band]}
            </Badge>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={rescoring}
          onClick={onRescore}
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              rescoring ? "animate-spin" : "text-brand",
            )}
          />
          {rescoring ? "Queueing…" : "Re-score"}
        </Button>
      </div>

      <div
        className={cn(
          "rounded-md border px-3 py-2 text-sm font-medium",
          candidate.mandatoryPassed
            ? "border-success/25 bg-success/10 text-success"
            : "border-danger/25 bg-danger/10 text-danger",
        )}
      >
        {candidate.mandatoryPassed
          ? "Meets every mandatory requirement"
          : `Missing ${mandatory.filter((r) => !r.met).length} of ${mandatory.length} mandatory requirements`}
      </div>

      {candidate.flagged ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          <Flag className="mt-0.5 size-3.5 shrink-0" />
          <span>{candidate.flagReason}</span>
        </div>
      ) : null}

      {candidate.scoreRationale ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {candidate.scoreRationale}
        </p>
      ) : null}

      {mandatory.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground">
            Mandatory requirements
          </h4>
          <ul className="mt-2 space-y-2">
            {mandatory.map((result) => (
              <CriterionRow key={result.criterionId} result={result} />
            ))}
          </ul>
        </div>
      ) : null}

      {optional.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground">
            Optional requirements
          </h4>
          <ul className="mt-2 space-y-2">
            {optional.map((result) => (
              <CriterionRow
                key={result.criterionId}
                result={result}
                showPoints
              />
            ))}
          </ul>
        </div>
      ) : null}

      {bonuses > 0 ? (
        <div className="space-y-1 border-t border-border/70 pt-3 text-sm">
          {candidate.referralBonusApplied > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Referral bonus</span>
              <span className="font-medium text-brand tabular-nums">
                +{candidate.referralBonusApplied}
              </span>
            </div>
          ) : null}
          {candidate.universityBonusApplied > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Preferred university bonus
              </span>
              <span className="font-medium text-brand tabular-nums">
                +{candidate.universityBonusApplied}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {candidate.scoredAt ? (
        <p className="text-[10px] text-muted-foreground">
          Scored {formatDateTime(candidate.scoredAt)} against this job
          post&apos;s criteria as they were at that moment.
        </p>
      ) : null}
    </section>
  );
}

function CriterionRow({
  result,
  showPoints = false,
}: {
  result: JobPostCandidate["scoreBreakdown"][number];
  showPoints?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full",
          result.met
            ? "bg-success/15 text-success"
            : "bg-danger/12 text-danger",
        )}
      >
        {result.met ? (
          <Check className="size-3" />
        ) : (
          <Minus className="size-3" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm leading-snug font-medium">{result.label}</p>
          {showPoints && result.points > 0 ? (
            <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
              +{result.points}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {result.rationale}
        </p>
      </div>
    </li>
  );
}

export function CandidateDetailSheet({
  candidate,
  open,
  onOpenChange,
  onOpenResume,
  resumePending,
  canDecide,
}: {
  candidate: JobPostCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenResume: (candidateId: string) => void;
  resumePending: boolean;
  /** False for VIEWER — see `CandidateTable`. */
  canDecide: boolean;
}) {
  const [retrying, startRetry] = useTransition();
  const [rescoring, startRescore] = useTransition();
  const [deciding, startDecide] = useTransition();

  // Raw transition flags are too brief to see — see `useVisiblePending`.
  const showDeciding = useVisiblePending(deciding);
  const showResume = useVisiblePending(resumePending);
  const showRescoring = useVisiblePending(rescoring);
  const showRetrying = useVisiblePending(retrying);

  /**
   * Records the hiring decision.
   *
   * Clicking the state a candidate is already in clears it, so the same button
   * is both "shortlist" and "un-shortlist" — a separate undo control for a
   * two-state toggle is more UI than the decision deserves.
   */
  function decide(candidateId: string, next: "SHORTLISTED" | "REJECTED") {
    const target = candidate?.status === next ? "UNDECIDED" : next;

    startDecide(async () => {
      const result = await setCandidateDecisionAction(candidateId, target);
      if (!result.ok) {
        toast.error("Could not save that decision", {
          description: result.error,
        });
        return;
      }
      toast.success(
        target === "SHORTLISTED"
          ? "Added to the shortlist"
          : target === "REJECTED"
            ? "Marked as rejected"
            : "Decision cleared",
      );
    });
  }

  function retry(candidateId: string) {
    startRetry(async () => {
      const result = await retryExtractionAction(candidateId);
      if (!result.ok) {
        toast.error("Could not retry", { description: result.error });
        return;
      }
      toast.success("Extraction queued", {
        description: "Refresh in a moment to see the result.",
      });
    });
  }

  function rescore(candidateId: string) {
    startRescore(async () => {
      const result = await rescoreCandidateAction(candidateId);
      if (!result.ok) {
        toast.error("Could not re-score", { description: result.error });
        return;
      }
      toast.success("Scoring queued", {
        description: "Refresh in a moment to see the updated score.",
      });
    });
  }

  const data = candidate?.extracted ?? null;
  const isRunning =
    candidate?.status === "PROCESSING" || candidate?.status === "NEW";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
      >
        {candidate ? (
          <>
            <SheetHeader className="gap-3">
              <div>
                <SheetTitle className="truncate text-lg">
                  {candidate.name ?? "Unknown sender"}
                </SheetTitle>
                <SheetDescription className="truncate">
                  {data?.workHistory[0]
                    ? `${data.workHistory[0].title} · ${data.workHistory[0].company}`
                    : `Received ${formatDateTime(candidate.ingestedAt)}`}
                </SheetDescription>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <CandidateStatusPill status={candidate.status} />
                  {candidate.referral ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-brand/25 bg-brand/10 text-brand"
                    >
                      <UserPlus className="size-3 text-brand" />
                      Referral
                    </Badge>
                  ) : null}
                  {candidate.score !== null ? (
                    <Badge variant="outline" className="tabular-nums">
                      Score {candidate.score}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-4">
              <Separator />

              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DetailRow
                  icon={Mail}
                  label="Email"
                  value={
                    candidate.email ? (
                      <a
                        href={`mailto:${candidate.email}`}
                        className="text-brand hover:underline"
                      >
                        {candidate.email}
                      </a>
                    ) : (
                      NOT_CAPTURED
                    )
                  }
                  hint={
                    candidate.email && !data
                      ? "from email sender, not the resume"
                      : undefined
                  }
                />
                <DetailRow
                  icon={Phone}
                  label="Phone"
                  value={candidate.phone ?? NOT_CAPTURED}
                />
                <DetailRow
                  icon={Globe}
                  label="Nationality"
                  value={candidate.nationality ?? NOT_STATED}
                  hint={data ? "only recorded when stated outright" : undefined}
                />
                <DetailRow
                  icon={MapPin}
                  label="Location"
                  value={data?.location ?? NOT_CAPTURED}
                />
                {data?.yearsOfExperience !== null &&
                data?.yearsOfExperience !== undefined ? (
                  <DetailRow
                    icon={Briefcase}
                    label="Experience"
                    value={`${data.yearsOfExperience} ${pluralize(data.yearsOfExperience, "year")}`}
                  />
                ) : null}
                <DetailRow
                  icon={FileText}
                  label="Resume file"
                  value={
                    <span className="truncate">{candidate.resumeFilename}</span>
                  }
                />
              </section>

              {candidate.status === "ERROR" ? (
                <section className="rounded-lg border border-danger/25 bg-danger/5 p-4">
                  <SectionHeading icon={AlertTriangle} tone="text-warning">
                    Extraction failed
                  </SectionHeading>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    The resume could not be read — it may be an unsupported
                    format, an unreadable scan, or the model may have returned
                    something unusable. The reason is in the Inngest run log.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={retrying}
                    onClick={() => retry(candidate.id)}
                  >
                    <RefreshCw
                      className={cn(
                        "size-3.5",
                        showRetrying ? "animate-spin" : "text-brand",
                      )}
                    />
                    {showRetrying ? "Queueing…" : "Retry extraction"}
                  </Button>
                </section>
              ) : data ? (
                <ExtractedPanel data={data} />
              ) : (
                <section className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
                  <SectionHeading icon={Hourglass} tone="text-muted-foreground">
                    {isRunning ? "Reading the resume…" : "Extraction pending"}
                  </SectionHeading>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {isRunning
                      ? "This usually takes a few seconds. Refresh to see the result."
                      : "Nothing has read this resume yet. Open it below to read it yourself."}
                  </p>
                  {!isRunning ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      disabled={retrying}
                      onClick={() => retry(candidate.id)}
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5",
                          showRetrying ? "animate-spin" : "text-brand",
                        )}
                      />
                      Run extraction
                    </Button>
                  ) : null}
                </section>
              )}

              {candidate.score !== null ? (
                <ScorePanel
                  candidate={candidate}
                  rescoring={showRescoring}
                  onRescore={() => rescore(candidate.id)}
                />
              ) : (
                <section className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
                  <SectionHeading icon={Hourglass} tone="text-muted-foreground">
                    Scoring pending
                  </SectionHeading>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {data
                      ? "This candidate has not been scored against this role's criteria yet."
                      : "Scoring runs once the resume has been extracted."}
                  </p>
                  {data ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      disabled={rescoring}
                      onClick={() => rescore(candidate.id)}
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5",
                          rescoring ? "animate-spin" : "text-brand",
                        )}
                      />
                      Run scoring
                    </Button>
                  ) : null}
                </section>
              )}
            </div>

            <SheetFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={resumePending}
                onClick={() => onOpenResume(candidate.id)}
              >
                {/* Every action here swaps its own icon for a spinner rather
                    than only greying out. A disabled button says "you cannot
                    press this"; a spinning one says "it is working", and the
                    resume fetch signs a URL round-trip that is slow enough for
                    the difference to matter. */}
                {showResume ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4 text-brand" />
                )}
                {resumePending ? "Opening…" : "Open resume"}
              </Button>

              {/* Hidden for VIEWER, and refused again in the action — the
                  hiding is a courtesy, the server check is the control. */}
              {canDecide ? (
                <>
                  <Button
                    variant={
                      candidate.status === "REJECTED"
                        ? "destructive"
                        : "outline"
                    }
                    className="flex-1"
                    disabled={deciding}
                    onClick={() => decide(candidate.id, "REJECTED")}
                  >
                    {showDeciding ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ThumbsDown
                        className={cn(
                          "size-4",
                          // Only tinted when it is not already the active
                          // state: the destructive variant supplies its own
                          // colour, and a second red on top muddies it.
                          candidate.status !== "REJECTED" && "text-danger",
                        )}
                      />
                    )}
                    {candidate.status === "REJECTED" ? "Rejected" : "Reject"}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={deciding}
                    onClick={() => decide(candidate.id, "SHORTLISTED")}
                  >
                    {showDeciding ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Star
                        className={cn(
                          "size-4",
                          // Filled once shortlisted, so the button reads as a
                          // state rather than only as a thing to press.
                          candidate.status === "SHORTLISTED"
                            ? "fill-amber-300 text-amber-300"
                            : "text-amber-300",
                        )}
                      />
                    )}
                    {candidate.status === "SHORTLISTED"
                      ? "Shortlisted"
                      : "Shortlist"}
                  </Button>
                </>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
