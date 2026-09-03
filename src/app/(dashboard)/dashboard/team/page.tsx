import type { Metadata } from "next";

import { Info, ShieldCheck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/dashboard/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOrgContext } from "@/lib/auth";
import { listOrgMembers } from "@/lib/org";
import { formatDate, initials } from "@/lib/utils";
import type { OrgRole } from "@prisma/client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("team") };
}

export const dynamic = "force-dynamic";

/** Colour only — the label comes from the `role` message namespace. */
const ROLE_STYLES: Record<OrgRole, string> = {
  ADMIN: "border-brand/25 bg-brand/10 text-brand",
  RECRUITER: "text-muted-foreground",
  VIEWER: "text-muted-foreground",
};

/**
 * The org roster, read from our own `OrgMember` mirror.
 *
 * Read-only on purpose. The identity provider owns membership: inviting,
 * removing and changing roles all happen in its hosted UI, reachable from the
 * org switcher in the sidebar. Building a parallel invite flow here would mean
 * two sources of truth for who is in an org, and the sync webhook would then be
 * racing our own writes.
 */
export default async function TeamPage() {
  const { orgId, clerkUserId } = await requireOrgContext();
  const [t, tRole, tCommon, locale] = await Promise.all([
    getTranslations("team"),
    getTranslations("role"),
    getTranslations("common"),
    getLocale(),
  ]);
  const members = await listOrgMembers(orgId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {t.rich("rolesNotEnforced", {
            strong: (chunks) => (
              <strong className="font-medium">{chunks}</strong>
            ),
          })}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {t("memberCount", { count: members.length })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-55">{t("columnMember")}</TableHead>
                <TableHead>{t("columnRole")}</TableHead>
                <TableHead className="text-right">{t("columnJoined")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-12 text-center">
                    <p className="text-sm font-medium">{t("emptyTitle")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("emptyDescription")}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                members.map((member) => (
                  <TableRow key={member.id} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8">
                          <AvatarFallback className="text-xs">
                            {initials(member.name ?? member.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">
                              {member.name ?? member.email}
                            </span>
                            {member.clerkUserId === clerkUserId ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-normal text-muted-foreground"
                              >
                                {tCommon("you")}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {member.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={ROLE_STYLES[member.role]}
                      >
                        {member.role === "ADMIN" ? (
                          <ShieldCheck className="size-3" />
                        ) : null}
                        {tRole(member.role)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {formatDate(member.joinedAt, locale)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
