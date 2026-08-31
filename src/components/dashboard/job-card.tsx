import Link from "next/link";

import { ArrowUpRight, UserPlus, Users } from "lucide-react";

import { ScoreBadge } from "@/components/dashboard/score-indicator";
import { JobStatusPill } from "@/components/dashboard/status-pill";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { JobPostSummary } from "@/lib/job-posts";
import { cn, formatDate, pluralize } from "@/lib/utils";

export function JobCard({
  job,
  className,
}: {
  job: JobPostSummary;
  className?: string;
}) {
  const { stats } = job;
  const mandatoryCount = job.mandatoryCriteria.length;
  const optionalCount = job.optionalCriteria.length;

  return (
    <Card
      className={cn(
        "group relative gap-4 transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md",
        className,
      )}
    >
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-snug">
            {/* Stretched link: the whole card is the hit target. */}
            <Link
              href={`/dashboard/jobs/${job.id}`}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
            >
              {job.title}
            </Link>
          </CardTitle>
          <JobStatusPill status={job.status} />
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>Created {formatDate(job.createdAt)}</span>
          {job.createdByName ? <span>by {job.createdByName}</span> : null}
          {job.referralPriorityEnabled ? (
            <span className="inline-flex items-center gap-1 text-brand">
              <UserPlus className="size-3" />
              Referral priority
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-xl font-semibold tabular-nums">
            {stats.applicantCount}
          </div>
          <div className="text-xs text-muted-foreground">
            {pluralize(stats.applicantCount, "applicant")}
          </div>
        </div>
        <div>
          <div className="flex h-7 items-center">
            <ScoreBadge score={stats.averageScore} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">Avg. score</div>
        </div>
        <div>
          <div className="text-xl font-semibold text-success tabular-nums">
            {stats.shortlistedCount}
          </div>
          <div className="text-xs text-muted-foreground">Above threshold</div>
        </div>
      </CardContent>

      <Separator />

      <CardFooter className="items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" />
          {mandatoryCount} mandatory · {optionalCount} optional
        </span>
        {stats.pendingScoreCount > 0 ? (
          <span className="text-warning">
            {stats.pendingScoreCount} awaiting score
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground transition-colors group-hover:text-brand">
            View candidates
            <ArrowUpRight className="size-3.5" />
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
