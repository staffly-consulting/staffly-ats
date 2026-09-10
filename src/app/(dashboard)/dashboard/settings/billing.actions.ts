"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getCurrentMember,
  permissionError,
  requireOrgContext,
} from "@/lib/auth";
import {
  cancelSubscription,
  createCheckoutSession,
  createPortalSession,
  resumeSubscription,
} from "@/lib/billing-checkout";
import { getOrgSettings } from "@/lib/org";
import { PERMISSIONS } from "@/lib/permissions";
import { PLANS, SELF_SERVE_TIERS } from "@/lib/plans";
import { isStripeConfigured } from "@/lib/stripe";
import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * Checkout and Billing Portal entry points.
 *
 * Both redirect to stripe.com on success, so neither returns a URL to the
 * client: handing a checkout URL back and letting the browser navigate would
 * expose it to anything that can read the response. `redirect()` throws, which
 * is why the error paths all return before it.
 */

export type BillingActionResult = { ok: false; error: string };

function parseTier(value: unknown): PlanTier | null {
  return typeof value === "string" &&
    (SELF_SERVE_TIERS as string[]).includes(value)
    ? (value as PlanTier)
    : null;
}

function parseInterval(value: unknown): BillingInterval | null {
  return value === "MONTHLY" || value === "ANNUAL" ? value : null;
}

export async function startCheckoutAction(
  tierInput: unknown,
  intervalInput: unknown,
): Promise<BillingActionResult> {
  const context = await requireOrgContext();

  const denied = await permissionError(context, PERMISSIONS.BILLING_MANAGE);
  if (denied) return denied;

  // The all-or-nothing gate. A Checkout that works while the webhook secret is
  // missing would charge a customer whose plan then never upgrades — worse than
  // refusing to sell.
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing is not fully configured yet." };
  }

  const tier = parseTier(tierInput);
  if (!tier) return { ok: false, error: "Pick one of the available plans." };

  const interval = parseInterval(intervalInput);
  if (!interval) return { ok: false, error: "Pick a billing interval." };

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
      tier,
      interval,
    });
  } catch (cause) {
    console.error("[startCheckoutAction] failed", cause);
    return {
      ok: false,
      error: `Could not start checkout for ${PLANS[tier].label}. Try again in a moment.`,
    };
  }

  redirect(url);
}

/**
 * Schedules cancellation at the end of the paid term.
 *
 * Unlike the two above, this does NOT redirect — it returns, so the page can
 * re-render with "access ends on…" without a round trip to Stripe's UI.
 */
export async function cancelSubscriptionAction(): Promise<
  { ok: true; endsAt: string } | { ok: false; error: string }
> {
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.BILLING_MANAGE);
  if (denied) return denied;

  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing is not fully configured yet." };
  }

  try {
    const { endsAt } = await cancelSubscription(orgId);
    revalidatePath("/dashboard/settings");
    return { ok: true, endsAt: endsAt.toISOString() };
  } catch (cause) {
    console.error("[cancelSubscriptionAction] failed", cause);
    return {
      ok: false,
      error:
        cause instanceof Error && cause.message.includes("no subscription")
          ? "There is no active subscription to cancel."
          : "Could not cancel. Try again in a moment.",
    };
  }
}

export async function resumeSubscriptionAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.BILLING_MANAGE);
  if (denied) return denied;

  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing is not fully configured yet." };
  }

  try {
    await resumeSubscription(orgId);
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (cause) {
    console.error("[resumeSubscriptionAction] failed", cause);
    return { ok: false, error: "Could not resume. Try again in a moment." };
  }
}

export async function openBillingPortalAction(): Promise<BillingActionResult> {
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.BILLING_MANAGE);
  if (denied) return denied;

  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing is not fully configured yet." };
  }

  let url: string;
  try {
    url = await createPortalSession(orgId);
  } catch (cause) {
    console.error("[openBillingPortalAction] failed", cause);
    return {
      ok: false,
      error:
        cause instanceof Error && cause.message.includes("no billing account")
          ? "No billing account yet — choose a plan first."
          : "Could not open the billing portal. Try again in a moment.",
    };
  }

  redirect(url);
}
