import { headers } from "next/headers";

import {
  clerkClient,
  type OrganizationJSON,
  type OrganizationMembershipJSON,
  type UserJSON,
  type WebhookEvent,
} from "@clerk/nextjs/server";
import { Webhook } from "svix";

import {
  STAFFLY_ROLE_METADATA_KEY,
  parseRole,
  resolveMemberRole,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deleteOrgObjects } from "@/lib/storage";

/**
 * Clerk -> Postgres sync.
 *
 * Clerk owns identity; this endpoint mirrors the parts we need to join against
 * (organizations and their members) into our own tables so that job posts and
 * candidates can carry foreign keys.
 *
 * Handled: organization.created / .updated / .deleted, user.updated,
 * organizationMembership.created / .updated / .deleted, and
 * organizationInvitation.accepted.
 *
 * Response contract, per Clerk's webhook spec:
 *   2xx — delivered; Clerk stops retrying.
 *   4xx — permanently rejected; Clerk stops retrying. Only for requests that
 *         can never succeed (bad signature, unparseable body).
 *   5xx — transient; Clerk retries with backoff. Database failures return 500
 *         on purpose so a blip does not silently drop a membership.
 *
 * Unhandled event types return 200: they were delivered fine, we just do not
 * care about them, and retrying would not change that.
 *
 * Delivery is at-least-once and NOT ordered. Every handler below is therefore
 * an upsert or an idempotent delete — replaying an event must be harmless, and
 * `organizationMembership.created` may well arrive before `organization.created`.
 */

function memberName(data: OrganizationMembershipJSON): string | null {
  const { first_name: first, last_name: last } = data.public_user_data;
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full === "" ? null : full;
}

/**
 * Clerk lists every address a user has verified; only the primary one is the
 * address we would actually write to. Falls back to the first address so a user
 * mid-way through changing their primary does not lose their email entirely.
 */
function primaryEmail(user: UserJSON): string | null {
  const primary = user.email_addresses.find(
    (address) => address.id === user.primary_email_address_id,
  );
  return (
    primary?.email_address ?? user.email_addresses[0]?.email_address ?? null
  );
}

function userFullName(user: UserJSON): string | null {
  const full = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return full === "" ? null : full;
}

/**
 * Clerk's membership payload nests the full organization, so a membership event
 * arriving first can still create the parent row. Without this, out-of-order
 * delivery would fail on the foreign key.
 */
