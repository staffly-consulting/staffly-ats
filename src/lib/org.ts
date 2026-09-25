import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { OrgRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  CLERK_ROLE,
  STAFFLY_ROLE_METADATA_KEY,
  parseRole,
} from "@/lib/permissions";

/**
 * Org-level reads and membership writes for the Team and Settings screens.
 *
 * READS of the roster come from our own `OrgMember` mirror, which the Clerk
 * webhook keeps current — `listOrgMembers` and `getOrgSettings` never call
 * Clerk. As everywhere, `orgId` is a required argument because Prisma bypasses
 * RLS.
 *
 * WRITES are split, because Clerk and Staffly own different halves:
 *
 *   MEMBERSHIP (who is in the org, who is removed) belongs to Clerk. Those
 *   writes go to Clerk and the mirror updates itself when the resulting
 *   `organizationMembership.*` webhook lands.
 *
 *   ROLE (what a member may do) belongs to us, because Clerk's free tier has
 *   only two org roles and Staffly has three — see `CLERK_ROLE`. A role change
 *   writes `OrgMember.role` directly, and calls Clerk only when the Clerk-side
 *   key actually differs, i.e. when ADMIN is involved. Switching between
 *   RECRUITER and VIEWER is invisible to Clerk and needs no call at all.
 *
 * PENDING INVITATIONS are the one exception to "reads are local": they exist
 * only in Clerk. They are deliberately not mirrored — an invitation is
 * transient, expires on its own, and syncing it would mean maintaining a second
 * copy of something that deletes itself.
 */

export interface TeamMember {
  id: string;
  clerkUserId: string;
  name: string | null;
  email: string;
  role: OrgRole;
  joinedAt: string;
}

export async function listOrgMembers(orgId: string): Promise<TeamMember[]> {
  const rows = await prisma.orgMember.findMany({
    where: { orgId },
    // Admins first, then alphabetical — the ordering a roster is read in.
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: {
      id: true,
      clerkUserId: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    clerkUserId: row.clerkUserId,
    name: row.name,
    email: row.email,
    role: row.role,
    joinedAt: row.createdAt.toISOString(),
  }));
}

/* -------------------------------------------------------------------------- */
/* Membership writes (Clerk-owned)                                             */
/* -------------------------------------------------------------------------- */

export interface PendingInvitation {
  id: string;
  email: string;
  role: OrgRole;
  invitedAt: string;
  expiresAt: string;
}

/**
 * The role an invitation was actually sent for.
 *
 * Read from the metadata we attached, not from the Clerk role: `org:member`
 * covers RECRUITER and VIEWER alike. Falls back to the Clerk key so an
 * invitation created before this mechanism existed — or by hand in the Clerk
 * dashboard — still lists as something sensible rather than blank.
 */
function invitationRole(
  clerkRole: string,
  metadata: Record<string, unknown> | null | undefined,
): OrgRole {
  return (
    parseRole(metadata?.[STAFFLY_ROLE_METADATA_KEY]) ??
    (clerkRole === CLERK_ROLE.ADMIN ? "ADMIN" : "RECRUITER")
  );
}

/**
 * Outstanding invitations, live from Clerk.
 *
 * Returns an empty list rather than throwing when Clerk is unreachable: the
 * roster below it is the important half of the page, and blanking the whole
 * Team screen because a secondary list failed is the worse outcome.
 */
export async function listPendingInvitations(
  orgId: string,
): Promise<PendingInvitation[]> {
  try {
    const client = await clerkClient();
    const { data } = await client.organizations.getOrganizationInvitationList({
      organizationId: orgId,
      status: ["pending"],
      limit: 100,
    });

    return data.map((invitation) => ({
      id: invitation.id,
      email: invitation.emailAddress,
      role: invitationRole(invitation.role, invitation.publicMetadata),
      invitedAt: new Date(invitation.createdAt).toISOString(),
      expiresAt: new Date(invitation.expiresAt).toISOString(),
    }));
  } catch (cause) {
    console.error(`[listPendingInvitations] failed for org ${orgId}`, cause);
    return [];
  }
}

/**
 * How many admins the org has.
 *
 * Read from our mirror, which is enough: the guard it feeds is a safety rail
 * against the common mistake, not a defence against a determined race. Two
 * admins demoting each other in the same second is not a threat model; an admin
 * demoting themselves by accident and locking the org out of its own billing is
 * a Tuesday.
 */
async function countAdmins(orgId: string): Promise<number> {
  return prisma.orgMember.count({ where: { orgId, role: "ADMIN" } });
}

export class MembershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipError";
  }
}

