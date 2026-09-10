import "server-only";

import type { BillingInterval, PlanTier } from "@prisma/client";

import { PLANS, TRIAL_PERIOD_DAYS, isTrialEligible } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  flatPriceId,
  isSelfServeTier,
  overagePriceId,
  stripe,
} from "@/lib/stripe";

/**
 * Checkout and Billing Portal sessions.
 *
 * Every subscription ends up with TWO items: the flat price for the tier and
 * interval, and the tier's metered overage price. The overage item carries no
 * charge until the org exceeds its pool, but it has to be on the subscription,
 * because Stripe only bills meter events against a price the subscription
 * already holds.
 *
 * The overage price is always MONTHLY, including on annual plans, so usage is
 * invoiced as it accrues rather than accumulating uninvoiced for eleven months.
 *
 * That makes an annual subscription mixed-interval, and there is a wrinkle,
 * verified against the live API rather than assumed:
 *
 *   - The Subscriptions API accepts mixed intervals.
 *   - CHECKOUT DOES NOT. It rejects the session outright with "Checkout does not
 *     support multiple prices with different billing intervals", and no
 *     `billing_mode` setting changes that.
 *
 * So the two intervals take different paths. Monthly plans put both items in the
 * Checkout session, since they share an interval. Annual plans check out with
 * the flat price alone, and the webhook attaches the monthly metered item to the
 * resulting subscription — see `ensureOverageItem`.
 *
 * ---------------------------------------------------------------------------
 * WHY CANCELLATION IS OURS AND NOT THE PORTAL'S.
 *
 * Verified against the live API: on a MIXED-INTERVAL subscription,
 * `cancel_at_period_end: true` resolves to the EARLIEST item's period end — the
 * monthly metered item, not the annual flat one — and Stripe then rewrites the
 * flat item's period end to match.
 *
 *   Annual customer pays $2,490 upfront, cancels in month 2.
 *   cancel_at would land one MONTH out, not eleven, with no credit issued.
 *   => They paid for twelve months and keep access for one.
 *
 * So `cancelSubscription` below sets `cancel_at` to the FLAT item's period end
 * explicitly, and the Billing Portal has cancellation switched off so nobody can
 * reach the broken path. Cancelling stops the renewal, never the service already
 * paid for.
 *
 * The Portal keeps what it is genuinely better at — payment methods and invoice
 * history. Plan changes go through our own Checkout, which already builds the
 * correct two-item subscription.
 * ---------------------------------------------------------------------------
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
}

/**
 * The org's Stripe Customer, created on first use.
 *
 * Stored on the org rather than looked up by email each time: email is mutable
 * and not unique across Stripe, so matching on it would eventually attach one
 * org's subscription to another org's customer.
 */
export async function ensureStripeCustomer(input: {
  orgId: string;
  orgName: string;
  email: string | null;
}): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { stripeCustomerId: true },
  });

  if (org?.stripeCustomerId) return org.stripeCustomerId;

  const customer = await stripe().customers.create({
    name: input.orgName,
    email: input.email ?? undefined,
    // The webhook reads this back to find the org. Checkout's client_reference_id
    // covers the first purchase, but portal-initiated changes have no session,
    // so the link has to live on the customer itself.
    metadata: { orgId: input.orgId },
  });

  await prisma.organization.update({
    where: { id: input.orgId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

export interface CheckoutInput {
  orgId: string;
  orgName: string;
  email: string | null;
  tier: PlanTier;
  interval: BillingInterval;
}

/**
 * Whether this Checkout should carry the free trial.
 *
 * Only ever on an org's FIRST subscription. `startCheckoutAction` is also how
 * plan changes are made, and Stripe will happily grant a fresh trial on every
 * session it is asked to — so without this check a customer could switch tier
 * every fortnight and never pay for anything.
 *
 * Keyed on `stripeSubscriptionStatus` rather than on the customer existing: the
 * customer row is created on the first Checkout *attempt*, including abandoned
 * ones, so someone who bounced off the payment form would lose their trial
 * without ever having had it. The status column is only ever written by the
 * webhook, from a real subscription, and `applySubscription` keeps writing it
 * after cancellation (as `canceled`) — so a lapsed customer coming back does
 * not get a second free run either.
 */
async function isEligibleForTrial(orgId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true, stripeSubscriptionStatus: true },
  });

  // The rule itself lives in `lib/plans.ts`, so the screen that promises a
  // trial and the session that grants one read the same predicate.
  return org !== null && isTrialEligible(org);
}

