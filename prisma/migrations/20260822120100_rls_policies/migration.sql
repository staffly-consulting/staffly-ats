-- =============================================================================
-- Row Level Security for Staffly ATS+
-- =============================================================================
--
-- READ THIS BEFORE CHANGING ANYTHING HERE. RLS failures are silent: a wrong
-- policy does not error, it just returns zero rows (or, worse, someone else's
-- rows). The model below is deliberately boring so it stays auditable.
--
-- -----------------------------------------------------------------------------
-- Two connection paths, two trust levels
-- -----------------------------------------------------------------------------
--
--   1. Prisma (`src/lib/prisma.ts`) connects as the database owner. In Postgres
--      the table owner BYPASSES RLS unless FORCE ROW LEVEL SECURITY is set, and
--      we deliberately do not set it. Prisma is the trusted server-side query
--      layer and is responsible for its own tenant scoping.
--      => Every Prisma query MUST filter on orgId itself. See
--         `src/lib/auth.ts` (`requireOrgContext`) — it is the only sanctioned
--         way to obtain the orgId used in those filters.
--
--   2. The Supabase client (`src/lib/supabase/*.ts`) connects as the
--      `authenticated` role carrying a Clerk-issued JWT. RLS is the ONLY thing
--      protecting those queries, which is what everything below is for. This
--      path is used for Storage and (later) realtime.
--
-- -----------------------------------------------------------------------------
-- Where the org id comes from
-- -----------------------------------------------------------------------------
--
-- Clerk session tokens (v2, current) nest the active organization under an `o`
-- claim: {"o": {"id": "org_123", "rol": "admin", "slg": "acme"}}.
-- Older Clerk tokens (v1, and the deprecated Supabase JWT template) put it in a
-- flat `org_id` claim instead. `staffly_org_id()` accepts both so that rotating
-- Clerk's token version does not silently empty every table.
--
-- IMPORTANT: if the user has no active organization, Clerk omits the claim
-- entirely and this returns NULL. `NULL = anything` is NULL, not TRUE, so every
-- policy below fails closed. That is intentional — a user outside an org sees
-- nothing rather than everything.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Claim helper
-- -----------------------------------------------------------------------------

create or replace function public.staffly_org_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    -- Clerk session token v2: {"o": {"id": "org_..."}}
    nullif(auth.jwt() -> 'o' ->> 'id', ''),
    -- Clerk session token v1 / legacy JWT template: {"org_id": "org_..."}
    nullif(auth.jwt() ->> 'org_id', '')
  );
$$;

comment on function public.staffly_org_id() is
  'Active Clerk organization id from the request JWT, or NULL when the caller has no active org. Every tenant RLS policy routes through this so the claim shape is defined in exactly one place.';

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
--
-- RLS narrows what a role can reach; it does not grant access on its own. These
-- tables were created by Prisma rather than through the Supabase SQL editor, so
-- Supabase's default grants may not have applied to them. Grant explicitly.
--
-- `anon` (unauthenticated) is granted nothing at all: there is no public
-- surface in this product, so it fails at the privilege layer before RLS is
-- even consulted.
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.organizations,
  public.org_members,
  public.job_posts,
  public.university_preferences,
  public.email_inboxes,
  public.candidates,
  public.referrals,
  public.candidate_scores
to authenticated;

revoke all on
  public.organizations,
  public.org_members,
  public.job_posts,
  public.university_preferences,
  public.email_inboxes,
  public.candidates,
  public.referrals,
  public.candidate_scores
from anon;

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------
-- Enabling with no policy denies everything by default; the policies follow.

alter table public.organizations          enable row level security;
alter table public.org_members            enable row level security;
alter table public.job_posts              enable row level security;
alter table public.university_preferences enable row level security;
alter table public.email_inboxes          enable row level security;
alter table public.candidates             enable row level security;
alter table public.referrals              enable row level security;
alter table public.candidate_scores       enable row level security;

