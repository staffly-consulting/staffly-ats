-- =============================================================================
-- Closing the PostgREST surface
-- =============================================================================
--
-- Prompted by a Supabase advisor warning ("Table publicly accessible … Row-Level
-- Security is not enabled"). The ten application tables were already covered by
-- the RLS migrations; the table it was pointing at is `_prisma_migrations`,
-- which Prisma creates for its own bookkeeping and which no migration had ever
-- touched.
--
-- That table is not incidental. It is the ledger `prisma migrate deploy` reads
-- to decide what has already run. A caller who can delete a row from it can
-- make the next deploy replay a migration against a live database; a caller who
-- can insert one can make a pending migration be skipped. It holds no customer
-- data and is still the most dangerous unguarded table in the schema.
--
-- -----------------------------------------------------------------------------
-- Why it was reachable, and why one ALTER is not the fix
-- -----------------------------------------------------------------------------
--
-- Supabase ships default privileges that grant `anon` and `authenticated`
-- everything on tables the `postgres` role creates in `public`. Prisma connects
-- as `postgres` (DIRECT_URL), so every table it creates is born exposed and
-- stays that way until a hand-written migration says otherwise. The earlier RLS
-- migrations did say otherwise, table by table — but that is an opt-out list,
-- and `_prisma_migrations` is the proof that opt-out lists get forgotten. The
-- next `prisma migrate dev` that adds a table reintroduces the same hole, with
-- no error and no failing test.
--
-- So this migration does two things: it locks the table the advisor found, and
-- it inverts the default so the next one cannot happen.
--
-- -----------------------------------------------------------------------------
-- What this costs us today: nothing
-- -----------------------------------------------------------------------------
--
-- The `authenticated` grants added by the RLS migrations are currently unused.
-- Nothing in `src/` calls `createServerSupabaseClient()` or
-- `useSupabaseClient()` — the only Supabase traffic is Storage, through the
-- service-role client in `src/lib/supabase/service-role.ts`, and service_role is
-- a separate role this migration does not touch. Prisma is unaffected for the
-- same reason it always was: it connects as the table owner.
--
-- The RLS policies stay exactly as they are. They are no longer the only thing
-- standing between `anon` and the candidate table, which is the point — when the
-- realtime path the RLS migration anticipates actually gets built, re-opening a
-- table is one `grant` and the policy underneath it is already correct and
-- already tested (`scripts/rls-test.sql`).
--
-- -----------------------------------------------------------------------------
-- This migration must run as the table owner
-- -----------------------------------------------------------------------------
--
-- `alter default privileges` with no `for role` applies to the CURRENT role
-- only. It is written that way deliberately: the role running this is the role
-- Prisma creates tables as, so the revoke lands on exactly the default that
-- matters. Run through `npm run db:deploy` (DIRECT_URL, port 5432) and that is
-- `postgres`. Applied as anyone else it silently protects nothing —
-- `npm run test:rls` asserts the result rather than trusting it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table the advisor found
-- -----------------------------------------------------------------------------
--
-- RLS with no policy denies every row to every role except the owner, which
-- bypasses it (we do not set FORCE, same as the tenant tables). Prisma keeps
-- reading and writing its ledger; nobody else sees it exists.
--
-- Guarded on existence because the local harness in the README applies these
-- files with psql and never creates `_prisma_migrations`.

do $$
begin
  if to_regclass('public._prisma_migrations') is not null then
    execute 'alter table public._prisma_migrations enable row level security';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Revoke what the exposed roles hold now
-- -----------------------------------------------------------------------------
--
-- Guarded on role existence so the file still applies against a bare Postgres.
-- `scripts/supabase-local-stub.sql` creates both roles; a Supabase project has
-- them already.
--
-- Sequences are included for completeness. Prisma uses cuids here so there are
-- none today, but a future `@default(autoincrement())` would create one, and a
-- writable sequence is a small information leak (row counts) even with the table
-- itself locked.
--
-- Functions are deliberately NOT revoked. `public.staffly_org_id()` is called
-- from inside every RLS policy and evaluates with the privileges of the querying
-- role, so revoking EXECUTE from `authenticated` would turn each policy into a
-- permission error the day the Supabase client path is switched on.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then

    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';

    -- 3. Invert the default, so the NEXT table Prisma creates is born unreachable
    --    instead of born exposed. This is the line that stops the advisor
    --    warning from coming back.
    execute 'alter default privileges in schema public '
            'revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public '
            'revoke all on sequences from anon, authenticated';
  end if;
end
$$;

-- `usage on schema public` is left in place for `authenticated`. Without a grant
-- on any object inside it, schema usage reaches nothing, and dropping it would
-- break the re-grant path described above for no gain.

comment on function public.staffly_org_id() is
  'Active Clerk organization id from the request JWT, or NULL when the caller has no active org. Every tenant RLS policy routes through this so the claim shape is defined in exactly one place. Note that as of the rls_hardening migration no PostgREST-facing role holds table grants in public, so these policies are defence-in-depth rather than the live boundary — see that migration before granting anything back.';
