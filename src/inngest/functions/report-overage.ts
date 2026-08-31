import { inngest, type StafflyEvents } from "@/inngest/client";
import { isStripeConfigured, meterEventName, stripe } from "@/lib/stripe";
import { markMeterEventReported } from "@/lib/usage";

/**
 * `billing/overage-recorded` → one Stripe meter event.
 *
 * Async by design: ingestion must never wait on Stripe. A slow or down billing
 * API would otherwise stall resume processing, which is the product working,
 * to protect revenue, which is bookkeeping.
 *
 * A dropped meter event is unbilled revenue, so failures retry rather than
 * being swallowed. Once Stripe accepts the event, its id is written back onto
 * the ledger row — the gap between `wasOverage: true` and a null id is exactly
 * the amount of usage that has not been billed.
 */

type OverageRecorded = StafflyEvents["billing/overage-recorded"];

export const reportOverageFunction = inngest.createFunction(
  {
    id: "report-overage-to-stripe",
    name: "Report application overage to Stripe",
    // More attempts than the AI functions: this is money, and a transient
    // Stripe outage should not cost a billable application.
    retries: 5,
    concurrency: { key: "event.data.orgId", limit: 5 },
    triggers: [{ event: "billing/overage-recorded" }],
  },
  async ({ event, step, logger }) => {
    const { orgId, candidateId, ledgerEntryId, stripeCustomerId } =
      event.data as OverageRecorded;

    // Billing is not live yet. Skip quietly rather than retrying five times and
    // then failing loudly for every application every org ingests.
    if (!isStripeConfigured()) {
      logger.warn(
        `[report-overage] Stripe is not configured; ledger entry ${ledgerEntryId} left unreported`,
      );
      return { skipped: "stripe-not-configured", ledgerEntryId };
    }

    // An org that reached overage without ever completing Checkout has no
    // customer to bill. Real case: Enterprise orgs placed on a tier by hand.
    if (!stripeCustomerId) {
      logger.warn(
        `[report-overage] org ${orgId} has no stripeCustomerId; ledger entry ${ledgerEntryId} left unreported`,
      );
      return { skipped: "no-stripe-customer", ledgerEntryId };
    }

    const meterEventId = await step.run("send-meter-event", async () => {
      const response = await stripe().billing.meterEvents.create({
        event_name: meterEventName(),
        payload: {
          stripe_customer_id: stripeCustomerId,
          value: "1",
        },
        // Stripe dedupes on this within its retention window, so an Inngest
        // retry that actually did reach Stripe cannot double-bill. The ledger
        // row id is stable and unique per counted application, which is exactly
        // the granularity being billed.
        identifier: ledgerEntryId,
      });
      return response.identifier;
    });

    await step.run("stamp-ledger", () =>
      markMeterEventReported(ledgerEntryId, meterEventId),
    );

    logger.info(
      `[report-overage] org ${orgId}: billed 1 application (candidate ${candidateId}, ledger ${ledgerEntryId})`,
    );

    return { reported: true, meterEventId, ledgerEntryId };
  },
);
