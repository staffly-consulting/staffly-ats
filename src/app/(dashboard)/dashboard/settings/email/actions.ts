"use server";

import { revalidatePath } from "next/cache";

import { permissionError, requireOrgContext } from "@/lib/auth";
import {
  connectEmailInbox,
  disconnectEmailInbox,
  type EmailInboxSummary,
} from "@/lib/email-inbox";
import { checkSubscription } from "@/lib/entitlements";
import { PERMISSIONS } from "@/lib/permissions";
import { TRIAL_PERIOD_DAYS } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export type InboxActionResult =
  { ok: true; inbox: EmailInboxSummary } | { ok: false; error: string };

/**
 * Generates the org's forwarding alias, or reactivates an existing one.
 *
 * Admin-only: this is the pipe every application arrives through, and changing
 * it affects the whole organization rather than one recruiter's work.
 */
export async function connectInboxAction(): Promise<InboxActionResult> {
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.INBOX_MANAGE);
  if (denied) return denied;

  // Every resume that reaches this address costs a model call, so the address
  // is part of the paid product. Ingestion re-checks this per email; refusing
  // here just stops an org holding an address that cannot do anything.
  const subscription = await checkSubscription(orgId);
  if (!subscription.active) {
    return {
      ok: false,
      error:
        subscription.reason === "lapsed"
          ? "Your subscription is no longer active. Reactivate it in Settings to receive applications again."
          : `Choose a plan to get a forwarding address. Your first ${TRIAL_PERIOD_DAYS} days are free and you can cancel within them without being charged.`,
    };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  if (!organization) {
    return {
      ok: false,
      error: "Your organization is still being set up. Try again in a moment.",
    };
  }

  try {
    const inbox = await connectEmailInbox(orgId, organization.name);
    revalidatePath("/dashboard/settings/email");
    return { ok: true, inbox };
  } catch (cause) {
    console.error("[connectInboxAction] failed", cause);
    return { ok: false, error: "Could not generate a forwarding address." };
  }
}

/** Soft disconnect — stops ingestion, keeps the alias and historical data. */
export async function disconnectInboxAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const context = await requireOrgContext();
  const { orgId } = context;

  const denied = await permissionError(context, PERMISSIONS.INBOX_MANAGE);
  if (denied) return denied;

  try {
    await disconnectEmailInbox(orgId);
    revalidatePath("/dashboard/settings/email");
    return { ok: true };
  } catch (cause) {
    console.error("[disconnectInboxAction] failed", cause);
    return { ok: false, error: "Could not disconnect the inbox." };
  }
}
