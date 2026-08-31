"use client";

import { useState } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";

import { ChevronDown, Plus, ShieldCheck, Sparkles } from "lucide-react";

import { CriterionRow } from "@/components/forms/criterion-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { CriterionType } from "@/lib/types";
import type { JobPostFormValues } from "@/lib/validations/job-post";
import { cn, pluralize } from "@/lib/utils";

type Section = "mandatoryCriteria" | "optionalCriteria";

/**
 * `crypto.randomUUID` needs a secure context. It is available in every browser
 * this app targets over https/localhost, but the fallback keeps the builder
 * usable if a criterion is ever created somewhere it is not.
 */
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `criterion_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

export function blankCriterion(weight: number) {
  return {
    id: newId(),
    type: "skill" as CriterionType,
    label: "",
    value: "",
    minYears: undefined,
    weight,
  };
}

function SectionErrors({ section }: { section: Section }) {
  const {
    formState: { errors },
  } = useFormContext<JobPostFormValues>();

  // Array-level errors (min length, max length) live on the array itself rather
  // than on any row, so they need rendering separately from the row fields.
  const error = errors[section];
  const message =
    error && !Array.isArray(error) && "message" in error
      ? (error.message as string | undefined)
      : undefined;

  if (!message) return null;
  return <p className="text-sm text-danger">{message}</p>;
}

export function CriteriaBuilder() {
  const form = useFormContext<JobPostFormValues>();
  const [optionalOpen, setOptionalOpen] = useState(true);

  const mandatory = useFieldArray({
    control: form.control,
    name: "mandatoryCriteria",
  });
  const optional = useFieldArray({
    control: form.control,
    name: "optionalCriteria",
  });

  const mandatoryCount = mandatory.fields.length;
  const optionalCount = optional.fields.length;

  return (
    <div className="space-y-4">
      {/* Running count ------------------------------------------------- */}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          {mandatoryCount} mandatory
        </span>
        {", "}
        <span className="font-medium text-foreground tabular-nums">
          {optionalCount} optional
        </span>{" "}
        {pluralize(mandatoryCount + optionalCount, "requirement")} defined
      </p>

      {/* Mandatory ------------------------------------------------------ */}
      <section
        className={cn(
          "rounded-xl border-2 border-brand/25 bg-brand-subtle/30 p-4",
          "space-y-3",
        )}
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-brand" />
              Mandatory requirements
              <Badge
                variant="outline"
                className="border-brand/25 bg-brand/10 text-brand"
              >
                Required
              </Badge>
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Hard gates. A candidate who misses any of these scores very low no
              matter how strong they are elsewhere.
            </p>
          </div>
        </header>

        {mandatoryCount === 0 ? (
          <p className="rounded-lg border border-dashed border-brand/30 p-6 text-center text-sm text-muted-foreground">
            Add at least one mandatory requirement — this is what separates a
            shortlist from a pile of applications.
          </p>
        ) : (
          <ul className="space-y-2">
            {mandatory.fields.map((field, index) => (
              <CriterionRow
                key={field.id}
                section="mandatoryCriteria"
                index={index}
                onRemove={() => mandatory.remove(index)}
              />
            ))}
          </ul>
        )}

        <SectionErrors section="mandatoryCriteria" />

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => mandatory.append(blankCriterion(10))}
        >
          <Plus className="size-4" />
          Add mandatory requirement
        </Button>
      </section>

      {/* Optional ------------------------------------------------------- */}
      <Collapsible
        open={optionalOpen}
        onOpenChange={setOptionalOpen}
        className="rounded-xl border border-border bg-muted/25 p-4"
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-muted-foreground" />
              Optional requirements
              <Badge variant="outline" className="text-muted-foreground">
                Weighted
              </Badge>
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Nice-to-haves. These never disqualify anyone — they separate the
              candidates who already cleared the mandatory bar.
            </p>
          </div>

          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
            >
              {optionalOpen ? "Hide" : `Show (${optionalCount})`}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  optionalOpen && "rotate-180",
                )}
              />
            </Button>
          </CollapsibleTrigger>
        </header>

        <CollapsibleContent className="mt-3 space-y-3">
          {optionalCount === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No optional requirements yet. These are how two qualified
              candidates get ranked against each other.
            </p>
          ) : (
            <ul className="space-y-2">
              {optional.fields.map((field, index) => (
                <CriterionRow
                  key={field.id}
                  section="optionalCriteria"
                  index={index}
                  onRemove={() => optional.remove(index)}
                />
              ))}
            </ul>
          )}

          <SectionErrors section="optionalCriteria" />

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => optional.append(blankCriterion(5))}
          >
            <Plus className="size-4" />
            Add optional requirement
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
