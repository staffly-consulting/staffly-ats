import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { LanguagePreference } from "@/components/dashboard/language-preference";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getCurrentMember, requireOrgContext } from "@/lib/auth";
import { getOrgSettings } from "@/lib/org";
import { getUserPreferences } from "@/lib/preferences";
import { formatDate, initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Profile" };

export const dynamic = "force-dynamic";

const ROLE_LABELS = {
  ADMIN: "Admin",
  RECRUITER: "Recruiter",
  VIEWER: "Viewer",
} as const;

/**
 * Profile details for the signed-in account.
 *
 * Two kinds of thing live here and the page keeps them visibly apart:
 *
 *   - Identity (name, email, avatar) is owned by the sign-in provider. Shown
 *     read-only, because editing it here would be overwritten by the next sync.
 *   - Preferences are ours. Those are editable, and unlike everything else in
 *     the dashboard they are not scoped to an organization — they follow the
 *     person into whichever org they switch to.
 */
export default async function ProfilePage() {
  const context = await requireOrgContext();

  const [member, org, preferences] = await Promise.all([
    getCurrentMember(context),
    getOrgSettings(context.orgId),
    getUserPreferences(context.clerkUserId),
  ]);

  const displayName = member?.name ?? member?.email ?? "Your account";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Profile details"
        description="Your account, and the preferences that follow you between organizations."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          <CardDescription>
            Your name, email and password are managed from the account menu at
            the bottom of the sidebar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback>{initials(displayName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">
                {member?.email ?? "No email address on this account"}
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Organization</span>
            <span className="font-medium">{org?.name ?? "—"}</span>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Role here</span>
            {member ? (
              <Badge variant="outline" className="text-muted-foreground">
                {ROLE_LABELS[member.role]}
              </Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Joined</span>
            <span className="tabular-nums">
              {member ? formatDate(member.createdAt.toISOString()) : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      <LanguagePreference initialLanguage={preferences.preferredLanguage} />
    </div>
  );
}
