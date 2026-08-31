"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  CriteriaBuilder,
  blankCriterion,
} from "@/components/forms/criteria-builder";
import { UniversitySelect } from "@/components/forms/university-select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { UniversityOption } from "@/lib/universities";
import {
  jobPostFormSchema,
  type JobPostFormValues,
} from "@/lib/validations/job-post";

/**
 * One form, two modes. `/dashboard/jobs/new` mounts it with defaults;
 * `/dashboard/jobs/[jobId]/edit` mounts it with `jobPostId` and the existing
 * values. Keeping a single component means the criteria builder can never
 * behave differently between create and edit.
 *
 * Submission goes to route handlers rather than server actions because the same
 * Zod schema has to guard an endpoint that could be called directly — see
 * `app/api/job-posts/route.ts`.
 */

export function defaultJobPostValues(): JobPostFormValues {
  return {
    title: "",
    description: "",
    status: "OPEN",
    mandatoryCriteria: [blankCriterion(10)],
    optionalCriteria: [],
    referralPriorityEnabled: false,
    referralBonusWeight: 0,
    preferredUniversityIds: [],
  };
}

export function JobPostForm({
  universities,
  jobPostId,
  defaultValues,
}: {
  universities: UniversityOption[];
  /** Present in edit mode; drives PATCH instead of POST. */
  jobPostId?: string;
  defaultValues?: JobPostFormValues;
}) {
  const router = useRouter();
  const isEdit = Boolean(jobPostId);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<JobPostFormValues>({
    resolver: zodResolver(jobPostFormSchema),
    defaultValues: defaultValues ?? defaultJobPostValues(),
    // Validate as the recruiter works rather than only on submit — with this
    // many nested fields, a submit-time error dump is unreadable.
    mode: "onBlur",
  });

  const referralEnabled = form.watch("referralPriorityEnabled");

  async function submit(values: JobPostFormValues, status: "DRAFT" | "OPEN") {
    setSubmitting(true);

    try {
      const response = await fetch(
        isEdit ? `/api/job-posts/${jobPostId}` : "/api/job-posts",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...values, status }),
        },
      );

      const body: { id?: string; error?: string } | null = await response
        .json()
        .catch(() => null);

      if (!response.ok) {
        toast.error(
          isEdit ? "Could not save changes" : "Could not create job post",
          {
            description: body?.error ?? `Request failed (${response.status}).`,
          },
        );
        return;
      }

      // A 2xx with no id means we did not reach our own handler — most likely
      // the session expired and something upstream answered instead. Navigating
      // on that would land on /dashboard/jobs/undefined.
      if (!body?.id) {
        toast.error("Your session may have expired", {
          description: "Reload the page and try again.",
        });
        return;
      }

      toast.success(
        isEdit
          ? "Job post updated"
          : status === "OPEN"
            ? "Job post published"
            : "Draft saved",
        {
          description: `${values.mandatoryCriteria.length} mandatory, ${values.optionalCriteria.length} optional requirements.`,
        },
      );

      router.push(`/dashboard/jobs/${body.id}`);
      router.refresh();
    } catch (error) {
      console.error("[JobPostForm] submit failed", error);
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  /** Surfaces the first validation failure instead of silently doing nothing. */
  function onInvalid() {
    toast.error("Some requirements need attention", {
      description: "Check the highlighted fields and try again.",
    });
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(
          (values) => submit(values, "OPEN"),
          onInvalid,
        )}
        className="space-y-6"
      >
        {/* Role details ------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Role details</CardTitle>
            <CardDescription>
              The description is given to the model as context when it screens
              each application, so specifics help.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Controller
              control={form.control}
              name="title"
              render={({ field, fieldState }) => (
                <Field>
                  <FieldLabel htmlFor="title">Job title</FieldLabel>
                  <Input
                    id="title"
                    {...field}
                    placeholder="Senior Backend Engineer"
                    maxLength={200}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />

            <Controller
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <Field>
                  <FieldLabel htmlFor="description">Description</FieldLabel>
                  <Textarea
                    id="description"
                    {...field}
                    rows={6}
                    placeholder="What the person will own, who they work with, and what success looks like."
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </CardContent>
        </Card>

        {/* Criteria ----------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Screening criteria</CardTitle>
            <CardDescription>
              Each requirement is scored independently with a written rationale.
              Mandatory ones gate the shortlist; optional ones rank the
              candidates who clear it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CriteriaBuilder />
          </CardContent>
        </Card>

        {/* Referrals ---------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Referrals</CardTitle>
            <CardDescription>
              Candidates referred by a team member can carry extra weight in the
              final score.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Controller
              control={form.control}
              name="referralPriorityEnabled"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Switch
                    id="referral-priority"
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      // Keep the pair coherent: enabling with a zero bonus is a
                      // validation error, and disabling should clear the bonus.
                      form.setValue("referralBonusWeight", checked ? 5 : 0, {
                        shouldValidate: true,
                      });
                    }}
                  />
                  <FieldLabel
                    htmlFor="referral-priority"
                    className="font-normal"
                  >
                    Prioritize referred candidates
                  </FieldLabel>
                </Field>
              )}
            />

            {referralEnabled ? (
              <Controller
                control={form.control}
                name="referralBonusWeight"
                render={({ field, fieldState }) => (
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel htmlFor="referral-bonus">
                        Bonus weight
                      </FieldLabel>
                      <span className="text-sm font-medium text-brand tabular-nums">
                        +{field.value}
                      </span>
                    </div>
                    <Slider
                      id="referral-bonus"
                      min={1}
                      max={10}
                      step={1}
                      value={[Number(field.value) || 1]}
                      onValueChange={([next]) => field.onChange(next)}
                      className="max-w-sm"
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            ) : null}
          </CardContent>
        </Card>

        {/* Universities -------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preferred universities</CardTitle>
            <CardDescription>
              Optional. Candidates from these schools are noted in the scoring
              rationale. Add one inline if it is not on your org&apos;s list
              yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Controller
              control={form.control}
              name="preferredUniversityIds"
              render={({ field, fieldState }) => (
                <Field>
                  <UniversitySelect
                    options={universities}
                    selectedIds={field.value}
                    onChange={field.onChange}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </CardContent>
        </Card>

        {/* Actions ------------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={submitting}
          >
            Cancel
          </Button>
          {!isEdit ? (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={form.handleSubmit(
                (values) => submit(values, "DRAFT"),
                onInvalid,
              )}
            >
              Save as draft
            </Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Publish job post"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
