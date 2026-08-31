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
  label: string;
  icon: LucideIcon;
  /** Sections that exist as navigation but have no page behind them yet. */
  comingSoon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Job Posts", icon: Briefcase },
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard/issues", label: "Issues", icon: TriangleAlert },
  {
    href: "/dashboard/settings/email",
    label: "Email Connection",
    icon: Mail,
  },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];
