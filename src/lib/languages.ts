import type { Language } from "@prisma/client";

/**
 * Interface languages.
 *
 * To add one: add a member to the `Language` enum in `prisma/schema.prisma`,
 * migrate, and add an entry here. The `Record<Language, …>` below will fail to
 * compile until you do, which is the point.
 */

export interface LanguageDefinition {
  code: Language;
  /** How the language names itself. What a speaker looks for in a list. */
  nativeName: string;
  /** English name, shown alongside so an admin can read the list too. */
  englishName: string;
  /** BCP 47 tag, for `Intl` formatting once dates and numbers are localised. */
  locale: string;
}

export const LANGUAGES: Record<Language, LanguageDefinition> = {
  EN: {
    code: "EN",
    nativeName: "English",
    englishName: "English",
    locale: "en-GB",
  },
  TH: {
    code: "TH",
    nativeName: "ไทย",
    englishName: "Thai",
    locale: "th-TH",
  },
};

/** Display order for the dropdown. */
export const LANGUAGE_ORDER: Language[] = ["EN", "TH"];

export const DEFAULT_LANGUAGE: Language = "EN";

/**
 * Narrows an untrusted string to a `Language`.
 *
 * The value arrives from a form submission, so it is not to be trusted even
 * though the UI only ever offers two options.
 */
export function parseLanguage(value: unknown): Language | null {
  return typeof value === "string" && value in LANGUAGES
    ? (value as Language)
    : null;
}

export function languageLabel(code: Language): string {
  const language = LANGUAGES[code];
  return language.nativeName === language.englishName
    ? language.nativeName
    : `${language.nativeName} (${language.englishName})`;
}

export function localeFor(code: Language): string {
  return LANGUAGES[code].locale;
}
