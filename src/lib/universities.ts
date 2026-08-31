import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Org-scoped university preference queries.
 *
 * As everywhere else, `orgId` is a required argument because Prisma bypasses
 * RLS — see `src/lib/prisma.ts`.
 */

export interface UniversityOption {
  id: string;
  name: string;
  tier: number;
}

export async function listUniversityPreferences(
  orgId: string,
): Promise<UniversityOption[]> {
  return prisma.universityPreference.findMany({
    where: { orgId },
    select: { id: true, name: true, tier: true },
    orderBy: [{ tier: "asc" }, { name: "asc" }],
  });
}

/**
 * Idempotent by (orgId, name): the table has a unique constraint on that pair,
 * so a recruiter quick-adding "MIT" twice gets the existing row back instead of
 * a unique-violation error in their face.
 */
export async function createUniversityPreference(
  orgId: string,
  name: string,
  tier: number,
): Promise<UniversityOption> {
  return prisma.universityPreference.upsert({
    where: { orgId_name: { orgId, name: name.trim() } },
    create: { orgId, name: name.trim(), tier },
    update: {},
    select: { id: true, name: true, tier: true },
  });
}

/**
 * Filters a list of ids down to the ones that actually belong to this org.
 *
 * The ids arrive from the client inside the form payload, so they are
 * attacker-controlled. Without this, a crafted request could stash another
 * tenant's university ids in a job post's JSON — not a data leak on its own,
 * but it would leak names once the summary panel resolved them.
 */
export async function filterOwnedUniversityIds(
  orgId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];

  const owned = await prisma.universityPreference.findMany({
    where: { orgId, id: { in: ids } },
    select: { id: true },
  });

  return owned.map((row) => row.id);
}
