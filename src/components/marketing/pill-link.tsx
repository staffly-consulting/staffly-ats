import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The marketing pages' call-to-action link.
 *
 * Separate from `ui/button` on purpose: these are larger, fully rounded and
 * come in tones the app never uses (white on the brand panel), and adding those
 * as button variants would offer them to every dashboard screen as well.
 */
const TONES = {
  /** The primary action on a light background. */
  brand:
    "bg-brand text-brand-foreground shadow-lg shadow-brand/25 hover:bg-brand/90",
  /** The secondary action on a light background. */
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  /** The header's sign-up button. */
  dark: "bg-foreground text-background hover:bg-foreground/85",
  /** The primary action on the brand panel. */
  light: "bg-white text-slate-950 hover:bg-white/90",
  /** The secondary action on the brand panel. */
  "outline-light": "border border-white/30 text-white hover:bg-white/10",
} as const;

const SIZES = {
  sm: "h-9 px-4 text-sm",
  lg: "h-12 px-6 text-base",
} as const;

export function PillLink({
  href,
  tone = "brand",
  size = "lg",
  className,
  children,
}: {
  href: string;
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}
