import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Dates are always formatted in UTC.
 *
 * Everything in the database is stored in UTC and the pool-reset cron compares
 * in UTC, so formatting in the viewer's zone would show two colleagues different
 * dates for the same candidate — and show a reset date that disagrees with the
 * job that performs it.
 *
 * The locale is passed in rather than read from a hook, because these are called
 * from server and client components alike. Both sides get it from next-intl's
 * provider, so server and client render identical strings and hydration matches.
 * The default keeps every existing call site correct.
 */
export const DEFAULT_LOCALE = "en-GB";

export function formatDate(
  iso: string | null | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function formatDateTime(
  iso: string | null | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Two-letter monogram for avatar fallbacks. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
