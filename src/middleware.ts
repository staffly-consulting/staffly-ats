import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Establishes Clerk's auth context for every request so that `auth()` works in
 * server components, server actions and route handlers.
 *
 * It deliberately does NOT decide what is protected. Clerk 7 deprecated
 * `createRouteMatcher` for exactly the reason it warns about: middleware
 * matching is path-string matching, which can drift from how Next.js actually
 * resolves routes and leave a protected resource reachable. Authorization lives
 * next to the data instead:
 *
 *   - `src/app/(dashboard)/layout.tsx` calls `auth.protect()`, covering every
 *     route in the group including ones that render no data of their own.
 *   - `requireOrgContext()` (`src/lib/auth.ts`) re-establishes the tenant in
 *     each page, action and query.
 *
 * Webhook routes stay unauthenticated on purpose — they carry no Clerk session
 * and authenticate by signature instead (svix for Clerk, a shared secret for
 * inbound email).
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // All routes except Next.js internals and static files, unless the path
    // carries a search param (so that _next/data style requests still run).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
