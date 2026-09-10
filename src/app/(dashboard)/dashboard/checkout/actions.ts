"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getCurrentMember,
  permissionError,
  requireOrgContext,
} from "@/lib/auth";
import { createCheckoutSession } from "@/lib/billing-checkout";
import { getOrgSettings } from "@/lib/org";
import { PERMISSIONS } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { PENDING_PLAN_COOKIE, decodePendingPlan } from "@/lib/pending-plan";
import { isStripeConfigured } from "@/lib/stripe";

/**
 * Resumes a purchase that began on the public pricing page.
 *
 * Both actions live here rather than in `settings/billing.actions.ts` because
 * only these two touch the pending-plan cookie, and a cookie write is the one
 * thing a page render cannot do — which is why the confirm screen is a page
 * that reads and an action that writes.
 */

export type CheckoutConfirmResult = { ok: false; error: string };

export async function confirmPendingCheckoutAction(): Promise<CheckoutConfirmResult> {
  const context = await requireOrgContext();

  // Admin-only, like every other billing entry point. `discardPendingCheckoutAction`
  // below is deliberately NOT gated: a recruiter who lands here from the pricing
  // page still needs a way out of the screen.
  const denied = await permissionError(context, PERMISSIONS.BILLING_MANAGE);
  if (denied) return denied;

  const store = await cookies();

  // Re-read and re-validate rather than trusting anything the client sent: the
  // cookie is the only input, and `decodePendingPlan` rejects a tier that has
  // no Stripe price behind it.
  const pending = decodePendingPlan(store.get(PENDING_PLAN_COOKIE)?.value);

  if (!pending) {
    return {
      ok: false,
      error: "That plan selection has expired. Choose a plan again.",
    };
  }

  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing is not fully configured yet." };
  }

  const [org, member] = await Promise.all([
    getOrgSettings(context.orgId),
    getCurrentMember(context),
  ]);

  if (!org) return { ok: false, error: "Organization not found." };

  let url: string;
  try {
    url = await createCheckoutSession({
      orgId: context.orgId,
      orgName: org.name,
      email: member?.email ?? null,
      tier: pending.tier,
      interval: pending.interval,
    });
  } catch (cause) {
    console.error("[confirmPendingCheckoutAction] failed", cause);
    // The cookie is deliberately left in place so the retry still knows what
    // they were buying.
    return {
      ok: false,
      error: `Could not start checkout for ${PLANS[pending.tier].label}. Try again in a moment.`,
    };
  }

  // Cleared before the redirect, not after: `redirect()` throws, so anything
  // below it never runs. Leaving the cookie set would bounce them back to this
  // screen every time they returned to the dashboard.
  store.delete(PENDING_PLAN_COOKIE);

  redirect(url);
}

/**
 * Abandons the pending purchase and hands them to the normal billing UI.
 *
 * Needed as an explicit exit: `/dashboard` redirects here while the cookie is
 * set, so without a way to clear it a visitor who changed their mind would be
 * sent back to this screen on every visit until it expired.
 */
export async function discardPendingCheckoutAction(): Promise<never> {
  await requireOrgContext();

  const store = await cookies();
  store.delete(PENDING_PLAN_COOKIE);

  redirect("/dashboard/settings");
}
