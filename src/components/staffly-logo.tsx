import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Wordmark for Staffly ATS+.
 *
 * The mark is `public/logo-mark.png`: `public/logo.png` trimmed of its padding
 * and resized, so the artwork fills its box at icon size. Regenerate it from
 * `logo.png` if the logo changes. The brand colour in `globals.css` is sampled
 * from the same file.
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
      {/* Decorative: the wordmark beside it already names the product. */}
      <Image
        src="/logo-mark.png"
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0"
      />
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
