import { auth } from "@clerk/nextjs/server";

import {
  DesktopSidebar,
  MobileSidebar,
} from "@/components/dashboard/dashboard-sidebar";
import { StafflyLogo } from "@/components/staffly-logo";
import { ensureTenantProvisioned } from "@/lib/auth";

/**
 * Dashboard shell: fixed sidebar on desktop, slide-over below `lg`.
 *
 * This layout is the authentication boundary for the whole group. Clerk 7
 * deprecated middleware path-matching in favour of checking where the resource
 * is served, so `auth.protect()` runs here: it covers every route under
 * `(dashboard)`, including pages that render no data and would otherwise be
 * prerendered without ever consulting the session.
 *
 * Pages additionally call `requireOrgContext()`, which is what pins them to a
 * tenant. This layout only establishes *who* — not *which org*.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, orgId, orgRole } = await auth.protect();

  // Make sure this tenant exists in our database before any child page queries
  // it, rather than depending on the Clerk webhook having already arrived.
  //
  // Deliberately no redirect when `orgId` is missing: `/dashboard/select-org`
  // renders inside this layout, so redirecting here would loop forever. Pages
  // handle that case through `requireOrgContext()`.
  if (orgId) {
    await ensureTenantProvisioned(orgId, userId, orgRole ?? null);
  }

  return (
    <div className="min-h-svh bg-background">
      <DesktopSidebar />

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-sm lg:hidden">
        <MobileSidebar />
        <StafflyLogo />
      </header>

      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-350 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
