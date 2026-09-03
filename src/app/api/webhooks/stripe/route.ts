import { headers } from "next/headers";

import type Stripe from "stripe";

import { ensureOverageItem } from "@/lib/billing-checkout";
import { prisma } from "@/lib/prisma";
import { planFromPriceId, stripe, webhookSecret } from "@/lib/stripe";
import type { BillingInterval, PlanTier } from "@prisma/client";

/**
 * Stripe -> Postgres sync.
 *
 * Stripe is the source of truth for money; this endpoint mirrors the parts that
 * gate access — which tier an org bought and whether they are currently paying —
 * into `Organization`, so entitlement checks never make a network call.
 *
 * Response contract, matching the Clerk webhook next door:
 *   2xx — delivered; Stripe stops retrying.
 *   4xx — permanently rejected. Only for what can never succeed: bad signature,
 *         unparseable body.
 *   5xx — transient; Stripe retries with backoff. Database failures return 500
 *         on purpose, so a blip cannot silently drop a paid upgrade.
 *
 * Delivery is at-least-once and NOT ordered. Every handler is an idempotent
 * write keyed on the Stripe customer or subscription id, so a replayed event, or
 * a `subscription.updated` that lands before its `checkout.completed`, converges
 * to the same row.
 */

/** Events we act on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

/**
 * Resolves the org a Stripe object belongs to.
 *
 * Three sources, in descending trustworthiness. Metadata is written by us at
 * creation; `stripeCustomerId` is our own stored link. Both are checked because
 * a subscription created in the Stripe dashboard by hand would have neither
 * metadata nor a checkout session.
 */
async function resolveOrgId(input: {
  metadataOrgId?: string | null;
  clientReferenceId?: string | null;
  customerId?: string | null;
}): Promise<string | null> {
  const direct = input.metadataOrgId ?? input.clientReferenceId;
  if (direct) {
    const exists = await prisma.organization.findUnique({
      where: { id: direct },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  if (input.customerId) {
    const byCustomer = await prisma.organization.findUnique({
      where: { stripeCustomerId: input.customerId },
      select: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }

  return null;
}

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Reads the tier and interval off a subscription's line items.
 *
 * A subscription carries two items — the flat price and the metered overage
 * price. Only the flat one identifies the plan, so the metered item is skipped
 * rather than being allowed to resolve to nothing and blank the tier.
 */
function planFromSubscription(
  subscription: Stripe.Subscription,
): { tier: PlanTier; interval: BillingInterval } | null {
  for (const item of subscription.items.data) {
    if (item.price.recurring?.usage_type === "metered") continue;
    const match = planFromPriceId(item.price.id);
    if (match) return match;
  }
  return null;
}

/**
 * When the customer's current paid period ends.
 *
 * `current_period_end` is NOT on the Subscription object — Stripe moved it onto
 * subscription items in the 2025 API. That matters doubly here, because an
 * annual plan carries two items with DIFFERENT period ends: the flat item runs
 * for a year, the metered overage item closes monthly.
 *
 * The flat item is the one a customer means by "when does my plan renew", so
 * that is the one mirrored. The metered item's monthly close is when overage
 * invoices, which is a separate thing and not what this column is for.
 */
function periodEndOf(subscription: Stripe.Subscription): Date | null {
  const flat = subscription.items.data.find(
    (item) => item.price.recurring?.usage_type !== "metered",
  );
  const seconds = flat?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

async function applySubscription(
  subscription: Stripe.Subscription,
): Promise<"applied" | "no-org"> {
  const customerId = customerIdOf(subscription.customer);
  const orgId = await resolveOrgId({
    metadataOrgId: subscription.metadata?.orgId,
    customerId,
  });

  if (!orgId) return "no-org";

  const plan = planFromSubscription(subscription);

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      stripeCustomerId: customerId ?? undefined,
      currentPeriodEnd: periodEndOf(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      // Only overwrite the tier when a price we recognise is on the
      // subscription. An unrecognised price (created by hand in the dashboard,
      // or a live-mode id while we are in test) must not silently downgrade a
      // paying customer to the default tier.
      ...(plan ? { planTier: plan.tier, billingInterval: plan.interval } : {}),
    },
  });

  // The pool is annual and starts when the org first subscribes. Written only
  // when it is still null, so a renewal cannot hand a monthly customer a fresh
  // annual pool twelve times a year. Separate from the update above because
  // that one is keyed on id alone and would overwrite unconditionally.
  await prisma.organization.updateMany({
    where: { id: orgId, poolCycleAnchor: null },
    data: { poolCycleAnchor: new Date() },
  });

  return "applied";
}

export async function POST(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = webhookSecret();
  } catch {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const signature = (await headers()).get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // The RAW body is required: Stripe signs the exact bytes sent, so parsing to
  // JSON first and re-serialising would produce a different string and fail.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      payload,
      signature,
      secret,
    );
  } catch (cause) {
    console.error("[stripe-webhook] signature verification failed", cause);
    return new Response("Invalid signature", { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return new Response("Ignored", { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Only the subscription id is reliably present here; the session's own
        // copy of the plan is not. Fetching gives one code path shared with the
        // subscription events below, rather than two that can disagree.
        if (typeof session.subscription !== "string") break;

        const subscription = await stripe().subscriptions.retrieve(
          session.subscription,
        );

        // Carry the org link onto the subscription for every later event.
        const orgId = await resolveOrgId({
          metadataOrgId: session.metadata?.orgId,
          clientReferenceId: session.client_reference_id,
          customerId: customerIdOf(session.customer),
        });

        if (orgId && !subscription.metadata?.orgId) {
          await stripe().subscriptions.update(subscription.id, {
            metadata: { ...subscription.metadata, orgId },
          });
          subscription.metadata = { ...subscription.metadata, orgId };
        }

        if ((await applySubscription(subscription)) === "no-org") {
          console.error(
            `[stripe-webhook] checkout completed for an unknown org (session ${session.id})`,
          );
        }

        // An ANNUAL checkout could not include the metered item, because
        // Checkout rejects mixed billing intervals. Attach it now, or the org's
        // first overage application would have no price to bill against.
        const plan = planFromSubscription(subscription);
        if (plan) {
          const outcome = await ensureOverageItem(subscription.id, plan.tier);
          if (outcome === "added") {
            console.info(
              `[stripe-webhook] attached metered overage item to ${subscription.id} (${plan.tier} ${plan.interval})`,
            );
          }
        } else {
          console.error(
            `[stripe-webhook] subscription ${subscription.id} carries no price we recognise; overage item NOT attached`,
          );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        if ((await applySubscription(subscription)) === "no-org") {
          console.error(
            `[stripe-webhook] ${event.type} for an unknown org (subscription ${subscription.id})`,
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const orgId = await resolveOrgId({
          customerId: customerIdOf(invoice.customer),
        });

        // Access is gated on subscription status, which Stripe moves to
        // `past_due` itself and delivers as a subscription.updated. Logged here
        // rather than acted on, so there is one writer for that column.
        console.warn(
          `[stripe-webhook] payment failed for org ${orgId ?? "unknown"} (invoice ${invoice.id})`,
        );
        break;
      }
    }
  } catch (cause) {
    // 500 so Stripe retries. Swallowing this would mean a paid customer whose
    // plan never applied, with nothing left to replay it.
    console.error(`[stripe-webhook] handler failed for ${event.type}`, cause);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