/**
 * Turns a Clerk API failure into something a recruiter can act on.
 *
 * Only `org:admin` and `org:member` are ever sent, so a rejected role means the
 * Clerk instance is misconfigured rather than that the user typed something
 * wrong — the message says so instead of blaming their input.
 */
function describeClerkFailure(cause: unknown): string {
  if (!isClerkAPIResponseError(cause)) {
    return "Could not reach the identity provider. Try again in a moment.";
  }

  const codes = cause.errors.map((error) => error.code);
  const text = cause.errors
    .map((error) => `${error.message} ${error.longMessage ?? ""}`)
    .join(" ")
    .toLowerCase();

  if (codes.includes("duplicate_record") || text.includes("already")) {
    return "That person is already a member of this organization, or has an invitation outstanding.";
  }

  if (text.includes("role")) {
    return `The identity provider rejected the "${CLERK_ROLE.RECRUITER}" role. Check that your Clerk instance still has its default organization roles.`;
  }

  if (text.includes("email")) {
    return "That email address was rejected. Check it and try again.";
  }

  return "Could not complete that change. Try again in a moment.";
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
}

/**
 * Invites someone by email.
 *
 * Clerk sends the email and owns the invitation's lifetime. On acceptance,
 * `organizationMembership.created` creates the `OrgMember` row — and if the
 * invitee reaches the dashboard before that webhook lands, `provisionTenant`
 * creates it instead.
 *
 * Neither of those paths can know whether `org:member` meant RECRUITER or
 * VIEWER, so the real role rides along in the invitation's public metadata and
 * is applied by the `organizationInvitation.accepted` handler. That event
 * carries both the metadata and the new `user_id`, which is what makes this
 * work without a role Clerk charges for.
 */
export async function inviteMember(params: {
  orgId: string;
  email: string;
  role: OrgRole;
  inviterUserId: string;
}): Promise<void> {
  const client = await clerkClient();

  try {
    await client.organizations.createOrganizationInvitation({
      organizationId: params.orgId,
      emailAddress: params.email,
      role: CLERK_ROLE[params.role],
      inviterUserId: params.inviterUserId,
      // The role Clerk cannot express. Read back in the webhook; see
      // STAFFLY_ROLE_METADATA_KEY for why the key is a shared constant.
      publicMetadata: { [STAFFLY_ROLE_METADATA_KEY]: params.role },
      // Where the invitee lands after accepting. `/dashboard` runs the layout
      // that provisions their tenant rows, so they arrive at a working app
      // rather than at a page that needs the webhook to have won a race.
      // Absolute: Clerk resolves a bare path against its own Account Portal
      // host, which has no /dashboard.
      redirectUrl: `${appUrl()}/dashboard`,
    });
  } catch (cause) {
    console.error(`[inviteMember] failed for org ${params.orgId}`, cause);
    throw new MembershipError(describeClerkFailure(cause));
  }
}

export async function revokeInvitation(params: {
  orgId: string;
  invitationId: string;
  requestingUserId: string;
}): Promise<void> {
  const client = await clerkClient();

  try {
    await client.organizations.revokeOrganizationInvitation({
      organizationId: params.orgId,
      invitationId: params.invitationId,
      requestingUserId: params.requestingUserId,
    });
  } catch (cause) {
    console.error(`[revokeInvitation] failed for org ${params.orgId}`, cause);
    throw new MembershipError(
      "Could not revoke that invitation. It may have already been accepted or expired.",
    );
  }
}

/**
 * Changes a member's role.
 *
 * `orgId` is the caller's own, established from the session, so a member id
 * from the client cannot reach another tenant: the lookup below is scoped, and
 * an id from elsewhere simply does not resolve.
 *
 * Two writes, in a deliberate order:
 *
 *   1. CLERK, but only when the Clerk-side key actually changes — that is, only
 *      when ADMIN is being granted or removed. RECRUITER and VIEWER are both
 *      `org:member`, so switching between them is invisible to Clerk and needs
 *      no call. This is the saving that makes three roles work on a two-role
 *      plan.
 *   2. OUR ROW, always, because it is the only place the distinction exists and
 *      the only thing `getCurrentRole` reads.
 *
 * Clerk first so that a failure there leaves both sides unchanged. The reverse
 * order would write a role we then could not apply. The membership webhook that
 * follows a Clerk write is harmless either way: `resolveMemberRole` preserves
 * what step 2 wrote.
 */
