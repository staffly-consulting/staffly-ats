import "server-only";

import Stripe from "stripe";

/**
 * Stripe client and configuration.
 *
 * Nothing here has a fallback. A missing price id or meter name is a
 * misconfiguration that would otherwise surface as a customer on the wrong plan
 * or an unbilled account, so every getter throws with the name of the variable
 * that is absent.
 *
 * The one deliberate exception is `isStripeConfigured()`: billing is not live
 * yet, and background jobs need to distinguish "not set up" (skip quietly) from
 * "set up and broken" (retry loudly).
 */

export const STRIPE_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_SHORTLIST_MONTHLY",
  "STRIPE_PRICE_SHORTLIST_ANNUAL",
  "STRIPE_PRICE_PIPELINE_MONTHLY",
  "STRIPE_PRICE_PIPELINE_ANNUAL",
  "STRIPE_PRICE_TALENT_POOL_MONTHLY",
  "STRIPE_PRICE_TALENT_POOL_ANNUAL",
  "STRIPE_PRICE_SHORTLIST_OVERAGE",
  "STRIPE_PRICE_PIPELINE_OVERAGE",
  "STRIPE_PRICE_TALENT_POOL_OVERAGE",
  "STRIPE_METER_EVENT_NAME",
] as const;

export type StripeEnvKey = (typeof STRIPE_ENV_KEYS)[number];

/** Every required variable that is absent or empty. */
export function missingStripeEnv(): StripeEnvKey[] {
  return STRIPE_ENV_KEYS.filter((key) => {
    const value = process.env[key];
    return value === undefined || value.trim() === "";
  });
}

/**
 * True only when the whole billing configuration is present.
 *
 * Deliberately all-or-nothing: a half-configured Stripe is worse than none,
 * because some orgs would be charged and others silently not.
 */
export function isStripeConfigured(): boolean {
  return missingStripeEnv().length === 0;
}

function required(key: StripeEnvKey): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing ${key}. Stripe billing cannot run without it — see the Billing section of the README.`,
    );
  }
  return value.trim();
}

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  cached = new Stripe(required("STRIPE_SECRET_KEY"), {
    // Retries are Inngest's job here, not the SDK's — a duplicated meter event
    // is double-billed revenue, so a retry has to be a deliberate decision made
    // where the ledger can be consulted.
    maxNetworkRetries: 0,
    timeout: 20_000,
  });
  return cached;
}

export function meterEventName(): string {
  return required("STRIPE_METER_EVENT_NAME");
}

export function webhookSecret(): string {
  return required("STRIPE_WEBHOOK_SECRET");
}

/* -------------------------------------------------------------------------- */
/* Price lookup                                                                */
/* -------------------------------------------------------------------------- */

import type { BillingInterval, PlanTier } from "@prisma/client";

const FLAT_PRICE_KEYS: Record<
  Exclude<PlanTier, "ENTERPRISE">,
  Record<BillingInterval, StripeEnvKey>
> = {
  SHORTLIST: {
    MONTHLY: "STRIPE_PRICE_SHORTLIST_MONTHLY",
    ANNUAL: "STRIPE_PRICE_SHORTLIST_ANNUAL",
  },
  PIPELINE: {
    MONTHLY: "STRIPE_PRICE_PIPELINE_MONTHLY",
    ANNUAL: "STRIPE_PRICE_PIPELINE_ANNUAL",
  },
  TALENT_POOL: {
    MONTHLY: "STRIPE_PRICE_TALENT_POOL_MONTHLY",
    ANNUAL: "STRIPE_PRICE_TALENT_POOL_ANNUAL",
  },
};

const OVERAGE_PRICE_KEYS: Record<
  Exclude<PlanTier, "ENTERPRISE">,
  StripeEnvKey
> = {
  SHORTLIST: "STRIPE_PRICE_SHORTLIST_OVERAGE",
  PIPELINE: "STRIPE_PRICE_PIPELINE_OVERAGE",
  TALENT_POOL: "STRIPE_PRICE_TALENT_POOL_OVERAGE",
};

/** Enterprise is sales-led; there is no self-serve price for it. */
export function isSelfServeTier(
  tier: PlanTier,
): tier is Exclude<PlanTier, "ENTERPRISE"> {
  return tier !== "ENTERPRISE";
}

export function flatPriceId(tier: PlanTier, interval: BillingInterval): string {
  if (!isSelfServeTier(tier)) {
    throw new Error(`${tier} has no self-serve price; it is sold out of band.`);
  }
  return required(FLAT_PRICE_KEYS[tier][interval]);
}

export function overagePriceId(tier: PlanTier): string {
  if (!isSelfServeTier(tier)) {
    throw new Error(`${tier} has no metered overage price.`);
  }
  return required(OVERAGE_PRICE_KEYS[tier]);
}

/**
 * Reverse lookup: which tier/interval a Stripe Price id corresponds to.
 *
 * Needed by the `customer.subscription.updated` webhook, where a plan change
 * made in the Billing Portal arrives as a price id and nothing else.
 */
export function planFromPriceId(
  priceId: string,
): { tier: PlanTier; interval: BillingInterval } | null {
  for (const tier of Object.keys(FLAT_PRICE_KEYS) as Exclude<
    PlanTier,
    "ENTERPRISE"
  >[]) {
    for (const interval of ["MONTHLY", "ANNUAL"] as BillingInterval[]) {
      if (process.env[FLAT_PRICE_KEYS[tier][interval]] === priceId) {
        return { tier, interval };
      }
    }
  }
  return null;
}