/** Returns the URL to redirect the buyer to. */
export async function createCheckoutSession(
  input: CheckoutInput,
): Promise<string> {
  if (!isSelfServeTier(input.tier)) {
    throw new Error(
      `${PLANS[input.tier].label} is sold out of band; there is no Checkout for it.`,
    );
  }

  const [customerId, withTrial] = await Promise.all([
    ensureStripeCustomer(input),
    isEligibleForTrial(input.orgId),
  ]);

  // Monthly plans can carry the metered item through Checkout, because both
  // items bill monthly. Annual plans cannot — Checkout rejects mixed intervals —
  // so the metered item is attached by the webhook instead.
  const lineItems = [
    { price: flatPriceId(input.tier, input.interval), quantity: 1 },
    // No quantity: a metered item's amount comes from meter events.
    ...(input.interval === "MONTHLY"
      ? [{ price: overagePriceId(input.tier) }]
      : []),
  ];

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    subscription_data: {
      // Read by the webhook so an org can be resolved even if the Checkout
      // session itself is never seen.
      metadata: { orgId: input.orgId, planTier: input.tier },
      // First purchase only — see `isEligibleForTrial`. Stripe collects the card
      // up front and converts on its own; nothing here tracks a trial end.
      ...(withTrial ? { trial_period_days: TRIAL_PERIOD_DAYS } : {}),
    },
    // Survives even if the customer metadata is somehow absent.
    client_reference_id: input.orgId,
    success_url: `${appUrl()}/dashboard/settings?checkout=success`,
    cancel_url: `${appUrl()}/dashboard/settings?checkout=cancelled`,
    // Lets Stripe collect the tax fields a Thai entity needs for VAT-registered
    // buyers. Harmless when Stripe Tax is off.
    billing_address_collection: "auto",
  });

  if (!session.url) {
    throw new Error("Stripe returned a Checkout session with no URL.");
  }

  return session.url;
}

/**
 * Guarantees the subscription carries its tier's metered overage item.
 *
 * Called from the webhook. Needed because an annual Checkout cannot include the
 * item (see the note at the top of this file), and useful defensively for every
 * other path — a subscription created by hand in the Stripe dashboard would
 * otherwise silently accept no usage.
 *
 * Idempotent: webhook delivery is at-least-once, and adding the item twice would
 * bill the customer twice for the same applications.
 */
export async function ensureOverageItem(
  subscriptionId: string,
  tier: PlanTier,
): Promise<"added" | "already-present" | "not-applicable"> {
  if (!isSelfServeTier(tier)) return "not-applicable";

  const priceId = overagePriceId(tier);
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);

  const present = subscription.items.data.some(
    (item) => item.price.id === priceId,
  );
  if (present) return "already-present";

  await stripe().subscriptionItems.create({
    subscription: subscriptionId,
    price: priceId,
    // The item costs nothing until usage is reported, so there is nothing to
    // prorate — and a proration line for $0.00 on the first invoice reads like
    // a billing error to the customer.
    proration_behavior: "none",
  });

  return "added";
}

/**
 * Billing Portal, where plan changes and cancellation happen.
 *
 * Deliberately not reimplemented in our own UI: upgrades, proration, dunning and
 * payment-method updates are all things Stripe already does correctly, and every
 * one we rebuilt would be a second place for the subscription state to drift.
 */
