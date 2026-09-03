"use client";

import { useState, useTransition } from "react";

import { CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import {
  cancelSubscriptionAction,
  openBillingPortalAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from "@/app/(dashboard)/dashboard/settings/billing.actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PLANS,
  SELF_SERVE_TIERS,
  annualSavingPercent,
  priceFor,
} from "@/lib/plans";
import { cn, formatDate } from "@/lib/utils";
import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * Buy, and manage what has been bought.
 *
 * The server actions redirect to stripe.com, so a successful call never returns
 * — only failures come back, which is why every handler treats a returned value
 * as an error.
 */

function PlanOption({
  tier,
  interval,
  current,
  onChoose,
  disabled,
}: {
  tier: PlanTier;
  interval: BillingInterval;
  current: boolean;
  onChoose: (tier: PlanTier) => void;
  disabled: boolean;
}) {
  const plan = PLANS[tier];
  const price = priceFor(tier, interval);

  return (
    <button
      type="button"
      disabled={disabled || current}
      onClick={() => onChoose(tier)}
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        current
          ? "border-brand/40 bg-brand/5"
          : "border-border hover:border-brand/40 hover:bg-muted/50",
        disabled && !current && "pointer-events-none opacity-60",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {plan.label}
          {current ? (
            <span className="text-xs font-normal text-muted-foreground">
              current plan
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {plan.includedApplications.toLocaleString()} applications per month ·{" "}
          {plan.jobPostLimit === null
            ? "unlimited job posts"
            : `${plan.jobPostLimit} job posts`}
        </p>
        <p className="text-xs text-muted-foreground">
          ${plan.overagePerApplication.toFixed(2)} per application beyond the
          pool
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold tabular-nums">
          ${price.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">
          {interval === "ANNUAL" ? "per year" : "per month"}
        </div>
      </div>
    </button>
  );
}

export function BillingActions({
  currentTier,
  hasSubscription,
  configured,
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: {
  currentTier: PlanTier;
  hasSubscription: boolean;
  configured: boolean;
  cancelAtPeriodEnd: boolean;
  /** ISO, for the confirmation copy. */
  currentPeriodEnd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>("MONTHLY");
  const [pending, startTransition] = useTransition();

  const endsAtLabel = currentPeriodEnd ? formatDate(currentPeriodEnd) : null;

  if (!configured) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled>Change plan</Button>
        <Button variant="outline" disabled>
          Manage billing
        </Button>
        <p className="text-xs text-muted-foreground">
          Checkout is not connected yet — billing is not fully configured.
        </p>
      </div>
    );
  }

  function choose(tier: PlanTier) {
    startTransition(async () => {
      // Only returns on failure; success redirects to Stripe.
      const result = await startCheckoutAction(tier, interval);
      if (result && !result.ok) toast.error(result.error);
    });
  }

  function openPortal() {
    startTransition(async () => {
      const result = await openBillingPortalAction();
      if (result && !result.ok) toast.error(result.error);
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelSubscriptionAction();
      if (result.ok) {
        setConfirmCancel(false);
        toast.success(
          `Cancelled. You keep access until ${formatDate(result.endsAt)}.`,
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function resume() {
    startTransition(async () => {
      const result = await resumeSubscriptionAction();
      if (result.ok) {
        toast.success("Your subscription will continue as normal.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button disabled={pending}>
            <CreditCard className="size-4" />
            {hasSubscription ? "Change plan" : "Choose a plan"}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a plan</DialogTitle>
            <DialogDescription>
              Applications pool monthly on every plan, and unused ones do not
              carry over. Anything beyond the pool is billed at the end of each
              month.
            </DialogDescription>
          </DialogHeader>

          <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            {(["MONTHLY", "ANNUAL"] as BillingInterval[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setInterval(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  interval === value
                    ? "bg-brand text-brand-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "MONTHLY" ? "Monthly" : "Annual"}
                {value === "ANNUAL" ? (
                  <span className="ml-1.5 text-xs opacity-80">
                    save {annualSavingPercent("PIPELINE")}%
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {SELF_SERVE_TIERS.map((tier) => (
              <PlanOption
                key={tier}
                tier={tier}
                interval={interval}
                current={tier === currentTier && hasSubscription}
                onChoose={choose}
                disabled={pending}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            You will be taken to Stripe to pay. Enterprise is sold separately —
            get in touch rather than buying here.
          </p>
        </DialogContent>
      </Dialog>

      <Button
        variant="outline"
        onClick={openPortal}
        disabled={pending || !hasSubscription}
      >
        Invoices and payment
        <ExternalLink className="size-3.5" />
      </Button>

      {hasSubscription && cancelAtPeriodEnd ? (
        <Button variant="ghost" onClick={resume} disabled={pending}>
          Keep my subscription
        </Button>
      ) : null}

      {hasSubscription && !cancelAtPeriodEnd ? (
        <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              disabled={pending}
              className="text-muted-foreground hover:text-danger"
            >
              Cancel plan
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancel your plan?</DialogTitle>
              <DialogDescription>
                {/* States the date plainly. Cancelling stops the renewal — it
                    never cuts short a period already paid for. */}
                {endsAtLabel ? (
                  <>
                    You keep full access until{" "}
                    <strong className="font-medium text-foreground">
                      {endsAtLabel}
                    </strong>
                    , the end of the period you have already paid for. Nothing
                    is charged after that, and no refund is issued for the
                    remaining time.
                  </>
                ) : (
                  <>
                    You keep access until the end of the period you have already
                    paid for. Nothing is charged after that.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Any overage already used is still invoiced. You can undo this at
              any time before the date above.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmCancel(false)}
                disabled={pending}
              >
                Keep plan
              </Button>
              <Button
                variant="destructive"
                onClick={cancel}
                disabled={pending}
              >
                Cancel plan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {!hasSubscription ? (
        <p className="text-xs text-muted-foreground">
          Invoices and payment methods appear here once you subscribe.
        </p>
      ) : null}
    </div>
  );
}
