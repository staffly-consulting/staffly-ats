"use client";

import { useState } from "react";

import { UserButton } from "@clerk/nextjs";
import { Menu, Sparkles, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { StafflyLogo } from "@/components/staffly-logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The sidebar takes no org or user props: Clerk's `UserButton` reads the active
 * session directly on the client, so its state cannot drift from the session's.
 *
 * There is deliberately NO organization switcher here. Switching tenants from a
 * always-visible dropdown put a destructive-feeling action one stray click from
 * every page, and the active org is already named in the dashboard header and
 * on Settings. Users who genuinely belong to more than one organization switch
 * at `/dashboard/select-org`, which is also where `requireOrgContext()` sends
 * anyone whose session has no active org.
 */

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("nav");

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="px-1 pt-1">
        <StafflyLogo />
      </div>

      <Separator />

      <SidebarNav onNavigate={onNavigate} className="flex-1" />

      <div className="rounded-lg border border-border/70 bg-brand-subtle/60 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="size-3.5 text-brand" />
          {t("aiOn")}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("aiOnDescription")}
        </p>
      </div>

      <Separator />

      <div className="flex items-center gap-2.5 px-1 pb-1">
        <UserButton
          showName
          appearance={{
            elements: {
              rootBox: "w-full",
              userButtonTrigger: "w-full justify-start gap-2.5",
              userButtonBox: "flex-row-reverse justify-end gap-2.5",
              userButtonOuterIdentifier: "text-sm font-medium",
            },
          }}
        >
          {/* Preferences we own live on our own page, not in the provider's
              hosted modal — that modal can only edit identity fields it
              stores. Linking from here is what makes the two feel like one
              account rather than two. */}
          <UserButton.MenuItems>
            <UserButton.Link
              href="/dashboard/profile"
              label={t("profileDetails")}
              labelIcon={<UserRound className="size-4" />}
            />
          </UserButton.MenuItems>
        </UserButton>
      </div>
    </div>
  );
}

/** Fixed sidebar, desktop only. */
export function DesktopSidebar() {
  return (
    <aside
      className={cn(
        "hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block",
        "fixed inset-y-0 left-0 z-30",
      )}
    >
      <SidebarBody />
    </aside>
  );
}

/** Hamburger + slide-over, below the `lg` breakpoint. */
export function MobileSidebar() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden">
          <Menu className="size-5" />
          <span className="sr-only">{t("openNavigation")}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-0">
        <SheetTitle className="sr-only">{t("navigationLabel")}</SheetTitle>
        <SheetDescription className="sr-only">
          {t("navigationDescription")}
        </SheetDescription>
        <SidebarBody onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
