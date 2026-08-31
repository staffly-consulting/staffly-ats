import { Check, CreditCard, Lock, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  requiredTierFor,
  subscriptionIsActive,
  type Feature,
} from "@/lib/plans";
import { cn, formatDate } from "@/lib/utils";

/**
 * Plan, usage against the annual pool, and what is locked.
 *
 * Read-only in this pass. Checkout and the Billing Portal are the two actions
 * that belong here, and both need Stripe price ids that do not exist yet — so
 * the buttons are disabled with the reason stated rather than linking somewhere
 * that would throw.
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

export function BillingPanel({ billing }: { billing: OrgBilling }) {
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
          Applications pool annually, regardless of whether you are billed
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
              Applications this year
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
              Pool resets {formatDate(nextAnniversary(billing.poolCycleAnchor))}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The pool year starts when a subscription begins.
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

        <div className="flex flex-wrap items-center gap-2">
          {/* TODO(billing): enable once the Stripe prices exist. Checkout and
              Billing Portal are sections 2 and 4 of the billing spec, both
              blocked on price ids rather than on code. */}
          <Button disabled>Change plan</Button>
          <Button variant="outline" disabled>
            Manage billing
          </Button>
          <p className="text-xs text-muted-foreground">
            Checkout is not connected yet — Stripe is not configured.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** The pool anniversary that comes next, given the anchor. */
function nextAnniversary(anchorIso: string): string {
  const anchor = new Date(anchorIso);
  const next = new Date(anchor);
  next.setUTCFullYear(next.getUTCFullYear() + 1);

  const now = new Date();
  while (next <= now) {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  }
  return next.toISOString();
}
