\set ON_ERROR_STOP on

-- ---------- seed as owner (RLS bypassed, as Prisma would) ----------
insert into organizations (id, name, "updatedAt") values
  ('org_A', 'Alpha Co', now()), ('org_B', 'Beta Co', now());

insert into org_members (id, "orgId", "clerkUserId", role, email) values
  ('m_A', 'org_A', 'user_A', 'ADMIN', 'a@alpha.test'),
  ('m_B', 'org_B', 'user_B', 'ADMIN', 'b@beta.test');

insert into job_posts (id, "orgId", title, "mandatoryCriteria", "optionalCriteria", "updatedAt") values
  ('j_A', 'org_A', 'Alpha role', '[]'::jsonb, '[]'::jsonb, now()),
  ('j_B', 'org_B', 'Beta role',  '[]'::jsonb, '[]'::jsonb, now());

insert into university_preferences (id, "orgId", name) values
  ('u_A', 'org_A', 'Alpha U'), ('u_B', 'org_B', 'Beta U');

insert into email_inboxes (id, "orgId", "forwardingAlias") values
  ('e_A', 'org_A', 'alpha@apply.test'), ('e_B', 'org_B', 'beta@apply.test');

insert into candidates (id, "orgId", "jobPostId", "resumeFileUrl", "updatedAt") values
  ('c_A', 'org_A', 'j_A', 's3://a.pdf', now()),
  ('c_B', 'org_B', 'j_B', 's3://b.pdf', now());

insert into referrals (id, "candidateId", "referredById") values
  ('r_A', 'c_A', 'm_A'), ('r_B', 'c_B', 'm_B');

insert into candidate_scores (id, "candidateId", "jobPostId", "overallScore", breakdown, rationale) values
  ('s_A', 'c_A', 'j_A', 80, '[]'::jsonb, 'a'),
  ('s_B', 'c_B', 'j_B', 70, '[]'::jsonb, 'b');

\echo '===== TEST 1: caller in org_A (Clerk v2 token, o.id) ====='
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_A","role":"authenticated","o":{"id":"org_A","rol":"admin"}}';
select public.staffly_org_id() as resolved_org;
select 'organizations' t, count(*) from organizations
union all select 'org_members', count(*) from org_members
union all select 'job_posts', count(*) from job_posts
union all select 'university_preferences', count(*) from university_preferences
union all select 'email_inboxes', count(*) from email_inboxes
union all select 'candidates', count(*) from candidates
union all select 'referrals', count(*) from referrals
union all select 'candidate_scores', count(*) from candidate_scores
order by 1;
select 'leaked_rows' as check, count(*) from job_posts where "orgId" <> 'org_A';
rollback;

\echo '===== TEST 2: Clerk v1 token (flat org_id claim) ====='
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_B","role":"authenticated","org_id":"org_B"}';
select public.staffly_org_id() as resolved_org, (select title from job_posts) as only_visible_post;
rollback;

\echo '===== TEST 3: authenticated but no active org -> fails closed ====='
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_A","role":"authenticated"}';
select coalesce(public.staffly_org_id(), '<null>') as resolved_org;
select 'job_posts' t, count(*) from job_posts
union all select 'candidates', count(*) from candidates
union all select 'candidate_scores', count(*) from candidate_scores
union all select 'referrals', count(*) from referrals;
rollback;

\echo '===== TEST 4: cross-tenant INSERT must be rejected by WITH CHECK ====='
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_A","role":"authenticated","o":{"id":"org_A"}}';
\set ON_ERROR_STOP off
insert into job_posts (id, "orgId", title, "mandatoryCriteria", "optionalCriteria", "updatedAt")
values ('j_evil', 'org_B', 'stolen', '[]'::jsonb, '[]'::jsonb, now());
\set ON_ERROR_STOP on
rollback;

\echo '===== TEST 5: cross-tenant UPDATE/DELETE are no-ops ====='
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_A","role":"authenticated","o":{"id":"org_A"}}';
with u as (update job_posts set title = 'hijacked' where "orgId" = 'org_B' returning 1)
  select 'rows_updated_in_other_org' as check, count(*) from u;
with d as (delete from candidates where "orgId" = 'org_B' returning 1)
  select 'rows_deleted_in_other_org' as check, count(*) from d;
rollback;

\echo '===== TEST 6: anon role has no privileges at all ====='
begin;
set local role anon;
\set ON_ERROR_STOP off
select count(*) from job_posts;
\set ON_ERROR_STOP on
rollback;

\echo '===== TEST 7: owner (Prisma path) still sees everything ====='
select 'owner_sees_job_posts' as check, count(*) from job_posts;
