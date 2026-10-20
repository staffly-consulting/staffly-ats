/**
 * Creates the free-month promotion codes. Run: npm run stripe:promo-codes
 *
 * Idempotent: coupons have fixed ids and a code is only created when its coupon
 * has no active one yet, so running this twice changes nothing. Run it once per
 * Stripe mode — test and live objects are entirely separate, so codes made with
 * a test key do not exist for real customers.
 *
 * Each coupon is 100% off EVERY line item for N months, the metered overage
 * item included, so applications past the pool are free during that window
 * too. Checkout only offers the code box on monthly plans; see
 * `createCheckoutSession`.
 *
 * Codes carry a random suffix on purpose. `FREE1MONTH` is the first thing
 * anyone types into a promo box, and every guess that works is a free month of
 * model calls. Share the printed code with the company it is meant for.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import Stripe from "stripe";

// prisma.config.ts loads .env.local for the CLI; plain `tsx` does not.
config({ path: ".env.local" });

const FREE_MONTHS = [1, 2, 3] as const;

/** No 0/O or 1/I, so a code read out over the phone survives. */
const SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSuffix(length = 5): string {
  return [...randomBytes(length)]
    .map((byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length])
    .join("");
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    console.error("Missing STRIPE_SECRET_KEY.");
    process.exitCode = 1;
    return;
  }

  const mode = secret.startsWith("sk_live") ? "LIVE" : "test";
  console.log(`\nStripe ${mode} mode\n`);

  const stripe = new Stripe(secret, { maxNetworkRetries: 1, timeout: 20_000 });

  for (const months of FREE_MONTHS) {
    const couponId = `free-${months}-month${months === 1 ? "" : "s"}`;
    const name = `${months} month${months === 1 ? "" : "s"} free`;

    let coupon: Stripe.Coupon;
    try {
      coupon = await stripe.coupons.retrieve(couponId);
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
        throw error;
      }
      coupon = await stripe.coupons.create({
        id: couponId,
        name,
        percent_off: 100,
        duration: "repeating",
        duration_in_months: months,
      });
    }

    const existing = await stripe.promotionCodes.list({
      coupon: coupon.id,
      active: true,
      limit: 1,
    });

    const promo =
      existing.data[0] ??
      (await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code: `FREE${months}M-${randomSuffix()}`,
      }));

    console.log(
      `  ${name.padEnd(16)} ${promo.code}${existing.data[0] ? "  (already existed)" : ""}`,
    );
  }

  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
