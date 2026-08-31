import "server-only";

import type { OrgRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Org-level reads for the Team and Settings screens.
 *
 * Everything here is synced from Clerk by the webhook — this is a read of our
 * mirror, not a call to Clerk. As everywhere, `orgId` is a required argument
 * because Prisma bypasses RLS.
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
