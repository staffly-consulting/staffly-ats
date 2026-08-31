import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * Deliberately in its own module, with no Clerk import: this is the client
 * background work uses — the Inngest functions and the inbound-email webhook —
 * and none of them have a user session. Keeping it beside the session-bound
 * client in `./server.ts` meant every importer of `lib/storage.ts` dragged
 * Clerk's Next.js runtime in with it.
 *
 * Never import this into a component. Anything it touches is unguarded, so the
 * caller is responsible for scoping by org — in practice that means the
 * `{orgId}/` prefix on every storage key.
 */
export function createServiceRoleSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