-- -----------------------------------------------------------------------------
-- Policies
-- -----------------------------------------------------------------------------
--
-- One policy per table, `for all`, so there is a single rule to read per table
-- instead of four that can drift apart.
--
--   USING      — gates which existing rows SELECT / UPDATE / DELETE can see.
--   WITH CHECK — gates the resulting row of INSERT / UPDATE, which is what stops
--                a caller writing a row stamped with somebody else's org id.
--
-- Both clauses are required. A policy with only USING lets a caller INSERT rows
-- into another tenant (they just cannot read them back), which is worse than
-- useless.
--
-- Column names are quoted because Prisma emits camelCase identifiers; unquoted
-- `orgId` would fold to `orgid` and fail to resolve.
-- -----------------------------------------------------------------------------

-- organizations: the tenant row itself, keyed by the Clerk org id.
create policy "organizations_tenant_isolation"
  on public.organizations
  for all
  to authenticated
  using ("id" = public.staffly_org_id())
  with check ("id" = public.staffly_org_id());

-- org_members: the membership roster. Note this exposes every member of the
-- caller's org to every other member, which is intended — the Team screen needs
-- it. Per-user restriction would be `"clerkUserId" = auth.jwt() ->> 'sub'`.
create policy "org_members_tenant_isolation"
  on public.org_members
  for all
  to authenticated
  using ("orgId" = public.staffly_org_id())
  with check ("orgId" = public.staffly_org_id());

create policy "job_posts_tenant_isolation"
  on public.job_posts
  for all
  to authenticated
  using ("orgId" = public.staffly_org_id())
  with check ("orgId" = public.staffly_org_id());

create policy "university_preferences_tenant_isolation"
  on public.university_preferences
  for all
  to authenticated
  using ("orgId" = public.staffly_org_id())
  with check ("orgId" = public.staffly_org_id());

-- email_inboxes: `forwardingAlias` is globally unique, so a caller could probe
-- for alias collisions across tenants via unique-violation errors. Acceptable —
-- aliases are random — but worth knowing before adding an alias lookup endpoint.
create policy "email_inboxes_tenant_isolation"
  on public.email_inboxes
  for all
  to authenticated
  using ("orgId" = public.staffly_org_id())
  with check ("orgId" = public.staffly_org_id());

create policy "candidates_tenant_isolation"
  on public.candidates
  for all
  to authenticated
  using ("orgId" = public.staffly_org_id())
  with check ("orgId" = public.staffly_org_id());

-- referrals and candidate_scores have no orgId column of their own, so tenancy
-- is derived through the parent candidate.
--
-- Note that `candidates` RLS is still enforced inside these subqueries. That is
-- harmless here because the candidates policy applies the same org check, but
-- it means the explicit `c."orgId" = staffly_org_id()` below is doing real
-- work: it keeps the rule readable on its own and keeps these tables locked
-- down even if the candidates policy is later loosened.
--
-- If either table ever gets hot, denormalize orgId onto it rather than dropping
-- these subqueries.

create policy "referrals_tenant_isolation"
  on public.referrals
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.candidates c
      where c."id" = referrals."candidateId"
        and c."orgId" = public.staffly_org_id()
    )
  )
  with check (
    exists (
      select 1
      from public.candidates c
      where c."id" = referrals."candidateId"
        and c."orgId" = public.staffly_org_id()
    )
  );

create policy "candidate_scores_tenant_isolation"
  on public.candidate_scores
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.candidates c
      where c."id" = candidate_scores."candidateId"
        and c."orgId" = public.staffly_org_id()
    )
  )
  with check (
    exists (
      select 1
      from public.candidates c
      where c."id" = candidate_scores."candidateId"
        and c."orgId" = public.staffly_org_id()
    )
  );

-- -----------------------------------------------------------------------------
-- Verifying this works
-- -----------------------------------------------------------------------------
--
-- Impersonate a Clerk-authenticated caller in the SQL editor:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"user_1","o":{"id":"org_A"},"role":"authenticated"}';
--   select public.staffly_org_id();          -- expect: org_A
--   select count(*) from public.job_posts;   -- expect: only org_A's posts
--
--   set local request.jwt.claims = '{"sub":"user_1","role":"authenticated"}';
--   select count(*) from public.job_posts;   -- expect: 0 (no active org)
--
-- Reset with `reset role;`. Run this inside a transaction you roll back.
-- -----------------------------------------------------------------------------
