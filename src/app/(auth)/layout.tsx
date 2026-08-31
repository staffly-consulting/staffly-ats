import { StafflyLogo } from "@/components/staffly-logo";

/**
 * Shell for the unauthenticated routes (`/sign-in`, `/sign-up`).
 *
 * Clerk's prebuilt components render their own card, so this layout only
 * supplies the page background and the wordmark above it — wrapping them in a
 * second bordered card would double up the chrome.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-muted/40 px-4 py-12">
      <StafflyLogo href="/" />
      {children}
    </div>
  );
}
