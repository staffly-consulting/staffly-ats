import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LANGUAGE, LANGUAGES, localeFor } from "@/lib/languages";
import { resolveRequestLanguage } from "@/lib/preferences";

/**
 * Resolves the language for every server-rendered request.
 *
 * There is no `[locale]` URL segment and no locale middleware, deliberately: the
 * preference belongs to the ACCOUNT, not the URL. A recruiter who set Thai sees
 * Thai on every link anyone sends them, and there is no `/th/...` universe of
 * duplicate URLs to keep in step.
 *
 * The cost is that language cannot be resolved statically — which is fine,
 * because every dashboard page is already `force-dynamic` for tenant scoping.
 *
 * Falls back to English whenever there is no signed-in user (marketing page,
 * sign-in) or the lookup fails. A failed preference read must never blank a
 * page; the worst outcome is English.
 */
export default getRequestConfig(async () => {
  const language = await resolveRequestLanguage();

  return {
    locale: localeFor(language),
    // next-intl keys messages by the BCP 47 locale, but our files are named by
    // the enum member, so the two are mapped explicitly rather than assumed to
    // be the same string.
    messages: (await import(`../../messages/${language.toLowerCase()}.json`))
      .default,
    // Everything in the app is stored and compared in UTC (see formatDate), so
    // pinning it here keeps a Thai and an English user looking at the same date
    // for the same candidate.
    timeZone: "UTC",
    onError(error) {
      // A missing key should show the key, not crash the page. Logged so gaps
      // in the Thai file surface in development instead of silently rendering
      // English-looking identifiers to a customer.
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[i18n] ${error.message}`);
      }
    },
    getMessageFallback({ namespace, key }) {
      const path = [namespace, key].filter(Boolean).join(".");
      return process.env.NODE_ENV === "production" ? "" : `[${path}]`;
    },
  };
});

/** Re-exported so callers do not need two imports to know the fallback. */
export { DEFAULT_LANGUAGE, LANGUAGES };
