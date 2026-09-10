"use client";

import { useState, useTransition } from "react";

import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { selectPlanAction } from "@/app/pricing/actions";
import {
  IntervalToggle,
  PlanFacts,
  PlanPrice,
  isCustomPriced,
} from "@/components/pricing/plan-presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PLANS,
  PLAN_ORDER,
  TRIAL_PERIOD_DAYS,
  annualSavingPercent,
} from "@/lib/plans";
import { cn } from "@/lib/utils";
import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * The public plan grid.
 *
 * Every self-serve tier is a real buy button: it records the choice and sends
 * the visitor into sign-up, so a first-time buyer never has to find their way
 * to Settings to discover a "Choose a plan" dialog. Enterprise is the one card
 * that is not a purchase, because there is no Stripe price behind it.
 */

/** Drawn larger, with the badge. A marketing decision, not an entitlement one. */
const HIGHLIGHTED_TIER: PlanTier = "PIPELINE";

export function PricingPlans({ salesEmail }: { salesEmail: string | null }) {
  const [interval, setInterval] = useState<BillingInterval>("MONTHLY");
  const [chosen, setChosen] = useState<PlanTier | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(tier: PlanTier) {
    setChosen(tier);
    startTransition(async () => {
      // Only returns on failure; success redirects to sign-up or checkout.
      const result = await selectPlanAction(tier, interval);
      if (result && !result.ok) {
        toast.error(result.error);
        setChosen(null);
      }
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-3">
        <IntervalToggle
          value={interval}
          onChange={setInterval}
          savingForTier={HIGHLIGHTED_TIER}
        />
        <p className="text-xs text-muted-foreground">
          Applications pool monthly on every plan, whichever interval you pay
          on. Unused ones do not carry over.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {PLAN_ORDER.map((tier) => {
          const plan = PLANS[tier];
          const custom = isCustomPriced(tier);
          const highlighted = tier === HIGHLIGHTED_TIER;
          const saving = annualSavingPercent(tier);

          return (
            <div
              key={tier}
              className={cn(
                "flex flex-col rounded-xl border bg-card p-5 shadow-xs",
                highlighted
                  ? "border-brand/40 ring-1 ring-brand/20"
                  : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{plan.label}</h2>
                {highlighted ? (
                  <Badge
                    variant="outline"
                    className="border-brand/25 bg-brand/10 text-brand"
                  >
                    Most popular
                  </Badge>
                ) : null}
              </div>

              <div className="mt-4">
                <PlanPrice tier={tier} interval={interval} size="lg" />
                {/* Only shown where it is true: the monthly column has no
                    saving to quote, and Enterprise has no list price. */}
                {interval === "ANNUAL" && !custom && saving > 0 ? (
                  <p className="mt-1 text-xs text-success">
                    saves {saving}% against monthly
                  </p>
                ) : null}
              </div>

              <div className="mt-5 flex-1">
                <PlanFacts tier={tier} variant="list" />
              </div>

              <div className="mt-6">
                {custom ? (
                  salesEmail ? (
                    <Button asChild variant="outline" className="w-full">
                      <a
                        href={`mailto:${salesEmail}?subject=${encodeURIComponent("Staffly ATS+ Enterprise enquiry")}`}
                      >
                        Contact sales
                      </a>
                    </Button>
                  ) : (
                    // No address configured — say so plainly rather than
                    // rendering a button that goes nowhere.
                    <p className="text-center text-xs text-muted-foreground">
                      Speak to your Staffly representative about Enterprise.
                    </p>
                  )
                ) : (
                  <>
                    <Button
                      className="w-full"
                      variant={highlighted ? "default" : "outline"}
                      onClick={() => choose(tier)}
                      disabled={pending}
                    >
                      {pending && chosen === tier ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          Start {TRIAL_PERIOD_DAYS}-day trial
                          <ArrowRight className="size-4" />
                        </>
                      )}
                    </Button>
                    {/* Said on the button's own card, not only in the footnote:
                        a card field appears at Stripe and a buyer who was not
                        told to expect one reads it as a bait and switch. */}
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Card required · not charged until day{" "}
                      {TRIAL_PERIOD_DAYS + 1}
                    </p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
        Every plan starts with {TRIAL_PERIOD_DAYS} days free. We take your card
        up front so the plan continues without interruption, and charge nothing
        until the trial ends — cancel before then and you pay nothing at all.
        Applications received during the trial never incur overage. Payment is
        handled by Stripe; we never see your card details.
      </p>
    </div>
  );
}
