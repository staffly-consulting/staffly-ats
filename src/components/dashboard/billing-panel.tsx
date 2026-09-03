import { Check, CreditCard, Lock, TriangleAlert } from "lucide-react";

import { BillingActions } from "@/components/dashboard/billing-actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { OrgBilling } from "@/lib/entitlements";
import {
  FEATURES,
  FEATURE_LABELS,
  PLANS,
  hasFeature,
  nextPoolReset,
  requiredTierFor,
  subscriptionIsActive,
  type Feature,
} from "@/lib/plans";
import { cn, formatDate } from "@/lib/utils";

/**
 * Plan, usage against the monthly pool, and what is locked.
 *
 * Checkout and the Billing Portal live in `BillingActions` below, which gates
 * itself on whether Stripe is fully configured rather than assuming it is.
 */

function statusTone(status: string | null): {
  label: string;
  className: string;
} {
  if (!status) {
    return {
      label: "No subscription",
      className: "bg-muted text-muted-foreground border-border",
    };
  }
  if (status === "active" || status === "trialing") {
    return {
      label: status === "trialing" ? "Trialing" : "Active",
      className: "border-success/25 bg-success/12 text-success",
    };
  }
  if (status === "past_due" || status === "incomplete") {
    return {
      label: status === "past_due" ? "Payment failed" : "Incomplete",
      className: "border-danger/25 bg-danger/10 text-danger",
    };
  }
  return {
    label: status.replace(/_/g, " "),
    className: "bg-muted text-muted-foreground border-border",
  };
}

export function BillingPanel({
  billing,
  stripeConfigured,
}: {
  billing: OrgBilling;
  /** Resolved on the server — `isStripeConfigured()` cannot run in the browser. */
  stripeConfigured: boolean;
}) {
  const plan = PLANS[billing.planTier];
  const { quota } = billing;
  const status = statusTone(billing.stripeSubscriptionStatus);
  const active = subscriptionIsActive(billing);

  const features = Object.values(FEATURES) as Feature[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4 text-brand" />
          Plan and usage
        </CardTitle>
        <CardDescription>
          Applications pool monthly, regardless of whether you are billed
          monthly or yearly.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{plan.label}</span>
            {billing.billingInterval ? (
              <Badge variant="outline" className="text-muted-foreground">
                {billing.billingInterval === "ANNUAL" ? "Annual" : "Monthly"}
              </Badge>
            ) : null}
          </div>
          <Badge variant="outline" className={status.className}>
            {status.label}
          </Badge>
        </div>

        {/* The same date means opposite things depending on whether the
            customer has cancelled, so the label carries the meaning. */}
        {billing.currentPeriodEnd ? (
          <p className="-mt-3 text-xs text-muted-foreground">
            {billing.cancelAtPeriodEnd ? (
              <>
                Cancelled — access ends{" "}
                <span className="font-medium text-foreground">
                  {formatDate(billing.currentPeriodEnd)}
                </span>
              </>
            ) : (
              <>
                Renews{" "}
                <span className="font-medium text-foreground">
                  {formatDate(billing.currentPeriodEnd)}
                </span>
                {billing.billingInterval === "ANNUAL"
                  ? " · overage is billed monthly"
                  : null}
              </>
            )}
          </p>
        ) : null}

        {!active ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This subscription is no longer active, so paid features are
              locked. Existing candidates and job posts are untouched.
            </span>
          </div>
        ) : null}

        {/* Usage ------------------------------------------------------- */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Applications this month
            </span>
            <span className="tabular-nums">
              <span className="font-medium">{quota.used.toLocaleString()}</span>
              <span className="text-muted-foreground">
                {" / "}
                {billing.planTier === "ENTERPRISE"
                  ? "unlimited"
                  : quota.included.toLocaleString()}
              </span>
            </span>
          </div>

          {billing.planTier === "ENTERPRISE" ? null : (
            <Progress
              value={Math.round(quota.fraction * 100)}
              className={cn(
                "h-2",
                quota.isOverQuota
                  ? "[&>*]:bg-warning"
                  : quota.fraction > 0.8
                    ? "[&>*]:bg-warning"
                    : "[&>*]:bg-success",
              )}
            />
          )}

          {quota.isOverQuota ? (
            <p className="text-xs text-warning">
              {quota.overage.toLocaleString()} over the included pool ·
              approximately{" "}
              <span className="font-medium tabular-nums">
                ${quota.overageCostUsd.toFixed(2)}
              </span>{" "}
              in overage at ${plan.overagePerApplication.toFixed(2)} per
              application
            </p>
          ) : null}

          {billing.poolCycleAnchor ? (
            <p className="text-xs text-muted-foreground">
              Pool resets {formatDate(
                nextPoolReset(new Date(billing.poolCycleAnchor)).toISOString(),
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The pool month starts when a subscription begins.
            </p>
          )}
        </div>

        <Separator />

        {/* Entitlements ------------------------------------------------ */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Included in {plan.label}
          </h4>
          <ul className="space-y-1.5">
            {features.map((feature) => {
              const unlocked = hasFeature(billing, feature);
              const needed = requiredTierFor(feature);
              return (
                <li key={feature} className="flex items-center gap-2 text-sm">
                  {unlocked ? (
                    <Check className="size-3.5 shrink-0 text-success" />
                  ) : (
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={unlocked ? "" : "text-muted-foreground"}>
                    {FEATURE_LABELS[feature]}
                  </span>
                  {!unlocked ? (
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] font-normal text-muted-foreground"
                    >
                      {needed.label}+
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <Separator />

        <BillingActions
          currentTier={billing.planTier}
          hasSubscription={billing.stripeSubscriptionId !== null}
          configured={stripeConfigured}
          cancelAtPeriodEnd={billing.cancelAtPeriodEnd}
          currentPeriodEnd={billing.currentPeriodEnd}
        />
      </CardContent>
    </Card>
  );
}
