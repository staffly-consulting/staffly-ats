import type { Metadata } from "next";

import { Info, Clock, ShieldCheck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  InviteMemberDialog,
  MemberRowActions,
  RevokeInvitationButton,
} from "@/components/dashboard/team-management";
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
import { checkPermission, requireOrgContext } from "@/lib/auth";
import { listOrgMembers, listPendingInvitations } from "@/lib/org";
import { PERMISSIONS } from "@/lib/permissions";
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
 * The org roster, and — for admins — the controls to change it.
 *
 * The roster is read from our own `OrgMember` mirror; pending invitations come
 * live from Clerk, which is the only place they exist. Writes go to Clerk and
 * come back through the `organizationMembership.*` webhook, so this page never
 * writes membership itself and cannot race the sync.
 *
 * The management controls render only for `MEMBER_MANAGE`, and every action
 * behind them re-checks it. See `lib/permissions.ts` for the grant table.
 */
export default async function TeamPage() {
  const context = await requireOrgContext();
  const { orgId, clerkUserId } = context;

  const [t, tRole, tCommon, locale, canManage] = await Promise.all([
    getTranslations("team"),
    getTranslations("role"),
    getTranslations("common"),
    getLocale(),
    checkPermission(context, PERMISSIONS.MEMBER_MANAGE),
  ]);

  // Only admins can act on invitations, so only admins pay for the Clerk call.
  const [members, invitations] = await Promise.all([
    listOrgMembers(orgId),
    canManage ? listPendingInvitations(orgId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={canManage ? t("descriptionAdmin") : t("description")}
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {t.rich("rolesExplained", {
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
          {canManage ? <InviteMemberDialog /> : null}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-55">{t("columnMember")}</TableHead>
                <TableHead>{t("columnRole")}</TableHead>
                <TableHead className="text-right">
                  {t("columnJoined")}
                </TableHead>
                {canManage ? (
                  <TableHead className="w-12">
                    <span className="sr-only">{t("columnActions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={canManage ? 4 : 3}
                    className="py-12 text-center"
                  >
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

                    {canManage ? (
                      <TableCell className="text-right">
                        <MemberRowActions
                          memberId={member.id}
                          memberLabel={member.name ?? member.email}
                          role={member.role}
                          isSelf={member.clerkUserId === clerkUserId}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Rendered only when there is something to show: an empty "pending"
          panel on every visit reads as a broken feature rather than an idle one. */}
      {canManage && invitations.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Clock className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {t("pendingCount", { count: invitations.length })}
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-55">
                    {t("columnInvitee")}
                  </TableHead>
                  <TableHead>{t("columnRole")}</TableHead>
                  <TableHead className="text-right">
                    {t("columnExpires")}
                  </TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">{t("columnActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow
                    key={invitation.id}
                    className="hover:bg-transparent"
                  >
                    <TableCell className="font-medium">
                      {invitation.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={ROLE_STYLES[invitation.role]}
                      >
                        {tRole(invitation.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {formatDate(invitation.expiresAt, locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RevokeInvitationButton
                        invitationId={invitation.id}
                        email={invitation.email}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
