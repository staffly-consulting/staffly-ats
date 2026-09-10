import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The org's forwarding alias — the address an HR inbox forwards applications to.
 *
 * Connection is forwarding-only by decision; there is no OAuth mailbox access.
 * The alias is the whole tenancy mechanism on the inbound path: whatever arrives
 * at it belongs to the org that owns it, and nothing in the message body is
 * trusted to say otherwise.
 */

export function inboundDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN ?? "mail.stafflyconsulting.com";
}

/**
 * `Organization` has no slug column (Clerk owns identity, and the schema is
 * fixed), so the readable half of the alias is derived from the org name.
 */
function slugifyOrgName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 24)
    .replace(/^-|-$/g, "");
  return slug || "org";
}

/**
 * Random suffix, not a counter: the alias is effectively a bearer token. Anyone
 * who learns it can post applications into the org, so it should not be
 * guessable from the org name alone.
 */
function shortId(length = 8): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export interface EmailInboxSummary {
  id: string;
  forwardingAlias: string;
  provider: string;
  isActive: boolean;
  connectedAt: string;
  /** Candidates ingested through this org's alias so far. */
  ingestedCount: number;
  lastReceivedAt: string | null;
}

export async function getEmailInbox(
  orgId: string,
): Promise<EmailInboxSummary | null> {
  const inbox = await prisma.emailInbox.findFirst({
    where: { orgId },
    orderBy: { connectedAt: "desc" },
  });

  if (!inbox) return null;

  // Ingestion volume is a property of the org, not of the alias row — a
  // disconnect-and-reconnect should not appear to reset the history.
  const [ingestedCount, latest] = await Promise.all([
    prisma.candidate.count({ where: { orgId } }),
    prisma.candidate.findFirst({
      where: { orgId },
      orderBy: { ingestedAt: "desc" },
      select: { ingestedAt: true },
    }),
  ]);

  return {
    id: inbox.id,
    forwardingAlias: inbox.forwardingAlias,
    provider: inbox.provider,
    isActive: inbox.isActive,
    connectedAt: inbox.connectedAt.toISOString(),
    ingestedCount,
    lastReceivedAt: latest?.ingestedAt.toISOString() ?? null,
  };
}

/**
 * Creates the org's alias, or reactivates the existing one.
 *
 * Reconnecting deliberately keeps the same address: a recruiter has already
 * pasted it into a Gmail forwarding rule, and handing them a new one would
 * silently break that rule while looking like success.
 */
export async function connectEmailInbox(
  orgId: string,
  orgName: string,
): Promise<EmailInboxSummary> {
  const existing = await prisma.emailInbox.findFirst({ where: { orgId } });

  if (existing) {
    if (!existing.isActive) {
      await prisma.emailInbox.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return (await getEmailInbox(orgId))!;
  }

  const base = slugifyOrgName(orgName);

  // `forwardingAlias` is globally unique. Collisions are vanishingly unlikely
  // with a random suffix, but a retry loop is cheaper than a 500 to the user.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const alias = `${base}-${shortId()}@${inboundDomain()}`;
    const clash = await prisma.emailInbox.findUnique({
      where: { forwardingAlias: alias },
      select: { id: true },
    });
    if (clash) continue;

    await prisma.emailInbox.create({
      data: { orgId, forwardingAlias: alias, provider: "resend" },
    });
    return (await getEmailInbox(orgId))!;
  }

  throw new Error("Could not allocate a unique forwarding alias.");
}

/** Soft disconnect: stops ingestion, keeps the alias and all historical data. */
export async function disconnectEmailInbox(orgId: string): Promise<void> {
  await prisma.emailInbox.updateMany({
    where: { orgId },
    data: { isActive: false },
  });
}

/**
 * Resolves an inbound recipient address to the owning org.
 *
 * This is the tenancy decision for the entire ingestion path, so it is
 * deliberately strict: exact, lowercased alias match, and inactive inboxes do
 * not resolve. Returns null for anything unrecognised, which the webhook turns
 * into a logged 200 rather than a retry.
 */
export async function resolveInboxByAlias(alias: string) {
  return prisma.emailInbox.findFirst({
    where: { forwardingAlias: alias.trim().toLowerCase(), isActive: true },
    select: { id: true, orgId: true, forwardingAlias: true },
  });
}
