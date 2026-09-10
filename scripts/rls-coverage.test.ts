/**
 * Asserts that no table in `public` is reachable from the internet.
 * Run: npm run test:rls
 *
 * Unlike the other test:* scripts this one needs a database — it reads the live
 * catalog on DATABASE_URL. Point it at staging or production; it only SELECTs.
 *
 * This exists because the protection it checks is invisible when it is missing.
 * A Prisma migration that adds a table emits no RLS and no grant of its own, so
 * the table inherits Supabase's defaults, and nothing anywhere fails: the app
 * works, the tests pass, the build is green, and the table is world-readable
 * until someone happens to read the advisor page. That is how
 * `_prisma_migrations` sat open — see the rls_hardening migration.
 *
 * A lint over the migration SQL would have been cheaper and would have caught
 * less: it cannot see a table someone created in the Supabase SQL editor, and
 * that is a normal thing to do. So this asks the database instead.
 *
 * The three questions below are separate on purpose. RLS enabled with no policy
 * is deny-all and fine for bookkeeping tables; RLS enabled with no policy on a
 * tenant table means every query returns zero rows, which reads as "the feature
 * is broken" rather than "the migration is wrong". Both are worth naming.
 */
import "dotenv/config";
import { config } from "dotenv";

import { Client } from "pg";

// prisma.config.ts loads .env.local for the CLI; plain `tsx` does not.
config({ path: ".env.local" });

/**
 * Tables that are expected to have RLS enabled and NO policy — deny-all.
 *
 * Only bookkeeping belongs here. A table on this list is invisible to every
 * role except the owner, so putting tenant data on it would silently break
 * every Supabase-client read of it. Adding an entry should be a deliberate
 * decision, which is why the list is here and not inferred.
 */
const DENY_ALL_TABLES = new Set(["_prisma_migrations"]);

/** Roles PostgREST authenticates requests as. Neither may hold table grants. */
const EXPOSED_ROLES = ["anon", "authenticated"];

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL. Copy .env.local.example to .env.local, or run with DATABASE_URL set.",
    );
  }
  return url;
}

interface TableRow {
  table_name: string;
  rls_enabled: boolean;
  policy_count: number;
}

interface GrantRow {
  table_name: string;
  grantee: string;
  privileges: string;
}

interface DefaultAclRow {
  grantor: string;
  objtype: string;
  acl: string | null;
}

