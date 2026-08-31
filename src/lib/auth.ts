import { cache } from "react";
import { redirect } from "next/navigation";

import { auth, clerkClient } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import type { OrgMember, OrgRole } from "@prisma/client";

/**
 * The single sanctioned way to get the caller's tenant on the server.
 *
 * Prisma bypasses RLS (see `src/lib/prisma.ts`), so `orgId` from here is the
 * only thing standing between tenants. Never take an org id from a route param,
 * a form field, or a request body.
 */

export interface OrgContext {
  clerkUserId: string;
  orgId: string;
  /** Raw Clerk role string, e.g. `org:admin`. */
  clerkRole: string | null;
}

/**
 * Resolves the active Clerk user + organization, redirecting when either is
 * missing. Safe to call from server components, server actions and route
 * handlers that sit behind the middleware matcher.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // Signed in but no active organization: Clerk omits the org claim entirely,
  // which would make every scoped query silently return nothing. Send the user
  // somewhere that can explain the problem instead.
  if (!orgId) {
    redirect("/dashboard/select-org");
  }

  return { clerkUserId: userId, orgId, clerkRole: orgRole ?? null };
}

/**
 * Non-redirecting variant, for callers that must answer with a status code
 * rather than a `Location` header — i.e. every route handler under `/api`.
 *
 * `requireOrgContext()` redirects, which is right for a page but wrong for an
 * endpoint: `fetch` follows redirects by default, so the caller would receive
 * the sign-in page's HTML with a 200 and believe the request succeeded.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return null;
  return { clerkUserId: userId, orgId, clerkRole: orgRole ?? null };
}

/**
 * Maps a Clerk organization role to our `OrgRole` enum.
 *
 * Clerk ships `org:admin` and `org:member` by default and lets you define more.
 * Anything we do not recognise falls back to RECRUITER — the least privileged
 * role that can still do the job — rather than ADMIN.
 */
export function mapClerkRole(clerkRole: string | null | undefined): OrgRole {
  switch (clerkRole) {
    case "org:admin":
    case "admin":
      return "ADMIN";
    case "org:viewer":
    case "viewer":
      return "VIEWER";
    default:
      return "RECRUITER";
  }
}

/* -------------------------------------------------------------------------- */
/* Just-in-time tenant provisioning                                            */
/* -------------------------------------------------------------------------- */

/**
 * Creates the `Organization` and `OrgMember` rows from the live Clerk API when
 * they are missing, instead of waiting for the sync webhook.
 *
 * Why this exists, beyond local convenience:
 *
 *   - Webhook delivery is asynchronous. A user who accepts an invite and lands
 *     on the dashboard can arrive before `organizationMembership.created` does,
 *     and `JobPost.orgId` has a foreign key to `organizations` — so without a
 *     row, their first action fails.
 *   - Deliveries can fail or be dropped entirely (endpoint down, secret rotated
 *     mid-flight). Waiting for a retry means a user staring at a broken app.
 *   - Locally it removes the need to run the webhook relay at all for the
 *     common path.
 *
 * The webhook remains authoritative. This only ever *creates*: every upsert
 * below passes an empty `update`, so a row the webhook already wrote is left
 * exactly as it is. Renames, role changes and removals are things JIT cannot
 * observe — only the webhook sees those — so it must never overwrite them.
 *
 * Wrapped in React `cache()` so it runs at most once per request even though
 * both the dashboard layout and a server action may call it.
 */
const provisionTenant = cache(
  async (
    orgId: string,
    clerkUserId: string,
    clerkRole: string | null,
  ): Promise<OrgMember | null> => {
    // Fast path. A membership row can only exist if its organization does
    // (foreign key), so this single indexed lookup settles both.
    const existing = await prisma.orgMember.findUnique({
      where: { orgId_clerkUserId: { orgId, clerkUserId } },
    });
    if (existing) return existing;

    const client = await clerkClient();
    const [organization, user] = await Promise.all([
      client.organizations.getOrganization({ organizationId: orgId }),
      client.users.getUser(clerkUserId),
    ]);

    await prisma.organization.upsert({
      where: { id: orgId },
      create: { id: orgId, name: organization.name },
      update: {},
    });

    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;

    // `OrgMember.email` is non-nullable and we will not invent a placeholder —
    // a fake address would end up in recruiter-facing UI. A user with no email
    // (phone-only sign-up) simply gets no member row: the organization above is
    // what unblocks them, and `createdById` is nullable, so they lose only the
    // authorship link until the webhook supplies real data.
    if (!email) {
      console.warn(
        `[provisionTenant] no email address on Clerk user ${clerkUserId}; skipping OrgMember`,
      );
      return null;
    }

    const name =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null;

    return prisma.orgMember.upsert({
      where: { orgId_clerkUserId: { orgId, clerkUserId } },
      create: {
        orgId,
        clerkUserId,
        role: mapClerkRole(clerkRole),
        email,
        name,
      },
      // Empty: if the webhook won the race between the lookup above and here,
      // its data is the more authoritative of the two.
      update: {},
    });
  },
);

/**
 * Ensures the caller's tenant rows exist. Call this once per request, high up.
 *
 * Never throws: a Clerk API blip should degrade attribution, not blank the
 * dashboard. Anything genuinely broken (database unreachable) will surface from
 * the page's own queries with a clearer message.
 */
export async function ensureTenantProvisioned(
  orgId: string,
  clerkUserId: string,
  clerkRole: string | null,
): Promise<OrgMember | null> {
  try {
    return await provisionTenant(orgId, clerkUserId, clerkRole);
  } catch (error) {
    console.error(
      `[ensureTenantProvisioned] failed for org ${orgId} / user ${clerkUserId}`,
      error,
    );
    return null;
  }
}

/**
 * The `OrgMember` row for the current caller, provisioning it on the spot if
 * the webhook has not delivered yet. Returns null only when the member cannot
 * be represented (see the email note above).
 */
export async function getCurrentMember(
  context: OrgContext,
): Promise<OrgMember | null> {
  return ensureTenantProvisioned(
    context.orgId,
    context.clerkUserId,
    context.clerkRole,
  );
}
