"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import { parseLanguage } from "@/lib/languages";
import { setPreferredLanguage } from "@/lib/preferences";

export type ProfileActionResult = { ok: true } | { ok: false; error: string };

/**
 * Saves the signed-in account's interface language.
 *
 * The user id comes from the session, never from the submitted payload — the
 * only thing the client is allowed to choose here is the language itself.
 */
export async function updatePreferredLanguageAction(
  input: unknown,
): Promise<ProfileActionResult> {
  const { clerkUserId } = await requireOrgContext();

  const language = parseLanguage(input);
  if (!language) {
    return { ok: false, error: "Pick one of the available languages." };
  }

  try {
    await setPreferredLanguage(clerkUserId, language);
    revalidatePath("/dashboard/profile");
    return { ok: true };
  } catch (cause) {
    console.error("[updatePreferredLanguageAction] failed", cause);
    return { ok: false, error: "Could not save your language." };
  }
}