export async function createPortalSession(orgId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });

  if (!org?.stripeCustomerId) {
    throw new Error(
      "This organization has no billing account yet — subscribe to a plan first.",
    );
  }

  const session = await stripe().billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    configuration: await portalConfigurationId(),
    return_url: `${appUrl()}/dashboard/settings`,
  });

  return session.url;
}

/** Marks the configuration as ours, so repeat runs reuse it. */
const PORTAL_CONFIG_TAG = "staffly-ats-portal-v1";

let cachedPortalConfigId: string | null = null;

/**
 * The Portal configuration, created once and reused.
 *
 * Cancellation and plan switching are both DISABLED here — see the note at the
 * top of this file. Stripe's default configuration allows cancellation, which on
 * an annual mixed-interval subscription would end a prepaid customer's access
 * eleven months early, so the default must not be used.
 *
 * Looked up by metadata rather than stored in an env var: one less thing to
 * configure, and a fresh Stripe account self-heals on first use.
 */
async function portalConfigurationId(): Promise<string> {
  if (cachedPortalConfigId) return cachedPortalConfigId;

  const existing = await stripe().billingPortal.configurations.list({
    limit: 100,
  });
  const mine = existing.data.find(
    (config) => config.metadata?.tag === PORTAL_CONFIG_TAG && config.active,
  );

  if (mine) {
    cachedPortalConfigId = mine.id;
    return mine.id;
  }

  const created = await stripe().billingPortal.configurations.create({
    business_profile: { headline: "Staffly ATS+ billing" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "address", "tax_id"],
      },
      // Both off deliberately. Cancellation is handled by cancelSubscription()
      // so the end date is correct; plan changes go through our own Checkout so
      // the metered overage item is always attached.
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { tag: PORTAL_CONFIG_TAG },
  });

  cachedPortalConfigId = created.id;
  return created.id;
}

export interface CancelResult {
  /** When access actually ends — the end of the period already paid for. */
  endsAt: Date;
}

/**
 * Schedules cancellation at the end of the paid term.
 *
 * Uses an explicit `cancel_at` rather than `cancel_at_period_end`, because on a
 * mixed-interval subscription the latter resolves to the monthly overage item
 * and would cut a prepaid annual customer off eleven months early.
 *
 * Never cancels immediately: the customer has paid for this period, and taking
 * the service away before it ends is a refund question, not a cancel one.
 */
export async function cancelSubscription(orgId: string): Promise<CancelResult> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true },
  });

  if (!org?.stripeSubscriptionId) {
    throw new Error("This organization has no subscription to cancel.");
  }

  const subscription = await stripe().subscriptions.retrieve(
    org.stripeSubscriptionId,
  );

  // The FLAT item, never the metered one — that is the period the customer paid
  // for. On a monthly plan the two coincide; on an annual plan they do not.
  const flat = subscription.items.data.find(
    (item) => item.price.recurring?.usage_type !== "metered",
  );

  if (!flat || typeof flat.current_period_end !== "number") {
    throw new Error(
      "Could not determine when this subscription's paid period ends.",
    );
  }

  await stripe().subscriptions.update(org.stripeSubscriptionId, {
    cancel_at: flat.current_period_end,
  });

  // Written straight away rather than waiting for the webhook, so the customer
  // sees the new state on the page they are already looking at. The webhook
  // remains authoritative and will confirm the same values.
  const endsAt = new Date(flat.current_period_end * 1000);
  await prisma.organization.update({
    where: { id: orgId },
    data: { cancelAtPeriodEnd: true, currentPeriodEnd: endsAt },
  });

  return { endsAt };
}

/** Undoes a scheduled cancellation, while the period is still running. */
export async function resumeSubscription(orgId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true },
  });

  if (!org?.stripeSubscriptionId) {
    throw new Error("This organization has no subscription to resume.");
  }

  await stripe().subscriptions.update(org.stripeSubscriptionId, {
    cancel_at: null,
  });

  await prisma.organization.update({
    where: { id: orgId },
    data: { cancelAtPeriodEnd: false },
  });
}
