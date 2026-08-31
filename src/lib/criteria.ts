import type { Prisma } from "@prisma/client";

import type { Criterion, CriterionType, EducationLevel } from "@/lib/types";
import { EDUCATION_LEVELS } from "@/lib/types";
import { CRITERION_TYPES } from "@/lib/validations/job-post";

/**
 * The boundary between the `Criterion[]` the app works with and the opaque
 * `Json` columns Prisma stores.
 *
 * ## Persisted shape
 *
 * `mandatoryCriteria` is a bare array:
 *
 *   [{ "id": "...", "type": "skill", "label": "React", "value": "React", "weight": 5 }]
 *
 * `optionalCriteria` is an envelope, because the fixed schema has nowhere else
 * to put the preferred-university association and adding a column is off the
 * table for this step:
 *
 *   { "criteria": [ ...same shape... ], "preferredUniversityIds": ["uuid", ...] }
 *
 * The asymmetry is deliberate and contained here — every reader goes through
 * `readCriteria` / `readOptional` below, so nothing else has to know.
 *
 * ## Reading is defensive
 *
 * These columns are `Json`: Postgres will happily hold anything that was
 * written by an older build, a migration, or a hand-edit in the SQL editor.
 * Three shapes are accepted on read:
 *
 *   1. the envelope above
 *   2. a bare array of current-shape criteria
 *   3. Step 2's shape, `{ id, label, type: "mandatory" | "optional", weight }`,
 *      where `type` meant the section rather than the kind of requirement
 *
 * Anything unrecognisable is dropped rather than thrown, because a malformed
 * row must not take down the page that renders it.
 */

const CRITERION_TYPE_SET = new Set<string>(CRITERION_TYPES);
const EDUCATION_LEVEL_SET = new Set<string>(EDUCATION_LEVELS);

/** Index-signature form so the result is assignable to Prisma's `InputJsonValue`. */
export type StoredCriterion = {
  id: string;
  type: string;
  label: string;
  value?: string;
  minYears?: number;
  weight: number;
  [key: string]: string | number | undefined;
};

function coerceWeight(raw: unknown): number {
  const weight = Math.round(Number(raw));
  if (!Number.isFinite(weight)) return 5;
  return Math.min(10, Math.max(1, weight));
}

function parseCriterion(entry: unknown, index: number): Criterion | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (label === "") return null;

  const rawType = typeof record.type === "string" ? record.type : "";
  // Step 2 stored the section name in `type`. Those rows carry no structured
  // detail, so they become free-text `custom` criteria with their label intact.
  const type: CriterionType = CRITERION_TYPE_SET.has(rawType)
    ? (rawType as CriterionType)
    : "custom";

  const value =
    typeof record.value === "string" && record.value.trim() !== ""
      ? record.value.trim()
      : undefined;

  const minYearsRaw = Number(record.minYears);
  const minYears =
    type === "years_experience" && Number.isFinite(minYearsRaw)
      ? Math.max(0, Math.round(minYearsRaw))
      : undefined;

  return {
    id:
      typeof record.id === "string" && record.id !== ""
        ? record.id
        : `criterion_${index}`,
    type,
    label,
    value:
      type === "education_level" && value && !EDUCATION_LEVEL_SET.has(value)
        ? undefined
        : value,
    minYears,
    weight: coerceWeight(record.weight),
  };
}

function parseCriterionArray(value: unknown): Criterion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => parseCriterion(entry, index))
    .filter((criterion): criterion is Criterion => criterion !== null);
}

/** Reads `mandatoryCriteria`, which is always a bare array. */
export function readMandatoryCriteria(
  value: Prisma.JsonValue | null | undefined,
): Criterion[] {
  // Tolerate the envelope here too, in case the columns are ever swapped.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return parseCriterionArray((value as Record<string, unknown>).criteria);
  }
  return parseCriterionArray(value);
}

