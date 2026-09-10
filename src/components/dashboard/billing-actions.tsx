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
import {
  IntervalToggle,
  PlanFacts,
  PlanPrice,
} from "@/components/pricing/plan-presentation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PLANS, SELF_SERVE_TIERS, TRIAL_PERIOD_DAYS } from "@/lib/plans";
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
        <PlanFacts tier={tier} />
      </div>
      <div className="shrink-0 text-right">
        <PlanPrice tier={tier} interval={interval} />
      </div>
    </button>
  );
}

export function BillingActions({
  currentTier,
  hasSubscription,
  offerTrial,
  configured,
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: {
  currentTier: PlanTier;
  hasSubscription: boolean;
  /**
   * Whether this org's next Checkout actually carries the free trial. Resolved
   * on the server: it is not simply "has no subscription", because an org that
   * is exempt from the paywall has nothing to trial.
   */
  offerTrial: boolean;
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
            {offerTrial
              ? `Start ${TRIAL_PERIOD_DAYS}-day trial`
              : hasSubscription
                ? "Change plan"
                : "Choose a plan"}
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

          <IntervalToggle
            value={interval}
            onChange={setInterval}
            savingForTier="PIPELINE"
          />

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
            {/* Only offered where it is actually granted: the Checkout session
                carries a trial on an org's first subscription only, so an
                existing customer switching tier must not be promised one. */}
            {!offerTrial ? (
              <>
                You will be taken to Stripe to pay. Enterprise is sold
                separately — get in touch rather than buying here.
              </>
            ) : (
              <>
                Your first {TRIAL_PERIOD_DAYS} days are free. Stripe will ask
                for a card, but nothing is charged until the trial ends, and
                applications received during it never incur overage. Enterprise
                is sold separately — get in touch rather than buying here.
              </>
            )}
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
              <Button variant="destructive" onClick={cancel} disabled={pending}>
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
