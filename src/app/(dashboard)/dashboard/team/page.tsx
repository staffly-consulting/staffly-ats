import type { Metadata } from "next";

import { Info, ShieldCheck } from "lucide-react";

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
import { formatDate, initials, pluralize } from "@/lib/utils";
import type { OrgRole } from "@prisma/client";

export const metadata: Metadata = { title: "Team" };

export const dynamic = "force-dynamic";

const ROLE_STYLES: Record<OrgRole, { label: string; className: string }> = {
  ADMIN: {
    label: "Admin",
    className: "border-brand/25 bg-brand/10 text-brand",
  },
  RECRUITER: {
    label: "Recruiter",
    className: "text-muted-foreground",
  },
  VIEWER: {
    label: "Viewer",
    className: "text-muted-foreground",
  },
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
  const members = await listOrgMembers(orgId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Team"
        description="Everyone with access to this organization. Use the organization switcher in the sidebar to invite or remove people."
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Roles are recorded here but{" "}
          <strong className="font-medium">not yet enforced</strong> — any member
          can currently create job posts and manage the email connection.
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {members.length} {pluralize(members.length, "member")}
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-55">Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-12 text-center">
                    <p className="text-sm font-medium">No members yet</p>
                    <p className="text-sm text-muted-foreground">
                      Invite people from the organization switcher in the
                      sidebar and they will appear here.
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
                                You
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
                        className={ROLE_STYLES[member.role].className}
                      >
                        {member.role === "ADMIN" ? (
                          <ShieldCheck className="size-3" />
                        ) : null}
                        {ROLE_STYLES[member.role].label}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {formatDate(member.joinedAt)}
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
