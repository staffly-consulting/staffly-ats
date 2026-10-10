import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Wordmark for Staffly ATS+. The mark is plain text in a tile, so it inherits
 * colour from Tailwind classes instead of shipping an asset.
 */
export function StafflyLogo({
  href = "/dashboard",
  className,
}: {
  href?: string | null;
  className?: string;
}) {
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-lg bg-brand text-sm leading-none font-bold text-brand-foreground shadow-sm"
      >
        S.
      </span>
      <span className="text-[15px]">
        Staffly<span className="text-brand"> ATS+</span>
      </span>
    </span>
  );

  if (!href) return content;

  return (
    <Link
      href={href}
      className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {content}
    </Link>
  );
}
