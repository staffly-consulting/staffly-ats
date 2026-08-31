"use server";

import { requireOrgContext } from "@/lib/auth";
import { assertFeature } from "@/lib/entitlements";
import { FEATURES } from "@/lib/plans";
import {
  createUniversityPreference,
  type UniversityOption,
} from "@/lib/universities";
import { universityPreferenceSchema } from "@/lib/validations/job-post";

export type CreateUniversityResult =
  { ok: true; university: UniversityOption } | { ok: false; error: string };

/**
 * Quick-add used by the university combobox, so a recruiter can add a school
 * mid-form without losing everything they have typed.
 *
 * A server action rather than a route handler: there is no payload to speak of
 * and the caller wants the created row back to select immediately.
 */
export async function createUniversityPreferenceAction(
  input: unknown,
): Promise<CreateUniversityResult> {
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
    const university = await createUniversityPreference(
      orgId,
      parsed.data.name,
      parsed.data.tier,
    );
    return { ok: true, university };
  } catch (cause) {
    console.error("[createUniversityPreferenceAction] failed", cause);
    return { ok: false, error: "Could not save that university." };
  }
}
