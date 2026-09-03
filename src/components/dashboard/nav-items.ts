import {
  Briefcase,
  Inbox,
  Mail,
  Settings,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  /** Key into the `nav` namespace, not display text — resolved in SidebarNav. */
  labelKey: string;
  icon: LucideIcon;
  /** Sections that exist as navigation but have no page behind them yet. */
  comingSoon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "jobPosts", icon: Briefcase },
  { href: "/dashboard/inbox", labelKey: "inbox", icon: Inbox },
  { href: "/dashboard/issues", labelKey: "issues", icon: TriangleAlert },
  {
    href: "/dashboard/settings/email",
    labelKey: "emailConnection",
    icon: Mail,
  },
  { href: "/dashboard/team", labelKey: "team", icon: Users },
  { href: "/dashboard/settings", labelKey: "settings", icon: Settings },
];
