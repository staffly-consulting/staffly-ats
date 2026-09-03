import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";

import { EmailConnection } from "@/components/dashboard/email-connection";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOrgContext } from "@/lib/auth";
import { getEmailInbox } from "@/lib/email-inbox";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("emailConnection") };
}

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const { orgId } = await requireOrgContext();
  const inbox = await getEmailInbox(orgId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Email connection"
        description="Applications reach Staffly by forwarding. Your organization gets a private address; anything sent to it is ingested and turned into candidate records."
      />

      <EmailConnection inbox={inbox} />
    </div>
  );
}
