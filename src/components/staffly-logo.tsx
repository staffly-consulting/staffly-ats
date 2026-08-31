import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Wordmark for Staffly ATS+. The mark is an inline SVG so it inherits colour
 * from Tailwind classes instead of shipping an asset.
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
      <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-4"
          aria-hidden="true"
        >
          <path
            d="M5 15.5c1.1 1.6 3 2.5 5.2 2.5 3 0 4.8-1.3 4.8-3.3 0-4.3-9.4-2-9.4-6.3C5.6 6.3 7.6 5 10.6 5c2 0 3.7.7 4.8 2"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <circle cx="18" cy="17" r="2.4" fill="currentColor" />
        </svg>
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