/** Reads `optionalCriteria`, accepting both the envelope and a bare array. */
export function readOptionalCriteria(
  value: Prisma.JsonValue | null | undefined,
): {
  criteria: Criterion[];
  preferredUniversityIds: string[];
} {
  if (Array.isArray(value)) {
    // Step 2 shape: no envelope, so no university association existed yet.
    return { criteria: parseCriterionArray(value), preferredUniversityIds: [] };
  }

  if (typeof value !== "object" || value === null) {
    return { criteria: [], preferredUniversityIds: [] };
  }

  const record = value as Record<string, unknown>;
  const ids = Array.isArray(record.preferredUniversityIds)
    ? record.preferredUniversityIds.filter(
        (id): id is string => typeof id === "string" && id !== "",
      )
    : [];

  return {
    criteria: parseCriterionArray(record.criteria),
    preferredUniversityIds: ids,
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

function toStored(criterion: Criterion): StoredCriterion {
  const stored: StoredCriterion = {
    id: criterion.id,
    type: criterion.type,
    label: criterion.label.trim(),
    weight: coerceWeight(criterion.weight),
  };

  // Only persist fields that mean something for this type — a stale `minYears`
  // left over from a type switch would confuse the scoring prompt later.
  if (criterion.type === "years_experience") {
    stored.minYears = Math.max(0, Math.round(criterion.minYears ?? 0));
  } else if (criterion.value) {
    stored.value = criterion.value.trim();
  }

  return stored;
}

export function writeMandatoryCriteria(
  criteria: Criterion[],
): StoredCriterion[] {
  return criteria.map(toStored);
}

export function writeOptionalCriteria(
  criteria: Criterion[],
  preferredUniversityIds: string[],
) {
  return {
    criteria: criteria.map(toStored),
    preferredUniversityIds: [...new Set(preferredUniversityIds)],
  };
}

/* -------------------------------------------------------------------------- */
/* Human-readable rendering                                                    */
/* -------------------------------------------------------------------------- */

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  high_school: "High school",
  associate: "Associate degree",
  bachelors: "Bachelor's degree",
  masters: "Master's degree",
  phd: "PhD",
};

export const CRITERION_TYPE_LABELS: Record<CriterionType, string> = {
  years_experience: "Years of experience",
  skill: "Skill",
  education_level: "Education level",
  certification: "Certification",
  location: "Location",
  custom: "Custom",
};

/**
 * One criterion as a recruiter would say it out loud.
 *
 * This is also what will be interpolated into the AI scoring prompt, so it
 * needs to carry the structured detail in prose — "3+ years" rather than just
 * the label the recruiter typed.
 */
export function describeCriterion(criterion: Criterion): string {
  switch (criterion.type) {
    case "years_experience":
      return `${criterion.minYears ?? 0}+ years — ${criterion.label}`;
    case "education_level": {
      const level = criterion.value as EducationLevel | undefined;
      const levelLabel = level ? EDUCATION_LEVEL_LABELS[level] : undefined;
      return levelLabel
        ? `${levelLabel} (${criterion.label})`
        : criterion.label;
    }
    case "location":
      return criterion.value
        ? `Located in ${criterion.value} — ${criterion.label}`
        : criterion.label;
    case "skill":
    case "certification":
      return criterion.value && criterion.value !== criterion.label
        ? `${criterion.value} — ${criterion.label}`
        : criterion.label;
    default:
      return criterion.label;
  }
}

/** Weight band shown next to optional criteria. Bands come from the spec. */
export function weightBand(weight: number): {
  label: string;
  className: string;
} {
  if (weight >= 8) {
    return {
      label: "Strongly preferred",
      className: "bg-brand/10 text-brand border-brand/25",
    };
  }
  if (weight >= 4) {
    return {
      label: "Important",
      className: "bg-warning/14 text-warning border-warning/25",
    };
  }
  return {
    label: "Nice to have",
    className: "bg-muted text-muted-foreground border-border",
  };
}
