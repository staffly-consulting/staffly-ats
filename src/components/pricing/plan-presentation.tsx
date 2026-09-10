"use client";

import type { BillingInterval, PlanTier } from "@prisma/client";

import { PLANS, annualSavingPercent, priceFor } from "@/lib/plans";
import { cn, pluralize } from "@/lib/utils";

/**
 * One rendering of a plan's numbers, shared by the public pricing page and the
 * in-app "choose a plan" dialog.
 *
 * The point of the sharing is that the two cannot drift: a visitor who is
 * quoted $250 on /pricing and $250 in the dialog is looking at the same code
 * path, not two hand-maintained copies of the same table. `lib/plans.ts` stays
 * the source of truth for the values; this file is the source of truth for how
 * they are worded.
 */

/** ENTERPRISE's pool is a sentinel, not a number anyone should read. */
function isUnmetered(tier: PlanTier): boolean {
  return PLANS[tier].includedApplications === Number.MAX_SAFE_INTEGER;
}

/** True for tiers with no Checkout — priced by negotiation, not by this table. */
export function isCustomPriced(tier: PlanTier): boolean {
  return !PLANS[tier].selfServe;
}

export function PlanPrice({
  tier,
  interval,
  size = "sm",
}: {
  tier: PlanTier;
  interval: BillingInterval;
  size?: "sm" | "lg";
}) {
  const price = priceFor(tier, interval);

  if (isCustomPriced(tier)) {
    return (
      <div>
        <div
          className={cn(
            "font-semibold",
            size === "lg" ? "text-3xl" : "text-base",
          )}
        >
          Custom
        </div>
        <div className="text-xs text-muted-foreground">talk to us</div>
      </div>
    );
  }

  return (
    <div>
      <div
        className={cn(
          "font-semibold tabular-nums",
          size === "lg" ? "text-3xl" : "text-base",
        )}
      >
        ${price.toLocaleString()}
      </div>
      <div className="text-xs text-muted-foreground">
        {interval === "ANNUAL" ? "per year" : "per month"}
      </div>
    </div>
  );
}

/**
 * What the tier includes, in one place.
 *
 * `variant="line"` is the two-line summary the dialog rows use; `variant="list"`
 * is the ticked list the pricing page shows. Same facts either way.
 */
export function PlanFacts({
  tier,
  variant = "line",
}: {
  tier: PlanTier;
  variant?: "line" | "list";
}) {
  const plan = PLANS[tier];

  const applications = isUnmetered(tier)
    ? "Unlimited applications"
    : `${plan.includedApplications.toLocaleString()} applications per month`;

  const jobPosts =
    plan.jobPostLimit === null
      ? "Unlimited job posts"
      : `${plan.jobPostLimit} job ${pluralize(plan.jobPostLimit, "post")}`;

  const inboxes = `${plan.inboxLimit} connected ${pluralize(plan.inboxLimit, "inbox", "inboxes")}`;

  // Not read from PLANS, because there is no seat field to read: seats are
  // unlimited on every tier by design, not by a limit that happens to be high.
  // The reasoning is recorded in `lib/plans.ts` — the application meter already
  // prices team size, since bigger teams ingest more, so charging per seat
  // would bill the same growth twice.
  const seats = "Unlimited team members";

  // Enterprise carries no per-application rate; rendering "$0.00 per
  // application" would read as a promise nobody made.
  const overage = isCustomPriced(tier)
    ? null
    : `$${plan.overagePerApplication.toFixed(2)} per application beyond the pool`;

  if (variant === "line") {
    return (
      <>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {applications} · {jobPosts.toLowerCase()}
        </p>
        {overage ? (
          <p className="text-xs text-muted-foreground">{overage}</p>
        ) : null}
      </>
    );
  }

  return (
    <ul className="space-y-1.5 text-sm text-muted-foreground">
      {[applications, jobPosts, inboxes, seats, overage]
        .filter((fact): fact is string => fact !== null)
        .map((fact) => (
          <li key={fact} className="flex gap-2">
            <span aria-hidden className="text-brand">
              ·
            </span>
            <span>{fact}</span>
          </li>
        ))}
    </ul>
  );
}

/**
 * Monthly / annual switch.
 *
 * The pill can only show one number, so it takes an explicit representative
 * tier rather than hardcoding one — the three self-serve discounts are within a
 * point of each other today, but nothing keeps them there, and each plan card
 * quotes its own saving from `annualSavingPercent` regardless.
 */
export function IntervalToggle({
  value,
  onChange,
  savingForTier,
  className,
}: {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  /** Whose discount to advertise on the Annual pill. */
  savingForTier?: PlanTier;
  className?: string;
}) {
  const saving = savingForTier ? annualSavingPercent(savingForTier) : 0;

  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-border p-0.5 text-sm",
        className,
      )}
      role="group"
      aria-label="Billing interval"
    >
      {(["MONTHLY", "ANNUAL"] as BillingInterval[]).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "rounded-md px-3 py-1.5 transition-colors",
            value === option
              ? "bg-brand text-brand-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option === "MONTHLY" ? "Monthly" : "Annual"}
          {option === "ANNUAL" && saving > 0 ? (
            <span className="ml-1.5 text-xs opacity-80">save {saving}%</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
