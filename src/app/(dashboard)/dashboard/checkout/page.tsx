import type { Metadata } from "next";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { TriangleAlert } from "lucide-react";

import { CheckoutConfirm } from "@/components/dashboard/checkout-confirm";
import { PageHeader } from "@/components/dashboard/page-header";
import { PlanFacts, PlanPrice } from "@/components/pricing/plan-presentation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgContext } from "@/lib/auth";
import { getOrgBilling } from "@/lib/entitlements";
import { PLANS, TRIAL_PERIOD_DAYS, isTrialEligible } from "@/lib/plans";
import { PENDING_PLAN_COOKIE, decodePendingPlan } from "@/lib/pending-plan";
import { isStripeConfigured } from "@/lib/stripe";

export const metadata: Metadata = { title: "Checkout" };

// Reads a cookie and the session: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * Where a purchase started on /pricing lands once the buyer has an account.
 *
 * This screen exists because of the gap between choosing a plan and being able
 * to pay for one: Checkout needs an organization, and a visitor who clicked
 * "Get started" has to sign up and create one first. Rather than drop them on
 * the dashboard and hope they find Settings, `/dashboard/page.tsx` sends them
 * here while the pending-plan cookie is set.
 *
 * It confirms rather than charging on arrival. A redirect straight to Stripe
 * would work, but a buyer arriving from three redirects deep deserves to see
 * what they are about to pay before a payment form appears — and it gives them
 * a way out that clears the cookie.
 *
 * `requireOrgContext()` does the heavy lifting for the awkward case: a brand new
 * user with no organization is sent to `/dashboard/select-org`, and because the
 * intent lives in a cookie rather than the URL, it is still here when they come
 * back.
 */
export default async function CheckoutPage() {
  const { orgId } = await requireOrgContext();

  const store = await cookies();
  const pending = decodePendingPlan(store.get(PENDING_PLAN_COOKIE)?.value);

  // Nothing pending — either it expired or they navigated here directly. The
  // normal billing UI is the right place for them, not an empty screen.
  if (!pending) redirect("/dashboard/settings");

  const plan = PLANS[pending.tier];
  const configured = isStripeConfigured();

  // Read rather than assumed. Arriving here from /pricing usually means a first
  // purchase, but an existing customer can reach the same screen, and promising
  // them a trial the Checkout session will not grant is worse than not
  // mentioning one. Same predicate `createCheckoutSession` uses.
  const billing = await getOrgBilling(orgId);
  const withTrial =
    billing !== null &&
    billing.requiresSubscription &&
    isTrialEligible(billing);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Confirm your plan"
        description={
          withTrial
            ? `You picked this before signing up. Your first ${TRIAL_PERIOD_DAYS} days are free.`
            : "You picked this before signing up. Nothing has been charged yet."
        }
      />

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{plan.label}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  {pending.interval === "ANNUAL" ? "Annual" : "Monthly"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Billed {pending.interval === "ANNUAL" ? "yearly" : "monthly"}
                {pending.interval === "ANNUAL"
                  ? " · applications still pool monthly, and overage is invoiced monthly"
                  : null}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <PlanPrice
                tier={pending.tier}
                interval={pending.interval}
                size="lg"
              />
            </div>
          </div>

          <PlanFacts tier={pending.tier} variant="list" />

          {configured ? (
            <CheckoutConfirm planLabel={plan.label} />
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Checkout is not connected yet, so this plan cannot be purchased.
                Nothing has been charged — your selection is saved for when
                billing is configured.
              </span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {withTrial ? (
              <>
                Stripe will ask for a card so the plan continues without
                interruption, but nothing is charged for {TRIAL_PERIOD_DAYS}{" "}
                days. Cancel before then from Settings and you pay nothing —
                applications received during the trial never incur overage.
              </>
            ) : (
              <>
                Payment is taken by Stripe. You can cancel at any time from
                Settings and keep access until the end of the period you have
                paid for.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