async function ensureOrganization(organization: OrganizationJSON) {
  await prisma.organization.upsert({
    where: { id: organization.id },
    create: { id: organization.id, name: organization.name },
    update: { name: organization.name },
  });
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case "organization.created":
    case "organization.updated": {
      const { id, name } = event.data;
      await prisma.organization.upsert({
        where: { id },
        create: { id, name },
        // Only the name is mirrored. subscriptionTier and applicationQuota are
        // ours, not Clerk's — an update must not reset them to defaults.
        update: { name },
      });
      return;
    }

    case "organization.deleted": {
      const { id } = event.data;
      if (!id) {
        console.warn(
          "[clerk-webhook] organization.deleted with no id; ignoring",
        );
        return;
      }

      // Hard delete. There is no soft-delete pattern anywhere in this schema,
      // and inventing one here would leave two conventions for "gone". Every
      // child relation of Organization is `onDelete: Cascade`, so this one
      // statement removes members, job posts, candidates, scores, referrals,
      // university preferences and email inboxes.
      const existing = await prisma.organization.findUnique({
        where: { id },
        select: {
          name: true,
          _count: {
            select: { members: true, jobPosts: true, candidates: true },
          },
        },
      });

      if (!existing) {
        // Already gone — a replayed delivery, or an org we never synced.
        console.info(
          `[clerk-webhook] organization.deleted ${id}: no row to delete`,
        );
        return;
      }

      // Audit line BEFORE the delete: once the rows are gone there is nothing
      // left to describe what was removed.
      console.warn(
        `[clerk-webhook] deleting organization ${id} ("${existing.name}") — ` +
          `${existing._count.members} member(s), ${existing._count.jobPosts} job post(s), ` +
          `${existing._count.candidates} candidate(s), and all dependent rows`,
      );

      await prisma.organization.delete({ where: { id } });

      // Storage is outside the foreign-key graph, so the cascade does not reach
      // it. Leaving it would orphan every candidate's CV in the bucket
      // indefinitely — real people's personal data with no owner and no way to
      // reach it. Deleted after the rows, so a storage failure cannot leave the
      // database half-deleted.
      const removed = await deleteOrgObjects(id);
      console.warn(
        `[clerk-webhook] organization ${id}: removed ${removed} stored file(s)`,
      );
      return;
    }

    case "user.updated": {
      const user = event.data;
      const email = primaryEmail(user);
      const name = userFullName(user);

      if (!email) {
        console.warn(
          `[clerk-webhook] user.updated ${user.id} has no email address; leaving OrgMember rows unchanged`,
        );
        return;
      }

      // A user can belong to several orgs, so this is deliberately updateMany:
      // the same person's row exists once per membership and all of them go
      // stale together.
      const result = await prisma.orgMember.updateMany({
        where: { clerkUserId: user.id },
        data: { email, name },
      });

      console.info(
        `[clerk-webhook] user.updated ${user.id}: refreshed ${result.count} member row(s)`,
      );
      return;
    }

    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const data = event.data;
      const orgId = data.organization.id;
      const clerkUserId = data.public_user_data.user_id;
      // `identifier` is the user's primary email address for email-based sign-ups.
      const email = data.public_user_data.identifier;
      const name = memberName(data);

      await ensureOrganization(data.organization);

      // The role needs the CURRENT row to be resolved, because `org:member` is
      // ambiguous between RECRUITER and VIEWER — see `resolveMemberRole`. Read
      // first, then decide, rather than mapping the Clerk role blindly and
      // downgrading every viewer this event arrives for.
      const existing = await prisma.orgMember.findUnique({
        where: { orgId_clerkUserId: { orgId, clerkUserId } },
        select: { role: true },
      });

      const role = resolveMemberRole(data.role, existing?.role ?? null);

      await prisma.orgMember.upsert({
        where: { orgId_clerkUserId: { orgId, clerkUserId } },
        create: { orgId, clerkUserId, role, email, name },
        update: { role, email, name },
      });
      return;
    }

    case "organizationInvitation.accepted": {
      const data = event.data;
      const orgId = data.organization_id;
      const clerkUserId = data.user_id;

      // Anyone who joined by invitation belongs to a customer's organization
      // and must not spin up their own. Enforced by Clerk per user, so the
      // global "Allow user-created organizations" setting can stay on for
      // self-serve sign-ups. Before the role early-return below: a legacy
      // invitation without role metadata is still an invitation. Idempotent,
      // and a failure 500s so Clerk retries.
      const client = await clerkClient();
      await client.users.updateUser(clerkUserId, {
        createOrganizationEnabled: false,
      });

      // The whole point of this handler. Clerk's free tier has two org roles
      // and Staffly has three, so the role an admin actually chose travels in
      // the invitation's metadata rather than in the Clerk role — see
      // `CLERK_ROLE`. Without this event, every invited VIEWER would land as a
      // RECRUITER with write access.
      const role = parseRole(data.public_metadata?.[STAFFLY_ROLE_METADATA_KEY]);

      if (!role) {
        // An invitation created before this mechanism existed, or by hand in
        // the Clerk dashboard. The membership event will seed a role; nothing
        // to correct here.
        console.info(
          `[clerk-webhook] organizationInvitation.accepted ${data.id}: no ${STAFFLY_ROLE_METADATA_KEY} metadata; leaving role to the membership event`,
        );
        return;
      }

      // This event can beat `organizationMembership.created`, in which case the
      // organization row may not exist yet and the foreign key would fail. The
      // payload carries enough to create it; when it does not, the membership
      // event will, and an admin can correct the role on the Team page.
      if (data.public_organization_data?.name) {
        await prisma.organization.upsert({
          where: { id: orgId },
          create: { id: orgId, name: data.public_organization_data.name },
          update: {},
        });
      } else if (
        (await prisma.organization.count({ where: { id: orgId } })) === 0
      ) {
        console.warn(
          `[clerk-webhook] organizationInvitation.accepted ${data.id}: organization ${orgId} not synced yet; ${data.email_address} will default to RECRUITER until an admin sets their role`,
        );
        return;
      }

      // Authoritative for role. `update` sets it unconditionally: this event
      // states what an admin actually chose, which outranks anything the
      // ambiguous membership event may already have written.
      await prisma.orgMember.upsert({
        where: { orgId_clerkUserId: { orgId, clerkUserId } },
        create: {
          orgId,
          clerkUserId,
          role,
          email: data.email_address,
          // The invitation carries no name; `user.updated` and the membership
          // event both supply one later.
          name: null,
        },
        update: { role },
      });

      console.info(
        `[clerk-webhook] ${data.email_address} joined org ${orgId} as ${role}`,
      );
      return;
    }

    case "organizationMembership.deleted": {
      const data = event.data;
      const orgId = data.organization.id;
      const clerkUserId = data.public_user_data.user_id;

      // deleteMany rather than delete: `delete` throws when the row is already
      // gone, which a retried delivery guarantees.
      await prisma.orgMember.deleteMany({ where: { orgId, clerkUserId } });
      return;
    }

    default:
      // Delivered and intentionally ignored.
      return;
  }
}

export async function POST(request: Request) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

  if (!signingSecret) {
    // Our misconfiguration, not Clerk's bad request — 500 so deliveries are
    // retried once the secret is in place instead of being discarded.
    console.error("[clerk-webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const headerList = await headers();
  const svixId = headerList.get("svix-id");
  const svixTimestamp = headerList.get("svix-timestamp");
  const svixSignature = headerList.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix signature headers", { status: 400 });
  }

  // Signature is computed over the raw body — parse only after verifying.
  const payload = await request.text();

  let event: WebhookEvent;
  try {
    event = new Webhook(signingSecret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (error) {
    console.error("[clerk-webhook] signature verification failed", error);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (error) {
    // 500 so Clerk retries. A dropped membership event means a user who cannot
    // be attributed as the author of anything they create.
    console.error(
      `[clerk-webhook] failed to process ${event.type} (svix-id ${svixId})`,
      error,
    );
    return new Response("Failed to process webhook", { status: 500 });
  }

  return new Response(null, { status: 204 });
}
