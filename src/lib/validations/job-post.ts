import { z } from "zod";

import { EDUCATION_LEVELS } from "@/lib/types";

/**
 * The validation contract for job posts.
 *
 * This file is imported by BOTH the React Hook Form resolver and the API route
 * handlers. That is the whole point: a server action or route handler is a
 * public HTTP endpoint, and client-side validation is a convenience for the
 * user, never a guarantee. One schema, checked twice.
 *
 * Prisma types `mandatoryCriteria` / `optionalCriteria` as opaque `Json`, so
 * this is also the only place the shape of those columns is actually enforced.
 */

export const CRITERION_TYPES = [
  "years_experience",
  "skill",
  "education_level",
  "certification",
  "location",
  "custom",
] as const;

export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 10;

/**
 * Per-type field requirements are expressed with `superRefine` rather than a
 * discriminated union, because the form lets a recruiter switch a row's type
 * mid-edit. A union would reject the intermediate state and blank their input;
 * this reports a targeted error on the field that still needs filling in.
 */
export const criterionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(CRITERION_TYPES),
    label: z
      .string()
      .trim()
      .min(1, "Give this requirement a short description.")
      .max(200, "Keep the description under 200 characters."),
    value: z.string().trim().max(200).optional(),
    minYears: z
      .number({ message: "Enter a number of years." })
      .int("Use whole years.")
      .min(0, "Years cannot be negative.")
      .max(50, "50 years is the maximum.")
      .optional(),
    weight: z
      .number()
      .int()
      .min(MIN_WEIGHT, `Weight must be at least ${MIN_WEIGHT}.`)
      .max(MAX_WEIGHT, `Weight must be at most ${MAX_WEIGHT}.`),
  })
  .superRefine((criterion, ctx) => {
    if (criterion.type === "years_experience") {
      if (criterion.minYears === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["minYears"],
          message: "Enter the minimum number of years.",
        });
      }
      return;
    }

    if (criterion.type === "education_level") {
      if (
        !criterion.value ||
        !EDUCATION_LEVELS.includes(criterion.value as never)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Choose an education level.",
        });
      }
      return;
    }

    // skill / certification / location all need a name to match against.
    if (criterion.type !== "custom" && !criterion.value) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "This field is required for the selected type.",
      });
    }
  });

export type CriterionInput = z.infer<typeof criterionSchema>;

/**
 * Two criteria are "the same" when they measure the same thing about a
 * candidate — same type, same target. Duplicates are rejected because the AI
 * scoring step would count the same evidence twice and skew the total.
 *
 * Matching is case- and whitespace-insensitive so "AWS" and " aws " collide.
 * `custom` rows fall back to their label, which is all they have.
 */
function duplicateKey(criterion: CriterionInput): string {
  const target =
    criterion.type === "years_experience"
      ? String(criterion.minYears ?? "")
      : (criterion.value ?? criterion.label);
  return `${criterion.type}::${target.trim().toLowerCase()}`;
}

function rejectDuplicates(
  criteria: CriterionInput[],
  ctx: z.RefinementCtx,
  path: string,
) {
  const seen = new Map<string, number>();

  criteria.forEach((criterion, index) => {
    const key = duplicateKey(criterion);
    const first = seen.get(key);

    if (first === undefined) {
      seen.set(key, index);
      return;
    }

    ctx.addIssue({
      code: "custom",
      // Point at the later row: that is the one the recruiter just added.
      path: [path, index, "label"],
      message: "This duplicates an earlier requirement.",
    });
  });
}

export const jobPostFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "A job title is required.")
      .max(200, "Keep the title under 200 characters."),
    // No `.default()` here on purpose: a default makes the schema's input and
    // output types diverge, which `zodResolver` rejects because React Hook Form
    // needs one type for both. The form always sends a string, empty or not.
    description: z.string().trim().max(20_000, "Description is too long."),
    status: z.enum(["DRAFT", "OPEN"]),

    mandatoryCriteria: z
      .array(criterionSchema)
      .min(1, "Add at least one mandatory requirement.")
      .max(25, "25 mandatory requirements is the maximum."),
    optionalCriteria: z
      .array(criterionSchema)
      .max(25, "25 optional requirements is the maximum."),

    referralPriorityEnabled: z.boolean(),
    referralBonusWeight: z
      .number()
      .int()
      .min(0)
      .max(MAX_WEIGHT, `Referral bonus must be at most ${MAX_WEIGHT}.`),

    preferredUniversityIds: z.array(z.string().min(1)).max(50),
  })
  .superRefine((values, ctx) => {
    rejectDuplicates(values.mandatoryCriteria, ctx, "mandatoryCriteria");
    rejectDuplicates(values.optionalCriteria, ctx, "optionalCriteria");

    // A criterion cannot be both a hard gate and a nice-to-have.
    const mandatoryKeys = new Set(values.mandatoryCriteria.map(duplicateKey));
    values.optionalCriteria.forEach((criterion, index) => {
      if (mandatoryKeys.has(duplicateKey(criterion))) {
        ctx.addIssue({
          code: "custom",
          path: ["optionalCriteria", index, "label"],
          message: "Already listed as a mandatory requirement.",
        });
      }
    });

    if (values.referralPriorityEnabled && values.referralBonusWeight < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["referralBonusWeight"],
        message: "Set a bonus of at least 1, or turn referral priority off.",
      });
    }
  });

export type JobPostFormValues = z.infer<typeof jobPostFormSchema>;

/** Payload accepted by `POST /api/job-posts` and `PATCH /api/job-posts/[id]`. */
export const jobPostApiSchema = jobPostFormSchema;

export const universityPreferenceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the university name.")
    .max(200, "Keep the name under 200 characters."),
  /** 1 = most preferred. Kept small deliberately; this is a ranking, not a score. */
  tier: z.number().int().min(1).max(5).default(1),
});

export type UniversityPreferenceInput = z.infer<
  typeof universityPreferenceSchema
>;
