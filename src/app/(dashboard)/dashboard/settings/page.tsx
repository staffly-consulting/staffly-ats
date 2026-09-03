import type { Metadata } from "next";

import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Building2, Mail, Users } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatTile } from "@/components/dashboard/stat-tile";
import { BillingPanel } from "@/components/dashboard/billing-panel";
import { UniversityManager } from "@/components/dashboard/university-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireOrgContext } from "@/lib/auth";
import { getEmailInbox } from "@/lib/email-inbox";
import { checkFeature, getOrgBilling } from "@/lib/entitlements";
import { getOrgSettings } from "@/lib/org";
import { FEATURES } from "@/lib/plans";
import { isStripeConfigured } from "@/lib/stripe";
import { listUniversityPreferences } from "@/lib/universities";
import { formatDate } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("settings") };
}

export const dynamic = "force-dynamic";

/**
 * Org settings.
 *
 * Scoped to fields the schema actually holds — org name, tier, quota — rather
 * than inventing settings with nothing behind them. Name is read-only because
 * Clerk owns it: editing here would be overwritten by the next
 * `organization.updated` webhook.
 */
export default async function SettingsPage() {
  const { orgId } = await requireOrgContext();

  const [org, inbox, universities, billing, canManageUniversities] =
    await Promise.all([
      getOrgSettings(orgId),
      getEmailInbox(orgId),
      listUniversityPreferences(orgId),
      getOrgBilling(orgId),
      checkFeature(orgId, FEATURES.UNIVERSITY_PREFERENCES),
    ]);

  if (!org) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        description="Organization-level configuration. Sign-in and membership are managed from your account menu; everything below applies to this organization."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Members" value={org.counts.members} icon={Users} />
        <StatTile
          label="Job posts"
          value={org.counts.jobPosts}
          icon={Building2}
        />
        <StatTile
          label="Candidates"
          value={org.counts.candidates}
          icon={Mail}
          hint="See plan and usage below"
        />
      </div>

      {billing ? (
        <BillingPanel
          billing={billing}
          stripeConfigured={isStripeConfigured()}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization</CardTitle>
          <CardDescription>
            Change your organization name and membership from the organization
            switcher in the sidebar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{org.name}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Created</span>
            <span className="tabular-nums">{formatDate(org.createdAt)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email connection</CardTitle>
          <CardDescription>
            The address applications are forwarded to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inbox ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm">
                {inbox.forwardingAlias}
              </code>
              <Badge
                variant="outline"
                className={
                  inbox.isActive
                    ? "border-success/25 bg-success/12 text-success"
                    : "bg-muted text-muted-foreground"
                }
              >
                {inbox.isActive ? "Active" : "Disconnected"}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No forwarding address yet.
            </p>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/settings/email">
              Manage email connection
            </Link>
          </Button>
        </CardContent>
      </Card>

      <UniversityManager
        universities={universities}
        locked={!canManageUniversities}
      />
    </div>
  );
}
