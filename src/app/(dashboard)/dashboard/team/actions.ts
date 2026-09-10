"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { permissionError, requireOrgContext } from "@/lib/auth";
import {
  MembershipError,
  inviteMember,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from "@/lib/org";
import { PERMISSIONS, parseRole } from "@/lib/permissions";

/**
 * Membership management.
 *
 * Every action here re-checks `MEMBER_MANAGE` on the server. The Team page also
 * hides these controls from non-admins, but that is presentation: a server
 * action is a public POST endpoint, and hiding a button stops nobody from
 * calling it.
 *
 * The identity provider does the work — see `lib/org.ts` for why these write to
 * Clerk rather than to our own tables.
 */

export type TeamActionResult = { ok: true } | { ok: false; error: string };

const inviteSchema = z.object({
  // Clerk validates the address too, but rejecting an obvious typo here saves a
  // round trip and gives the error on the field rather than in a toast.
  email: z.string().trim().min(1, "Enter an email address.").pipe(z.email()),
  role: z.string(),
});

export async function inviteMemberAction(
  input: unknown,
): Promise<TeamActionResult> {
  const context = await requireOrgContext();

  const denied = await permissionError(context, PERMISSIONS.MEMBER_MANAGE);
  if (denied) return denied;

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  const role = parseRole(parsed.data.role);
  if (!role) return { ok: false, error: "Pick a role for this person." };

  try {
    await inviteMember({
      orgId: context.orgId,
      email: parsed.data.email.toLowerCase(),
      role,
      inviterUserId: context.clerkUserId,
    });
  } catch (cause) {
    if (cause instanceof MembershipError) {
      return { ok: false, error: cause.message };
    }
    console.error("[inviteMemberAction] failed", cause);
    return { ok: false, error: "Could not send that invitation." };
  }

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function revokeInvitationAction(
  invitationId: unknown,
): Promise<TeamActionResult> {
  const context = await requireOrgContext();

  const denied = await permissionError(context, PERMISSIONS.MEMBER_MANAGE);
  if (denied) return denied;

  if (typeof invitationId !== "string" || invitationId === "") {
    return { ok: false, error: "Missing invitation." };
  }

  try {
    await revokeInvitation({
      orgId: context.orgId,
      invitationId,
      requestingUserId: context.clerkUserId,
    });
  } catch (cause) {
    if (cause instanceof MembershipError) {
      return { ok: false, error: cause.message };
    }
    console.error("[revokeInvitationAction] failed", cause);
    return { ok: false, error: "Could not revoke that invitation." };
  }

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function updateMemberRoleAction(
  memberId: unknown,
  roleInput: unknown,
): Promise<TeamActionResult> {
  const context = await requireOrgContext();

  const denied = await permissionError(context, PERMISSIONS.MEMBER_MANAGE);
  if (denied) return denied;

  if (typeof memberId !== "string" || memberId === "") {
    return { ok: false, error: "Missing member." };
  }

  const role = parseRole(roleInput);
  if (!role) return { ok: false, error: "Pick one of the available roles." };

  try {
    await updateMemberRole({ orgId: context.orgId, memberId, role });
  } catch (cause) {
    if (cause instanceof MembershipError) {
      return { ok: false, error: cause.message };
    }
    console.error("[updateMemberRoleAction] failed", cause);
    return { ok: false, error: "Could not change that role." };
  }

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function removeMemberAction(
  memberId: unknown,
): Promise<TeamActionResult> {
  const context = await requireOrgContext();

  const denied = await permissionError(context, PERMISSIONS.MEMBER_MANAGE);
  if (denied) return denied;

  if (typeof memberId !== "string" || memberId === "") {
    return { ok: false, error: "Missing member." };
  }

  try {
    await removeMember({
      orgId: context.orgId,
      memberId,
      actingClerkUserId: context.clerkUserId,
    });
  } catch (cause) {
    if (cause instanceof MembershipError) {
      return { ok: false, error: cause.message };
    }
    console.error("[removeMemberAction] failed", cause);
    return { ok: false, error: "Could not remove that member." };
  }

  revalidatePath("/dashboard/team");
  return { ok: true };
}
