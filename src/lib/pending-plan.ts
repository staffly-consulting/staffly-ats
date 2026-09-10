import { SELF_SERVE_TIERS } from "@/lib/plans";
import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * The plan a visitor picked before they had an account.
 *
 * Buying from the public pricing page means the choice has to survive Clerk
 * sign-up, email verification, and — for a brand new user — creating an
 * organization, because `/dashboard/select-org` stands between sign-up and any
 * org-scoped action. A `redirect_url` threaded through Clerk does not survive
 * that detour; a cookie does.
 *
 * Deliberately httpOnly and short-lived. It is not a credential — the tier is
 * re-validated server-side before Checkout, and `createCheckoutSession` prices
 * from Stripe, not from this value — but a stale intent that redirects someone
 * to a payment page weeks later is its own kind of bug, so it expires.
 *
 * This module stays pure (no `cookies()` call) so the checkout page can decode
 * and the server action can encode without either importing the other.
 */

export const PENDING_PLAN_COOKIE = "staffly_pending_plan";

/** Long enough to sign up and verify an email, short enough to not go stale. */
export const PENDING_PLAN_MAX_AGE_SECONDS = 30 * 60;

export interface PendingPlan {
  tier: PlanTier;
  interval: BillingInterval;
}

export function encodePendingPlan(plan: PendingPlan): string {
  return `${plan.tier}:${plan.interval}`;
}

/**
 * Parses the cookie back, returning null for anything unrecognised.
 *
 * Validates the tier against `SELF_SERVE_TIERS` rather than `PlanTier`, so a
 * hand-edited cookie naming ENTERPRISE cannot reach a Checkout that has no
 * price for it. Callers treat null as "no pending plan" — never as an error,
 * because an expired or absent cookie is the normal case.
 */
export function decodePendingPlan(
  raw: string | undefined | null,
): PendingPlan | null {
  if (!raw) return null;

  const [tier, interval] = raw.split(":");

  if (!tier || !(SELF_SERVE_TIERS as string[]).includes(tier)) return null;
  if (interval !== "MONTHLY" && interval !== "ANNUAL") return null;

  return { tier: tier as PlanTier, interval };
}

/** The options every write of this cookie must use, so they cannot drift. */
export const PENDING_PLAN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  // Sent cross-site on the return from Clerk's hosted pages, so `strict` would
  // drop it on exactly the navigation that matters.
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: PENDING_PLAN_MAX_AGE_SECONDS,
} as const;
