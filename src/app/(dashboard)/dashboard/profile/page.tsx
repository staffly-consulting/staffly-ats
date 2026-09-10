import type { Metadata } from "next";

import { getLocale, getTranslations } from "next-intl/server";

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("profile") };
}

export const dynamic = "force-dynamic";

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
  const [t, tRole, locale] = await Promise.all([
    getTranslations("profile"),
    getTranslations("role"),
    getLocale(),
  ]);

  const [member, org, preferences] = await Promise.all([
    getCurrentMember(context),
    getOrgSettings(context.orgId),
    getUserPreferences(context.clerkUserId),
  ]);

  const displayName = member?.name ?? member?.email ?? t("yourAccount");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("detailsTitle")}</CardTitle>
          <CardDescription>{t("detailsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback>{initials(displayName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">
                {member?.email ?? t("noEmail")}
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("organization")}</span>
            <span className="font-medium">{org?.name ?? "—"}</span>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("roleHere")}</span>
            {member ? (
              <Badge variant="outline" className="text-muted-foreground">
                {tRole(member.role)}
              </Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("joined")}</span>
            <span className="tabular-nums">
              {member
                ? formatDate(member.createdAt.toISOString(), locale)
                : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      <LanguagePreference initialLanguage={preferences.preferredLanguage} />
    </div>
  );
}
