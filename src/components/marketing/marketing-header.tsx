import Link from "next/link";

import { StafflyLogo } from "@/components/staffly-logo";
import { Button } from "@/components/ui/button";

/**
 * Header for the pages a signed-out visitor can reach.
 *
 * Shared by the landing page and /pricing so the nav cannot end up listing
 * different destinations depending on which one you arrived at.
 *
 * The buttons point at /dashboard rather than /sign-in: `auth.protect()` in the
 * dashboard layout sends a signed-out visitor to sign-in and a signed-in one
 * straight through, so one href covers both without this component needing to
 * know who is looking.
 */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <StafflyLogo href="/" />
        <div className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing">Pricing</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
