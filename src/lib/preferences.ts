import "server-only";

import { auth } from "@clerk/nextjs/server";

import type { Language } from "@prisma/client";

import { DEFAULT_LANGUAGE } from "@/lib/languages";
import { prisma } from "@/lib/prisma";

/**
 * Per-account preferences.
 *
 * Keyed on the user, NOT on `OrgMember`. Someone who belongs to three
 * organizations reads in the same language in all three — the preference
 * belongs to the person, not to their seat. That is also why nothing here takes
 * an `orgId`: this is the one table in the schema that is deliberately not
 * tenant-scoped.
 *
 * The row is created lazily. Most accounts never open the language dropdown, so
 * writing a row at sign-up would mean a table of rows that all say "EN".
 */

export interface UserPreferences {
  preferredLanguage: Language;
}

/**
 * The caller's preferences, with defaults for an account that has never saved
 * any. Never returns null: "no row" and "the default" are the same state.
 */
export async function getUserPreferences(
  clerkUserId: string,
): Promise<UserPreferences> {
  const row = await prisma.userPreference.findUnique({
    where: { clerkUserId },
    select: { preferredLanguage: true },
  });

  return { preferredLanguage: row?.preferredLanguage ?? DEFAULT_LANGUAGE };
}

/**
 * The language for the current request, for `i18n/request.ts`.
 *
 * Never throws and never redirects. It runs on EVERY server render, including
 * the marketing page and the sign-in screen where there is no session at all, so
 * "no user" is an ordinary outcome rather than an error. A database blip
 * likewise degrades to English instead of blanking the page.
 */
export async function resolveRequestLanguage(): Promise<Language> {
  try {
    const { userId } = await auth();
    if (!userId) return DEFAULT_LANGUAGE;

    const row = await prisma.userPreference.findUnique({
      where: { clerkUserId: userId },
      select: { preferredLanguage: true },
    });

    return row?.preferredLanguage ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Saves the caller's language.
 *
 * `clerkUserId` must come from the session — `requireOrgContext()` — and never
 * from a form field, or one account could rewrite another's preferences.
 */
export async function setPreferredLanguage(
  clerkUserId: string,
  preferredLanguage: Language,
): Promise<UserPreferences> {
  const row = await prisma.userPreference.upsert({
    where: { clerkUserId },
    create: { clerkUserId, preferredLanguage },
    update: { preferredLanguage },
    select: { preferredLanguage: true },
  });

  return { preferredLanguage: row.preferredLanguage };
}
