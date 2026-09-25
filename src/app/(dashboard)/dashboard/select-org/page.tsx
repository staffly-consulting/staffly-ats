import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { OrganizationList } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

import { PageHeader } from "@/components/dashboard/page-header";
import { blockOrgCreationIfInvited } from "@/lib/org";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("selectOrg") };
}

export const dynamic = "force-dynamic";

/**
 * Landing spot for a signed-in user with no active organization.
 *
 * Staffly is org-scoped end to end: without an active org there is no `org_id`
 * claim, every RLS policy fails closed, and every Prisma query would need a
 * tenant it does not have. `requireOrgContext()` redirects here rather than
 * letting a page render an empty dashboard that looks like data loss.
 *
 * This page must never call `requireOrgContext()` itself — that would redirect
 * to itself forever.
 */
export default async function SelectOrgPage() {
  // Before render, so Clerk's list loads the user with creation already off.
  const { userId } = await auth();
  if (userId) await blockOrgCreationIfInvited(userId);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="Choose an organization"
        description="Staffly keeps every job post and candidate scoped to an organization. Pick one to continue. New organizations are created by Staffly, not here — ask your admin for an invitation if yours is missing."
      />
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl="/dashboard"
        afterCreateOrganizationUrl="/dashboard"
      />
    </div>
  );
}