export async function updateMemberRole(params: {
  orgId: string;
  memberId: string;
  role: OrgRole;
}): Promise<void> {
  const member = await prisma.orgMember.findFirst({
    where: { id: params.memberId, orgId: params.orgId },
    select: { clerkUserId: true, role: true },
  });

  if (!member) throw new MembershipError("That member was not found.");
  if (member.role === params.role) return;

  // Demoting the last admin leaves an org that nobody can invite into, bill, or
  // reconfigure — and there is no support tool to fix it from the outside.
  if (member.role === "ADMIN" && (await countAdmins(params.orgId)) <= 1) {
    throw new MembershipError(
      "This is the only admin in the organization. Promote someone else to admin first.",
    );
  }

  if (CLERK_ROLE[member.role] !== CLERK_ROLE[params.role]) {
    const client = await clerkClient();

    try {
      await client.organizations.updateOrganizationMembership({
        organizationId: params.orgId,
        userId: member.clerkUserId,
        role: CLERK_ROLE[params.role],
      });
    } catch (cause) {
      console.error(`[updateMemberRole] failed for org ${params.orgId}`, cause);
      throw new MembershipError(describeClerkFailure(cause));
    }
  }

  await prisma.orgMember.updateMany({
    where: { id: params.memberId, orgId: params.orgId },
    data: { role: params.role },
  });
}

/**
 * Removes a member from the organization.
 *
 * Their `OrgMember` row goes when `organizationMembership.deleted` arrives.
 * Job posts they created survive: `JobPost.createdById` is a nullable relation
 * with no cascade, so removing a recruiter does not delete the roles they
 * opened. Losing a live search because someone left the company would be a far
 * worse outcome than an unattributed job post.
 */
export async function removeMember(params: {
  orgId: string;
  memberId: string;
  actingClerkUserId: string;
}): Promise<void> {
  const member = await prisma.orgMember.findFirst({
    where: { id: params.memberId, orgId: params.orgId },
    select: { clerkUserId: true, role: true },
  });

  if (!member) throw new MembershipError("That member was not found.");

  if (member.clerkUserId === params.actingClerkUserId) {
    throw new MembershipError(
      "You cannot remove yourself. Ask another admin to do it.",
    );
  }

  if (member.role === "ADMIN" && (await countAdmins(params.orgId)) <= 1) {
    throw new MembershipError(
      "This is the only admin in the organization. Promote someone else to admin first.",
    );
  }

  const client = await clerkClient();

  try {
    await client.organizations.deleteOrganizationMembership({
      organizationId: params.orgId,
      userId: member.clerkUserId,
    });
  } catch (cause) {
    console.error(`[removeMember] failed for org ${params.orgId}`, cause);
    throw new MembershipError(
      "Could not remove that member. Try again in a moment.",
    );
  }
}

/**
 * Invited users may never create organizations of their own.
 *
 * The `organizationInvitation.accepted` webhook sets this at join time, but a
 * webhook only covers users invited after it was deployed, and only if it is
 * delivered. This is the backstop, run where "Create organization" is shown:
 * membership of any organization the user did not create means they were
 * invited. Clerk enforces the flag server-side and its UI hides the button.
 *
 * Best-effort: a Clerk outage must not lock anyone out of picking their org.
 */
export async function blockOrgCreationIfInvited(
  clerkUserId: string,
): Promise<void> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    if (!user.createOrganizationEnabled) return;

    const memberships = await client.users.getOrganizationMembershipList({
      userId: clerkUserId,
      limit: 100,
    });
    const invited = memberships.data.some(
      (membership) => membership.organization.createdBy !== clerkUserId,
    );
    if (!invited) return;

    await client.users.updateUser(clerkUserId, {
      createOrganizationEnabled: false,
    });
    console.info(
      `[org] ${clerkUserId} joined by invitation; organization creation disabled`,
    );
  } catch (cause) {
    console.error(
      `[org] could not check organization creation for ${clerkUserId}`,
      cause,
    );
  }
}

export interface OrgSettings {
  id: string;
  name: string;
  subscriptionTier: string;
  applicationQuota: number;
  createdAt: string;
  counts: {
    members: number;
    jobPosts: number;
    candidates: number;
    universities: number;
  };
}

export async function getOrgSettings(
  orgId: string,
): Promise<OrgSettings | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      subscriptionTier: true,
      applicationQuota: true,
      createdAt: true,
      _count: {
        select: {
          members: true,
          jobPosts: true,
          candidates: true,
          universityLists: true,
        },
      },
    },
  });

  if (!org) return null;

  return {
    id: org.id,
    name: org.name,
    subscriptionTier: org.subscriptionTier,
    applicationQuota: org.applicationQuota,
    createdAt: org.createdAt.toISOString(),
    counts: {
      members: org._count.members,
      jobPosts: org._count.jobPosts,
      candidates: org._count.candidates,
      universities: org._count.universityLists,
    },
  };
}
