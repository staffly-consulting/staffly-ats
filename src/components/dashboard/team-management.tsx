"use client";

import { useState, useTransition } from "react";

import { Loader2, MailPlus, MoreHorizontal, UserMinus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  updateMemberRoleAction,
} from "@/app/(dashboard)/dashboard/team/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_ORDER } from "@/lib/permissions";
import { useVisiblePending } from "@/lib/use-visible-pending";
import type { OrgRole } from "@prisma/client";

/**
 * The write half of the Team page.
 *
 * Split from the page so the roster itself stays a server component — the table
 * is the part everyone sees, and it should not ship a client bundle to a viewer
 * who cannot use any of this.
 *
 * Every control here is rendered only for admins AND re-checked in the action.
 * The hiding is courtesy; `permissionError` in each action is the control.
 */

/* -------------------------------------------------------------------------- */
/* Invite                                                                      */
/* -------------------------------------------------------------------------- */

export function InviteMemberDialog() {
  const t = useTranslations("team");
  const tRole = useTranslations("role");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("RECRUITER");
  const [pending, startTransition] = useTransition();
  const showPending = useVisiblePending(pending);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await inviteMemberAction({ email, role });

      if (!result.ok) {
        toast.error(t("inviteFailed"), { description: result.error });
        return;
      }

      toast.success(t("inviteSent", { email }));
      setEmail("");
      setRole("RECRUITER");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MailPlus className="size-3.5 text-brand-foreground" />
          {t("invite")}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("inviteTitle")}</DialogTitle>
            <DialogDescription>{t("inviteDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{t("inviteEmailLabel")}</Label>
              <Input
                id="invite-email"
                type="email"
                required
                autoComplete="off"
                placeholder="colleague@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-role">{t("inviteRoleLabel")}</Label>
              <Select
                value={role}
                onValueChange={(next) => setRole(next as OrgRole)}
                disabled={pending}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_ORDER.map((option) => (
                    <SelectItem key={option} value={option}>
                      {tRole(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(`roleHint.${role}`)}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || email.trim() === ""}>
              {showPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {showPending ? t("inviteSending") : t("inviteSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Pending invitation row                                                      */
/* -------------------------------------------------------------------------- */

export function RevokeInvitationButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const t = useTranslations("team");
  const [pending, startTransition] = useTransition();
  const showPending = useVisiblePending(pending);

  function revoke() {
    startTransition(async () => {
      const result = await revokeInvitationAction(invitationId);
      if (!result.ok) {
        toast.error(t("revokeFailed"), { description: result.error });
        return;
      }
      toast.success(t("revoked", { email }));
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={revoke}
      disabled={pending}
      aria-label={t("revoke")}
    >
      {showPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <X className="size-3.5 text-danger" />
      )}
      {t("revoke")}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Member row actions                                                          */
/* -------------------------------------------------------------------------- */

export function MemberRowActions({
  memberId,
  memberLabel,
  role,
  isSelf,
}: {
  memberId: string;
  /** Name or email — whatever the row is showing, for the confirmation copy. */
  memberLabel: string;
  role: OrgRole;
  isSelf: boolean;
}) {
  const t = useTranslations("team");
  const tRole = useTranslations("role");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();
  const showPending = useVisiblePending(pending);

  function changeRole(next: string) {
    if (next === role) return;

    startTransition(async () => {
      const result = await updateMemberRoleAction(memberId, next);
      if (!result.ok) {
        toast.error(t("roleChangeFailed"), { description: result.error });
        return;
      }
      toast.success(
        t("roleChanged", {
          member: memberLabel,
          role: tRole(next as OrgRole),
        }),
      );
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeMemberAction(memberId);
      if (!result.ok) {
        toast.error(t("removeFailed"), { description: result.error });
        return;
      }
      toast.success(t("removed", { member: memberLabel }));
      setConfirmRemove(false);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={pending}
            aria-label={t("manageMember", { member: memberLabel })}
          >
            {showPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>{t("changeRole")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={role} onValueChange={changeRole}>
            {ROLE_ORDER.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {tRole(option)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          {/* Removing yourself is refused by the action anyway; not offering it
              is clearer than showing a control that always errors. */}
          {isSelf ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmRemove(true);
                }}
              >
                <UserMinus className="size-4" />
                {t("remove")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("removeDescription", { member: memberLabel })}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmRemove(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={remove}
              disabled={pending}
            >
              {showPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {showPending ? t("removing") : t("removeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
