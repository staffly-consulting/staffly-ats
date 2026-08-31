import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const TABLES = [
  "organizations",
  "org_members",
  "job_posts",
  "university_preferences",
  "email_inboxes",
  "candidates",
  "referrals",
  "candidate_scores",
];

const rows = (
  await c.query(
    `
  select c.relname as table, c.relrowsecurity as rls,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)
  order by c.relname`,
    [TABLES],
  )
).rows;

console.log("table                     RLS    policies");
console.log("------------------------------------------");
for (const t of TABLES) {
  const r = rows.find((x) => x.table === t);
  console.log(
    `${t.padEnd(25)} ${r ? (r.rls ? "on " : "OFF") : "MISSING"}    ${r ? r.policies : "-"}`,
  );
}

const enums = (
  await c.query(
    `select t.typname, count(e.enumlabel) n from pg_type t join pg_enum e on e.enumtypid=t.oid group by 1 order by 1`,
  )
).rows;
console.log("\nenums:", enums.map((e) => `${e.typname}(${e.n})`).join(", "));

const fn = (
  await c.query(
    `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='staffly_org_id'`,
  )
).rowCount;
console.log("staffly_org_id():", fn ? "present" : "MISSING");

const grants = (
  await c.query(
    `
  select grantee, count(distinct table_name) tables
  from information_schema.role_table_grants
  where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated')
  group by grantee order by grantee`,
    [TABLES],
  )
).rows;
console.log(
  "grants:",
  grants.length
    ? grants.map((g) => `${g.grantee}=${g.tables} tables`).join(", ")
    : "none for anon/authenticated",
);

const mig = (
  await c.query(
    `select migration_name, finished_at is not null as ok from _prisma_migrations order by started_at`,
  )
).rows;
console.log(
  "\nmigrations:",
  mig.map((m) => `${m.migration_name}${m.ok ? " ✓" : " ✗"}`).join(", "),
);

const counts = (
  await c.query(
    `select (select count(*) from organizations) orgs, (select count(*) from org_members) members, (select count(*) from job_posts) posts`,
  )
).rows[0];
console.log("row counts:", counts);

await c.end();
