"use client";

import { Controller, useFormContext, type FieldPath } from "react-hook-form";

import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  CRITERION_TYPE_LABELS,
  EDUCATION_LEVEL_LABELS,
  weightBand,
} from "@/lib/criteria";
import { EDUCATION_LEVELS, type CriterionType } from "@/lib/types";
import type { JobPostFormValues } from "@/lib/validations/job-post";
import { CRITERION_TYPES } from "@/lib/validations/job-post";
import { cn } from "@/lib/utils";

type Section = "mandatoryCriteria" | "optionalCriteria";

/** Placeholder copy per type — concrete examples beat abstract instructions. */
const VALUE_PLACEHOLDERS: Partial<Record<CriterionType, string>> = {
  skill: "React",
  certification: "AWS Solutions Architect",
  location: "Berlin, or EU timezone",
};

const LABEL_PLACEHOLDERS: Record<CriterionType, string> = {
  years_experience: "Backend engineering",
  skill: "Comfortable building production React apps",
  education_level: "Computer science or related field",
  certification: "Current, not expired",
  location: "Must overlap with CET business hours",
  custom: "Has shipped a product end to end",
};

export function CriterionRow({
  section,
  index,
  onRemove,
}: {
  section: Section;
  index: number;
  onRemove: () => void;
}) {
  const form = useFormContext<JobPostFormValues>();
  const isOptional = section === "optionalCriteria";

  const path = <K extends string>(field: K) =>
    `${section}.${index}.${field}` as FieldPath<JobPostFormValues>;

  const type = form.watch(path("type")) as CriterionType;

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          {/* Type ------------------------------------------------------- */}
          <Controller
            control={form.control}
            name={path("type")}
            render={({ field, fieldState }) => (
              <Field>
                <FieldLabel
                  htmlFor={`${section}-${index}-type`}
                  className="text-xs text-muted-foreground"
                >
                  Requirement type
                </FieldLabel>
                <Select
                  value={field.value as string}
                  onValueChange={(next) => {
                    field.onChange(next);
                    // Clear fields that no longer apply, so a leftover value
                    // from the previous type is never persisted or scored.
                    form.setValue(path("value"), undefined, {
                      shouldValidate: false,
                    });
                    form.setValue(path("minYears"), undefined, {
                      shouldValidate: false,
                    });
                  }}
                >
                  <SelectTrigger
                    id={`${section}-${index}-type`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRITERION_TYPES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {CRITERION_TYPE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          {/* Type-specific input ---------------------------------------- */}
          {type === "years_experience" ? (
            <Controller
              control={form.control}
              name={path("minYears")}
              render={({ field, fieldState }) => (
                <Field>
                  <FieldLabel
                    htmlFor={`${section}-${index}-minYears`}
                    className="text-xs text-muted-foreground"
                  >
                    Minimum years
                  </FieldLabel>
                  <Input
                    id={`${section}-${index}-minYears`}
                    type="number"
                    min={0}
                    max={50}
                    inputMode="numeric"
                    className="tabular-nums sm:max-w-32"
                    value={field.value === undefined ? "" : String(field.value)}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                      )
                    }
                    onBlur={field.onBlur}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : type === "education_level" ? (
            <Controller
              control={form.control}
              name={path("value")}
              render={({ field, fieldState }) => (
                <Field>
                  <FieldLabel
                    htmlFor={`${section}-${index}-value`}
                    className="text-xs text-muted-foreground"
                  >
                    Minimum level
                  </FieldLabel>
                  <Select
                    value={(field.value as string) ?? ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id={`${section}-${index}-value`}
                      className="w-full"
                    >
                      <SelectValue placeholder="Choose a level" />
                    </SelectTrigger>
                    <SelectContent>
                      {EDUCATION_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {EDUCATION_LEVEL_LABELS[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : type === "custom" ? null : (
            <Controller
              control={form.control}
              name={path("value")}
              render={({ field, fieldState }) => (
                <Field>
                  <FieldLabel
                    htmlFor={`${section}-${index}-value`}
                    className="text-xs text-muted-foreground"
                  >
                    {type === "location" ? "Location" : "Name"}
                  </FieldLabel>
                  <Input
                    id={`${section}-${index}-value`}
                    value={(field.value as string) ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={VALUE_PLACEHOLDERS[type]}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="mt-5 shrink-0 text-muted-foreground hover:text-danger"
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Remove requirement {index + 1}</span>
        </Button>
      </div>

      {/* Label ---------------------------------------------------------- */}
      <Controller
        control={form.control}
        name={path("label")}
        render={({ field, fieldState }) => (
          <Field className="mt-3">
            <FieldLabel
              htmlFor={`${section}-${index}-label`}
              className="text-xs text-muted-foreground"
            >
              What this means, in your words
            </FieldLabel>
            <Input
              id={`${section}-${index}-label`}
              value={(field.value as string) ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              placeholder={LABEL_PLACEHOLDERS[type]}
            />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />

      {/* Weight (optional criteria only) -------------------------------- */}
      {isOptional ? (
        <Controller
          control={form.control}
          name={path("weight")}
          render={({ field, fieldState }) => {
            const weight = Number(field.value) || 1;
            const band = weightBand(weight);

            return (
              <Field className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel
                    htmlFor={`${section}-${index}-weight`}
                    className="text-xs text-muted-foreground"
                  >
                    Weight
                  </FieldLabel>
                  <Badge
                    variant="outline"
                    className={cn("gap-1.5 tabular-nums", band.className)}
                  >
                    {weight}
                    <span className="font-normal opacity-85">{band.label}</span>
                  </Badge>
                </div>
                <Slider
                  id={`${section}-${index}-weight`}
                  min={1}
                  max={10}
                  step={1}
                  value={[weight]}
                  onValueChange={([next]) => field.onChange(next)}
                  aria-label={`Weight for requirement ${index + 1}`}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            );
          }}
        />
      ) : null}
    </li>
  );
}
