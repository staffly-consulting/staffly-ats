"use client";

import { useTransition } from "react";

import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  confirmPendingCheckoutAction,
  discardPendingCheckoutAction,
} from "@/app/(dashboard)/dashboard/checkout/actions";
import { Button } from "@/components/ui/button";

/**
 * The two exits from the pending-checkout screen.
 *
 * A client island rather than plain forms so a failed Checkout surfaces as a
 * toast instead of a silently re-rendered page — matching how `BillingActions`
 * already treats a returned value as the error case, since success redirects.
 */
export function CheckoutConfirm({ planLabel }: { planLabel: string }) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await confirmPendingCheckoutAction();
      if (result && !result.ok) toast.error(result.error);
    });
  }

  function discard() {
    startTransition(async () => {
      await discardPendingCheckoutAction();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={confirm} disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CreditCard className="size-4" />
        )}
        Continue to payment
      </Button>
      <Button variant="ghost" onClick={discard} disabled={pending}>
        Choose a different plan
      </Button>
      <span className="sr-only" aria-live="polite">
        {pending ? `Starting checkout for ${planLabel}` : ""}
      </span>
    </div>
  );
}
