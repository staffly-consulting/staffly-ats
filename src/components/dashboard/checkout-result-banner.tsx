import { CheckCircle2, Info, Loader2 } from "lucide-react";

/**
 * What Stripe's `success_url` and `cancel_url` land on.
 *
 * Without this the return from Checkout was a dead end: the settings page
 * ignored the query string entirely, so a buyer who had just paid saw the page
 * they left, with no acknowledgement.
 *
 * The awaiting case is the one that matters. Stripe redirects the browser back
 * as soon as payment succeeds, which routinely beats the
 * `checkout.session.completed` webhook that writes the subscription — so for a
 * second or two the org still reads as unsubscribed. Rendering the old plan
 * then looks exactly like a payment that failed, and generates the support
 * ticket the payment was supposed to avoid.
 */
export function CheckoutResultBanner({
  outcome,
  awaitingConfirmation,
  planLabel,
}: {
  /** Raw `?checkout=` value; anything unrecognised renders nothing. */
  outcome: string | undefined;
  /** Paid, but the webhook has not written the subscription yet. */
  awaitingConfirmation: boolean;
  planLabel: string;
}) {
  if (outcome === "cancelled") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          Checkout was cancelled and nothing has been charged. Your plan is
          unchanged.
        </span>
      </div>
    );
  }

  if (outcome !== "success") return null;

  if (awaitingConfirmation) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-warning">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
        <span>
          Payment received — we are confirming your subscription with Stripe.
          This usually takes a few seconds; reload the page to see it.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success/12 px-3 py-2.5 text-sm text-success">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      <span>
        You are subscribed to <span className="font-medium">{planLabel}</span>.
        Your invoice and payment method are available below.
      </span>
    </div>
  );
}
