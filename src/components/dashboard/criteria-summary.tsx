"use client";

import { useState } from "react";

import {
  ChevronDown,
  GraduationCap,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { describeCriterion, weightBand } from "@/lib/criteria";
import type { Criterion } from "@/lib/types";
import type { UniversityOption } from "@/lib/universities";
import { cn, pluralize } from "@/lib/utils";

/**
 * The job's requirements in plain language, shown above the candidate table.
 *
 * Two audiences: the recruiter, who needs to remember what they are screening
 * for while reading candidates, and — later — the AI scoring prompt, which will
 * be handed the same `describeCriterion()` output. Keeping one renderer means
 * what the recruiter reads is literally what the model is told.
 */
export function CriteriaSummary({
  mandatoryCriteria,
  optionalCriteria,
  referralPriorityEnabled,
  referralBonusWeight,
  universities,
}: {
  mandatoryCriteria: Criterion[];
  optionalCriteria: Criterion[];
  referralPriorityEnabled: boolean;
  referralBonusWeight: number;
  universities: UniversityOption[];
}) {
  const [open, setOpen] = useState(false);

  const total = mandatoryCriteria.length + optionalCriteria.length;

  /** One-line gist for the collapsed state. */
  const preview =
    total === 0
      ? "No requirements defined yet"
      : [
          `${mandatoryCriteria.length} mandatory`,
          `${optionalCriteria.length} optional`,
          referralPriorityEnabled ? `referral +${referralBonusWeight}` : null,
          universities.length
            ? `${universities.length} preferred ${pluralize(universities.length, "university", "universities")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Screening criteria</h2>
          <p className="truncate text-xs text-muted-foreground">{preview}</p>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-xs">
            {open ? "Hide" : "Show details"}
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180",
              )}
            />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="space-y-4 border-t border-border px-4 py-4">
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">
              This job post has no requirements, so applications cannot be
              scored. Add some from the Edit screen.
            </p>
          ) : null}

          {mandatoryCriteria.length > 0 ? (
            <section>
              <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <ShieldCheck className="size-3.5 text-brand" />
                Mandatory
              </h3>
              <ul className="mt-2 space-y-1.5">
                {mandatoryCriteria.map((criterion) => (
                  <li
                    key={criterion.id}
                    className="flex items-start gap-2 text-sm"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
                    />
                    <span>{describeCriterion(criterion)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {optionalCriteria.length > 0 ? (
            <section>
              <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <Sparkles className="size-3.5" />
                Optional
              </h3>
              <ul className="mt-2 space-y-1.5">
                {optionalCriteria.map((criterion) => {
                  const band = weightBand(criterion.weight);
                  return (
                    <li
                      key={criterion.id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                      />
                      <span>{describeCriterion(criterion)}</span>
                      <Badge
                        variant="outline"
                        className={cn("tabular-nums", band.className)}
                      >
                        {criterion.weight} · {band.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {referralPriorityEnabled || universities.length > 0 ? (
            <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3">
              {referralPriorityEnabled ? (
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <UserPlus className="size-3.5 text-brand" />
                  Referral bonus:{" "}
                  <span className="font-medium tabular-nums">
                    +{referralBonusWeight}
                  </span>
                </span>
              ) : null}

              {universities.length > 0 ? (
                <span className="inline-flex flex-wrap items-center gap-1.5 text-sm">
                  <GraduationCap className="size-3.5 text-muted-foreground" />
                  Preferred universities:
                  {universities.map((university) => (
                    <Badge
                      key={university.id}
                      variant="outline"
                      className="text-muted-foreground"
                    >
                      {university.name}
                    </Badge>
                  ))}
                </span>
              ) : null}
            </section>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
