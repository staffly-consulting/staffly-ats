"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@clerk/nextjs/server";

import { SELF_SERVE_TIERS } from "@/lib/plans";
import {
  PENDING_PLAN_COOKIE,
  PENDING_PLAN_COOKIE_OPTIONS,
  encodePendingPlan,
} from "@/lib/pending-plan";
import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * Entry point from the public pricing page.
 *
 * Records the choice and sends the visitor to the right next step. It stops
 * short of creating a Checkout session, because Checkout needs an organization
 * and a signed-out visitor has neither that nor an account — everything from
 * here on is `/dashboard/checkout`'s job.
 *
 * Like the billing actions, this only returns on failure: success redirects.
 */

export type SelectPlanResult = { ok: false; error: string };

export async function selectPlanAction(
  tierInput: unknown,
  intervalInput: unknown,
): Promise<SelectPlanResult> {
  const tier =
    typeof tierInput === "string" &&
    (SELF_SERVE_TIERS as string[]).includes(tierInput)
      ? (tierInput as PlanTier)
      : null;

  if (!tier) return { ok: false, error: "Pick one of the available plans." };

  const interval: BillingInterval | null =
    intervalInput === "MONTHLY" || intervalInput === "ANNUAL"
      ? intervalInput
      : null;

  if (!interval) return { ok: false, error: "Pick a billing interval." };

  const store = await cookies();
  store.set(
    PENDING_PLAN_COOKIE,
    encodePendingPlan({ tier, interval }),
    PENDING_PLAN_COOKIE_OPTIONS,
  );

  // Signed out means "new user": send them to sign-UP, not sign-in. Clerk's
  // fallback redirect lands them on /dashboard, which picks the cookie up.
  const { userId } = await auth();
  redirect(userId ? "/dashboard/checkout" : "/sign-up");
}
