import type { OrgRole } from "@prisma/client";

/**
 * What each role is allowed to do.
 *
 * Pure and dependency-free, exactly like `lib/plans.ts` is for entitlements, so
 * it can be imported by a server component that already has the role loaded and
 * by the fetching helpers in `lib/auth.ts` alike.
 *
 * Two axes gate this product and they are deliberately separate:
 *
 *   - ENTITLEMENT (`lib/plans.ts`) — what the organization has paid for.
 *   - PERMISSION (this file)       — what this member may do with it.
 *
 * A RECRUITER on Talent Pool is entitled to university preferences and
 * permitted to edit them; a VIEWER on the same plan is entitled and not
 * permitted. Collapsing the two into one check would make "upgrade your plan"
 * the error message for what is really "ask your admin".
 */

export const PERMISSIONS = {
  /** Create and edit job posts. */
  JOB_POST_WRITE: "JOB_POST_WRITE",
  /** Reassign, re-extract and re-score candidates. */
  CANDIDATE_WRITE: "CANDIDATE_WRITE",
  /**
   * Download candidate data as a spreadsheet.
   *
   * Separate from CANDIDATE_WRITE, and from reading, because bulk export is its
   * own risk: reading a candidate in the app leaves the data in the app, while
   * an export is a file of names, emails, phone numbers and nationalities that
   * walks out of it. This is the permission that keeps unlimited VIEWER seats
   * safe — a hiring panel can read every shortlist without any of them being
   * able to take the whole applicant database with them.
   */
  CANDIDATE_EXPORT: "CANDIDATE_EXPORT",
  /** Add, edit and delete the org's preferred universities. */
  UNIVERSITY_WRITE: "UNIVERSITY_WRITE",
  /** Connect and disconnect the forwarding inbox. */
  INBOX_MANAGE: "INBOX_MANAGE",
  /** Start Checkout, cancel, and open the Stripe portal. */
  BILLING_MANAGE: "BILLING_MANAGE",
  /** Invite, change roles, and remove members. */
  MEMBER_MANAGE: "MEMBER_MANAGE",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * The grant table.
 *
 * Deliberately an explicit list per role rather than a hierarchy, because the
 * roles are not strictly nested in the way a rank comparison would imply. It is
 * also the artefact a customer asks to see when they ask "what can a viewer
 * do?", and a table answers that; a chain of `rank >=` comparisons does not.
 *
 * Reading is not a permission. Every member of an org can see its job posts,
 * candidates and scores, including resumes — a hiring manager who cannot open
 * the CV has no reason to be invited.
 *
 * The line is drawn at changing things and at taking them out of the app:
 * writes, and bulk export. Reading a candidate leaves the data where it is;
 * downloading four hundred of them does not.
 */
const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  ADMIN: [
    PERMISSIONS.JOB_POST_WRITE,
    PERMISSIONS.CANDIDATE_WRITE,
    PERMISSIONS.CANDIDATE_EXPORT,
    PERMISSIONS.UNIVERSITY_WRITE,
    PERMISSIONS.INBOX_MANAGE,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.MEMBER_MANAGE,
  ],
  // Everything about running a search, nothing about the account behind it.
  // A recruiter cannot cancel the subscription, rewire the inbox every
  // application arrives through, or change who has access.
  RECRUITER: [
    PERMISSIONS.JOB_POST_WRITE,
    PERMISSIONS.CANDIDATE_WRITE,
    PERMISSIONS.CANDIDATE_EXPORT,
    PERMISSIONS.UNIVERSITY_WRITE,
  ],
  // Read-only. This is the role you hand a hiring manager, and it is what makes
  // unlimited seats safe: an org can invite its whole hiring panel without
  // anyone gaining the ability to change a criterion or delete a role.
  VIEWER: [],
};

