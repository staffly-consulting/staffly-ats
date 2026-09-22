"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { NAV_ITEMS } from "@/components/dashboard/nav-items";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function matches(pathname: string, href: string) {
  // "Job Posts" also owns the /dashboard/jobs subtree, which does not sit
  // underneath its own href.
  if (href === "/dashboard") {
    return pathname === href || pathname.startsWith("/dashboard/jobs");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Longest match wins, so /dashboard/settings/email highlights "Email
 * Connection" rather than lighting up "Settings" as well.
 */
function activeHref(pathname: string, hrefs: string[]): string | null {
  return (
    hrefs
      .filter((href) => matches(pathname, href))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

/**
 * Spinner on the link that was just clicked, until its page is on screen.
 * Must render inside the `<Link>`: `useLinkStatus` reads the nearest one.
 */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      aria-hidden
      className="ml-auto size-3.5 shrink-0 animate-spin text-muted-foreground"
    />
  );
}

export function SidebarNav({
  onNavigate,
  className,
}: {
  /** Lets the mobile sheet close itself when a link is tapped. */
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const current = activeHref(
    pathname,
    NAV_ITEMS.map((item) => item.href),
  );

  return (
    <nav className={cn("flex flex-col gap-0.5", className)}>
      {NAV_ITEMS.map((item) => {
        const active = item.href === current;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-disabled={item.comingSoon || undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar focus-visible:outline-none",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              item.comingSoon && "pointer-events-none opacity-55",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0 transition-colors",
                active ? "text-sidebar-primary" : "text-muted-foreground",
              )}
            />
            <span className="truncate">{t(item.labelKey)}</span>
            {item.comingSoon ? (
              <Badge
                variant="outline"
                className="ml-auto border-border/70 text-[10px] font-normal text-muted-foreground"
              >
                {tCommon("soon")}
              </Badge>
            ) : (
              <PendingIndicator />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
