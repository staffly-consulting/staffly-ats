"use client";

import { useMemo } from "react";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client, same Clerk-token-forwarding pattern as the server
 * one in `./server.ts`.
 *
 * The token has to be read from the live Clerk session on every request rather
 * than captured once, because Clerk rotates short-lived session JWTs. Hence the
 * hook: `session.getToken()` is called inside `accessToken`, per request, not at
 * construction time.
 *
 * RLS applies to everything this client does. If a query comes back empty, the
 * first thing to check is whether the user has an active organization — with no
 * `org_id` claim every policy fails closed.
 */
export function useSupabaseClient() {
  const { session } = useSession();

  return useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local.",
      );
    }

    return createClient(url, anonKey, {
      async accessToken() {
        return (await session?.getToken()) ?? null;
      },
    });
  }, [session]);
}