async function main() {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();

  try {
    const { rows: whoami } = await client.query<{
      current_user: string;
      current_database: string;
    }>("select current_user, current_database()");
    console.log(
      `\nDatabase: ${whoami[0].current_database} as ${whoami[0].current_user}\n`,
    );

    // ---- 1. Every table in public has RLS enabled -------------------------
    const { rows: tables } = await client.query<TableRow>(`
      select c.relname                as table_name,
             c.relrowsecurity         as rls_enabled,
             coalesce(p.n, 0)::int    as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join (
        select tablename, count(*) as n
        from pg_policies
        where schemaname = 'public'
        group by tablename
      ) p on p.tablename = c.relname
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
      order by c.relname
    `);

    console.log("RLS enabled on every table in public");
    check("public contains at least one table", tables.length > 0, {
      hint: "migrations may not have been applied to this database",
    });
    for (const t of tables) {
      check(`${t.table_name}: RLS enabled`, t.rls_enabled, {
        fix: `alter table public."${t.table_name}" enable row level security;`,
      });
    }

    // ---- 2. Tenant tables have a policy; deny-all tables do not ------------
    console.log("\nPolicy coverage");
    for (const t of tables) {
      const denyAll = DENY_ALL_TABLES.has(t.table_name);
      if (denyAll) {
        check(
          `${t.table_name}: deny-all, no policy (expected)`,
          t.policy_count === 0,
          {
            policies: t.policy_count,
            hint: "listed in DENY_ALL_TABLES but has policies — is it tenant data now?",
          },
        );
      } else {
        check(`${t.table_name}: has at least one policy`, t.policy_count > 0, {
          hint: "RLS with no policy denies every row to non-owners. Add a tenant policy, or add the table to DENY_ALL_TABLES if that is intended.",
        });
      }
    }

    // ---- 3. No exposed role holds a grant in public ------------------------
    //
    // The real boundary. RLS narrows what a role can reach; the grant is what
    // lets it reach anything at all. With no grant, a PostgREST request is
    // refused before a policy is ever consulted.
    const { rows: grants } = await client.query<GrantRow>(
      `
      select table_name,
             grantee,
             string_agg(distinct privilege_type, ', ' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee = any($1::text[])
      group by table_name, grantee
      order by table_name, grantee
      `,
      [EXPOSED_ROLES],
    );

    console.log("\nNo table grants held by anon / authenticated");
    check(
      "no grants in public for anon or authenticated",
      grants.length === 0,
      grants.map((g) => `${g.grantee} -> ${g.table_name} (${g.privileges})`),
    );

    // ---- 4. The default is inverted, so the next table is safe too ---------
    //
    // Without this, everything above is true only until the next migration.
    //
    // Default privileges are keyed to the role that CREATES the object, so only
    // the creating role's entry can re-expose a table we are about to add. That
    // role is whoever runs the migrations — `postgres`, via DIRECT_URL.
    //
    // Supabase also ships an entry owned by `supabase_admin` granting anon and
    // authenticated on tables. It is NOT actionable and NOT a finding here:
    // `postgres` is not a member of `supabase_admin`, so the revoke is refused,
    // and the entry only applies to tables `supabase_admin` itself creates —
    // Supabase's own platform objects, which we neither create nor own. Failing
    // the build on a row nobody can change trains people to ignore the output,
    // so it is reported as a note instead.
    const { rows: defaults } = await client.query<DefaultAclRow>(`
      select pg_get_userbyid(d.defaclrole) as grantor,
             d.defaclobjtype::text         as objtype,
             array_to_string(d.defaclacl, ' | ') as acl
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public'
    `);

    const exposesTables = (d: DefaultAclRow) =>
      d.objtype === "r" &&
      EXPOSED_ROLES.some((role) => (d.acl ?? "").includes(`${role}=`));

    const migrationRole = whoami[0].current_user;
    const leakyDefaults = defaults.filter(
      (d) => exposesTables(d) && d.grantor === migrationRole,
    );
    const foreignDefaults = defaults.filter(
      (d) => exposesTables(d) && d.grantor !== migrationRole,
    );

    console.log("\nDefault privileges do not re-expose new tables");
    check(
      `no default table privileges granted to anon or authenticated by ${migrationRole}`,
      leakyDefaults.length === 0,
      leakyDefaults.map((d) => `granted by ${d.grantor}: ${d.acl}`),
    );
    for (const d of foreignDefaults) {
      console.log(
        `  note ${d.grantor} grants anon/authenticated on tables it creates — not ours to revoke, and it does not apply to tables ${migrationRole} creates`,
      );
    }

    // ---- 5. The claim helper is still there and still pinned --------------
    //
    // Every tenant policy routes through it, and a mutable search_path on a
    // SECURITY-relevant function is its own Supabase advisor warning.
    const { rows: fn } = await client.query<{
      proconfig: string[] | null;
    }>(`
      select p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'staffly_org_id'
    `);

    console.log("\nClaim helper");
    check("public.staffly_org_id() exists", fn.length === 1);
    check(
      "public.staffly_org_id() pins search_path",
      fn.length === 1 &&
        (fn[0].proconfig ?? []).some((c) => c.startsWith("search_path=")),
      fn[0]?.proconfig ?? null,
    );
  } finally {
    await client.end();
  }

  console.log(
    failures === 0
      ? "\nAll RLS coverage checks passed.\n"
      : `\n${failures} RLS coverage check(s) FAILED.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("\nrls-coverage could not run:", error);
  process.exitCode = 1;
});
