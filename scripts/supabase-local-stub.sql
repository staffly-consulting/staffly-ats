-- Minimal stand-in for the parts of a Supabase project the RLS migration relies on.
create role anon nologin;
create role authenticated nologin;

create schema if not exists auth;

-- Supabase's real definition, verbatim in spirit.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;

grant usage on schema auth to anon, authenticated;
