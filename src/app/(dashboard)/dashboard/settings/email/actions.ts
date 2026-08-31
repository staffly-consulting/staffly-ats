"use server";

import { revalidatePath } from "next/cache";

import { requireOrgContext } from "@/lib/auth";
import {
  connectEmailInbox,
  disconnectEmailInbox,
  type EmailInboxSummary,
} from "@/lib/email-inbox";
import { prisma } from "@/lib/prisma";

export type InboxActionResult =
  { ok: true; inbox: EmailInboxSummary } | { ok: false; error: string };

/**
 * Generates the org's forwarding alias, or reactivates an existing one.
 *
 * TODO(roles): this is an org-level configuration change that any member can
 * currently perform. Gate on `OrgRole.ADMIN` once role enforcement lands.
 */
export async function connectInboxAction(): Promise<InboxActionResult> {
  const { orgId } = await requireOrgContext();

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
  const { orgId } = await requireOrgContext();

  try {
    await disconnectEmailInbox(orgId);
    revalidatePath("/dashboard/settings/email");
    return { ok: true };
  } catch (cause) {
    console.error("[disconnectInboxAction] failed", cause);
    return { ok: false, error: "Could not disconnect the inbox." };
  }
}