export function roleCan(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Every permission a role holds. For rendering a capability list. */
export function permissionsFor(role: OrgRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/* -------------------------------------------------------------------------- */
/* Clerk role mapping                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Our role -> Clerk's role key.
 *
 * WHY VIEWER AND RECRUITER SHARE ONE CLERK ROLE
 *
 * Clerk ships exactly two organization roles on its free tier, `org:admin` and
 * `org:member`; defining a third requires a paid plan. Rather than buy one for
 * a single string, Staffly keeps its own three roles in `OrgMember.role` and
 * tells Clerk only what Clerk needs in order to run membership.
 *
 * This costs nothing in enforcement, because enforcement never read Clerk's
 * role to begin with: `getCurrentRole` in `lib/auth.ts` reads the database, so
 * a Clerk claim could not be the authority even if we wanted it to be.
 *
 * The division of labour is therefore:
 *
 *   Clerk    owns MEMBERSHIP — who belongs to an organization, and who is an
 *            administrator of it in Clerk's own sense.
 *   Staffly  owns ROLE — what a member may do in this product.
 *
 * One consequence worth knowing: Clerk's dashboard shows every non-admin as
 * "Member", because that is all it is told. The Team page shows the real role.
 */
export const CLERK_ROLE: Record<OrgRole, string> = {
  ADMIN: "org:admin",
  RECRUITER: "org:member",
  // Not a typo. See above — Clerk has no separate key for this.
  VIEWER: "org:member",
};

/**
 * Clerk's role -> ours, for SEEDING a member row that does not exist yet.
 *
 * Deliberately lossy: `org:member` covers both RECRUITER and VIEWER, and this
 * function cannot tell them apart. It therefore never returns VIEWER — the
 * default is RECRUITER, and the real role arrives from the invitation's
 * metadata (`organizationInvitation.accepted`) or from an admin setting it.
 *
 * Because it is lossy, it must NOT be used to update an existing member. Use
 * `resolveMemberRole` for that, which knows when to leave a role alone.
 *
 * Anything unrecognised falls back to RECRUITER: the least privileged role that
 * can still do the job, never ADMIN. A Clerk instance can define arbitrary
 * custom roles, and an unknown one must not be an escalation.
 *
 * Lives here rather than in `lib/auth.ts` because it is pure. Keeping it beside
 * `requireOrgContext` meant the Clerk webhook route — which needs nothing else
 * from that module — pulled in `next/navigation` and the whole session stack to
 * read a string.
 */
export function mapClerkRole(clerkRole: string | null | undefined): OrgRole {
  switch (clerkRole) {
    case "org:admin":
    case "admin":
      return "ADMIN";
    default:
      return "RECRUITER";
  }
}

/**
 * The role a member should have after a Clerk membership event.
 *
 * This is the rule that makes one shared `org:member` key safe. Clerk delivers
 * webhooks at-least-once and OUT OF ORDER, so `organizationMembership.created`
 * routinely lands after `organizationInvitation.accepted` has already written
 * the real role. Naively mapping the incoming Clerk role would then downgrade
 * every invited viewer to a recruiter — silently granting write access to the
 * one role that exists specifically not to have it.
 *
 * So:
 *
 *   `org:admin`  is UNAMBIGUOUS and always wins. It can only mean ADMIN, and a
 *                promotion or demotion in Clerk must take effect.
 *   `org:member` is AMBIGUOUS — RECRUITER or VIEWER, Clerk cannot say which —
 *                so it never overwrites a role we already hold. The one
 *                exception is a member who WAS an admin: `org:member` then
 *                represents a real demotion, and lands on RECRUITER.
 *
 * `existing` is null for a member row that does not exist yet.
 */
export function resolveMemberRole(
  clerkRole: string | null | undefined,
  existing: OrgRole | null,
): OrgRole {
  if (mapClerkRole(clerkRole) === "ADMIN") return "ADMIN";

  // Incoming is `org:member`. A brand-new member defaults to RECRUITER, and a
  // demoted admin becomes one; anything else keeps the role it already has.
  if (existing === null || existing === "ADMIN") return "RECRUITER";

  return existing;
}

/**
 * Where the real role rides along on a Clerk invitation.
 *
 * A single constant because it is written in `inviteMember` and read in the
 * webhook, and a typo in either would be invisible: the invite would succeed
 * and the invitee would silently arrive as a RECRUITER.
 */
export const STAFFLY_ROLE_METADATA_KEY = "stafflyRole";

/** Display order for role pickers — most privileged last, least surprising. */
export const ROLE_ORDER: OrgRole[] = ["VIEWER", "RECRUITER", "ADMIN"];

export function parseRole(value: unknown): OrgRole | null {
  return value === "ADMIN" || value === "RECRUITER" || value === "VIEWER"
    ? value
    : null;
}
