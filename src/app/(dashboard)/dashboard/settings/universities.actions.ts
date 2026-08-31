"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { assertFeature } from "@/lib/entitlements";
import { FEATURES } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { universityPreferenceSchema } from "@/lib/validations/job-post";

/**
 * Edit and delete for the org's preferred universities.
 *
 * Creation already exists as the quick-add inside the job post form
 * (`dashboard/jobs/universities.actions.ts`) and is deliberately left alone —
 * this is additive. Both paths write the same rows.
 */

export type UniversityActionResult =
  { ok: true } | { ok: false; error: string };

export async function updateUniversityAction(
  id: string,
  input: unknown,
): Promise<UniversityActionResult> {
  const { orgId } = await requireOrgContext();

  try {
    await assertFeature(orgId, FEATURES.UNIVERSITY_PREFERENCES);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Feature not available.",
    };
  }

  if (typeof id !== "string" || id === "") {
    return { ok: false, error: "Missing university." };
  }

  const parsed = universityPreferenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid university.",
    };
  }

  try {
    // `updateMany` puts orgId in the WHERE clause rather than trusting the id
    // on its own — the same pattern used everywhere else in this codebase.
    const result = await prisma.universityPreference.updateMany({
      where: { id, orgId },
      data: { name: parsed.data.name, tier: parsed.data.tier },
    });

    if (result.count === 0)
      return { ok: false, error: "University not found." };

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (cause) {
    // The unique constraint on [orgId, name] is the likely failure here.
    console.error("[updateUniversityAction] failed", cause);
    return {
      ok: false,
      error: "Could not save. A university with that name may already exist.",
    };
  }
}

/**
 * Deletes a preference row.
 *
 * Job posts reference universities by id inside their `optionalCriteria` JSON,
 * which no foreign key protects. A deleted university therefore leaves stale
 * ids on any job post that selected it — harmless, because both the summary
 * panel and the scoring bonus resolve ids against the live table and simply
 * skip what no longer exists. The count is surfaced in the UI so the deletion
 * is an informed one.
 */
export async function deleteUniversityAction(
  id: string,
): Promise<UniversityActionResult> {
  const { orgId } = await requireOrgContext();

  try {
    await assertFeature(orgId, FEATURES.UNIVERSITY_PREFERENCES);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Feature not available.",
    };
  }

  if (typeof id !== "string" || id === "") {
    return { ok: false, error: "Missing university." };
  }

  try {
    const result = await prisma.universityPreference.deleteMany({
      where: { id, orgId },
    });

    if (result.count === 0)
      return { ok: false, error: "University not found." };

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (cause) {
    console.error("[deleteUniversityAction] failed", cause);
    return { ok: false, error: "Could not delete that university." };
  }
}

/** Create, for the standalone screen. Mirrors the in-form quick-add. */
export async function createUniversityAction(
  input: unknown,
): Promise<UniversityActionResult> {
  const { orgId } = await requireOrgContext();

  try {
    await assertFeature(orgId, FEATURES.UNIVERSITY_PREFERENCES);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Feature not available.",
    };
  }

  const parsed = universityPreferenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid university.",
    };
  }

  try {
    await prisma.universityPreference.upsert({
      where: { orgId_name: { orgId, name: parsed.data.name } },
      create: { orgId, name: parsed.data.name, tier: parsed.data.tier },
      update: { tier: parsed.data.tier },
    });

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (cause) {
    console.error("[createUniversityAction] failed", cause);
    return { ok: false, error: "Could not add that university." };
  }
}
