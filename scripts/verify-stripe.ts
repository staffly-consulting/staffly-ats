/**
 * Preflight for the billing configuration. Run: npm run verify:stripe
 *
 * Read-only: it retrieves, it never creates or modifies anything.
 *
 * `isStripeConfigured()` only checks that the environment variables are
 * non-empty, which is the right check for a runtime gate but says nothing about
 * whether the ids behind them are real, live-versus-test, or of the right
 * shape. A price id that exists but recurs yearly where the code expects
 * monthly produces a subscription that is wrong in a way no type checker can
 * see and no test without network access can catch.
 *
 * So this asks Stripe. Every failure below is one a customer would otherwise
 * discover at the payment form.
 */
import "dotenv/config";
import { config } from "dotenv";

import Stripe from "stripe";

import { PLANS, SELF_SERVE_TIERS } from "../src/lib/plans";
import { STRIPE_ENV_KEYS } from "../src/lib/stripe";
import type { BillingInterval, PlanTier } from "@prisma/client";

// prisma.config.ts loads .env.local for the CLI; plain `tsx` does not. Without
// this the whole preflight reports every variable as missing even when
// .env.local is complete — a false alarm that is indistinguishable from real
// misconfiguration, which is the opposite of what a preflight is for.
config({ path: ".env.local" });

let failures = 0;
let warnings = 0;

function ok(message: string) {
  console.log(`  ok   ${message}`);
}
function fail(message: string) {
  failures += 1;
  console.log(`  FAIL ${message}`);
}
function warn(message: string) {
  warnings += 1;
  console.log(`  warn ${message}`);
}

function envValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

async function main() {
  console.log("\n--- environment ---");

  const missing = STRIPE_ENV_KEYS.filter((key) => !envValue(key));
  for (const key of STRIPE_ENV_KEYS) {
    if (envValue(key)) ok(key);
    else fail(`${key} is missing or empty`);
  }

  const secret = envValue("STRIPE_SECRET_KEY");
  if (!secret) {
    console.log(
      "\nNo STRIPE_SECRET_KEY; cannot check anything against Stripe.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Test and live keys address different objects entirely. A price id from one
  // mode simply does not exist in the other, so knowing which mode we are in
  // makes every "no such price" below readable.
  const mode = secret.startsWith("sk_live") ? "LIVE" : "test";
  console.log(`\n--- prices (${mode} mode) ---`);

  const stripe = new Stripe(secret, { maxNetworkRetries: 1, timeout: 20_000 });

  /** The flat price for a tier and interval must recur on that interval. */
  const expectedInterval: Record<BillingInterval, "month" | "year"> = {
    MONTHLY: "month",
    ANNUAL: "year",
  };

  for (const tier of SELF_SERVE_TIERS) {
    for (const interval of ["MONTHLY", "ANNUAL"] as BillingInterval[]) {
      const key = `STRIPE_PRICE_${tier}_${interval}`;
      const id = envValue(key);
      if (!id) continue;

      try {
        const price = await stripe.prices.retrieve(id);
        const label = `${PLANS[tier].label} ${interval.toLowerCase()}`;

        if (!price.active) fail(`${label}: price ${id} is ARCHIVED in Stripe`);
        else if (price.recurring?.interval !== expectedInterval[interval]) {
          fail(
            `${label}: recurs ${price.recurring?.interval ?? "never"}, expected ${expectedInterval[interval]}`,
          );
        } else if (price.recurring?.usage_type === "metered") {
          fail(`${label}: is METERED, but this is the flat plan price`);
        } else {
          // Display-only in `lib/plans.ts`, but a mismatch means the pricing
          // page is quoting a number Stripe will not charge.
          const shown =
            interval === "ANNUAL"
              ? PLANS[tier].annualPrice
              : PLANS[tier].monthlyPrice;
          const actual = (price.unit_amount ?? 0) / 100;
          if (actual !== shown) {
            warn(
              `${label}: Stripe charges ${price.currency.toUpperCase()} ${actual}, the pricing page shows $${shown}`,
            );
          } else {
            ok(`${label}: $${actual} / ${price.recurring?.interval}`);
          }
        }
      } catch (cause) {
        fail(
          `${key}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }

  console.log("\n--- metered overage prices ---");

  const meterName = envValue("STRIPE_METER_EVENT_NAME");

  for (const tier of SELF_SERVE_TIERS as PlanTier[]) {
    const key = `STRIPE_PRICE_${tier}_OVERAGE`;
    const id = envValue(key);
    if (!id) continue;

    try {
      const price = await stripe.prices.retrieve(id);
      const label = `${PLANS[tier].label} overage`;

      if (!price.active) {
        fail(`${label}: price ${id} is ARCHIVED in Stripe`);
      } else if (price.recurring?.usage_type !== "metered") {
        fail(`${label}: is NOT metered — usage would never be billed`);
      } else if (price.recurring?.interval !== "month") {
        // The whole annual design depends on this: overage invoices monthly
        // even on a yearly plan, so it cannot accrue uninvoiced for a year.
        fail(
          `${label}: recurs ${price.recurring?.interval}, overage must be MONTHLY on every tier`,
        );
      } else {
        ok(`${label}: metered, monthly`);
      }
    } catch (cause) {
      fail(`${key}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  console.log("\n--- meter ---");
  if (!meterName) {
    fail("STRIPE_METER_EVENT_NAME is not set");
  } else {
    try {
      const meters = await stripe.billing.meters.list({ limit: 100 });
      const match = meters.data.find(
        (meter) => meter.event_name === meterName && meter.status === "active",
      );
      if (match) ok(`active meter "${meterName}" (${match.id})`);
      else {
        fail(
          `no ACTIVE meter with event_name "${meterName}" — meter events would be rejected`,
        );
      }
    } catch (cause) {
      fail(
        `meter lookup: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  console.log("\n--- verdict ---");
  if (missing.includes("STRIPE_WEBHOOK_SECRET")) {
    console.log(
      "  Checkout is DISABLED. `isStripeConfigured()` is all-or-nothing, so the\n" +
        "  missing webhook secret switches off every buy path — deliberately: a\n" +
        "  Checkout that works while the webhook cannot be verified would charge a\n" +
        "  customer whose plan then never upgrades.\n\n" +
        "  Locally:  stripe listen --forward-to localhost:3100/api/webhooks/stripe\n" +
        "            and copy the whsec_… it prints into STRIPE_WEBHOOK_SECRET.\n" +
        "  Deployed: Stripe Dashboard → Developers → Webhooks → your endpoint →\n" +
        "            Signing secret.",
    );
  }

  console.log(
    `\n${failures} failure(s), ${warnings} warning(s).${failures === 0 && missing.length === 0 ? " Billing is ready.\n" : "\n"}`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
