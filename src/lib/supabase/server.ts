import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for Clerk-authenticated callers.
 *
 * Supabase Auth is not used at all in this product — Clerk is the identity
 * provider, registered in Supabase as a third-party auth provider. The
 * `accessToken` callback hands Supabase the Clerk session JWT on every request,
 * and Supabase validates it against Clerk's JWKS. The `org_id` inside that
 * token is what the RLS policies read (see the RLS migration).
 *
 * This is *not* the main query layer. Prisma is. Reach for this client for
 * Supabase Storage (resume files) and, later, realtime — anything that has to
 * go through Supabase's own APIs.
 *
 * Because it authenticates as the `authenticated` role rather than the database
 * owner, RLS *is* enforced here. That is the point: it is the safe client.
 */
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local.",
    );
  }

  return createClient(url, anonKey, {
    async accessToken() {
      return (await auth()).getToken();
    },
  });
}

/**
 * Re-exported so existing imports keep working. The implementation lives in
 * `./service-role.ts` with no Clerk dependency — see the note there.
 */
export { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
