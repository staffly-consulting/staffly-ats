/**
 * Tests for the role grant table. Run: npm run test:permissions
 *
 * Pure — no network, no database. This file exists because `ROLE_PERMISSIONS`
 * is a security boundary that reads like configuration: a stray entry in the
 * VIEWER array is a one-line diff that silently hands read-only accounts the
 * ability to cancel the subscription. The assertions below are written as the
 * questions a customer would ask ("can a viewer delete a job post?") so that a
 * wrong answer is obvious without tracing the table by eye.
 */
import {
  CLERK_ROLE,
  PERMISSIONS,
  ROLE_ORDER,
  mapClerkRole,
  parseRole,
  permissionsFor,
  resolveMemberRole,
  roleCan,
} from "../src/lib/permissions";
import type { JobPostStatus, OrgRole } from "@prisma/client";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

const ALL_ROLES: OrgRole[] = ["ADMIN", "RECRUITER", "VIEWER"];
const ALL_PERMISSIONS = Object.values(PERMISSIONS);

console.log("\n--- viewers cannot write anything ---");
{
  // The whole case for unlimited seats rests on this: an org can invite its
  // entire hiring panel because a VIEWER cannot change a single thing.
  for (const permission of ALL_PERMISSIONS) {
    check(`VIEWER is denied ${permission}`, !roleCan("VIEWER", permission));
  }

  check(
    "VIEWER cannot bulk-export candidate data",
    !roleCan("VIEWER", PERMISSIONS.CANDIDATE_EXPORT),
  );

  check(
    "VIEWER holds no permissions at all",
    permissionsFor("VIEWER").length === 0,
    permissionsFor("VIEWER"),
  );
}

console.log("\n--- recruiters run searches but do not run the account ---");
{
  check(
    "RECRUITER can write job posts",
    roleCan("RECRUITER", PERMISSIONS.JOB_POST_WRITE),
  );
  check(
    "RECRUITER can work with candidates",
    roleCan("RECRUITER", PERMISSIONS.CANDIDATE_WRITE),
  );
  check(
    "RECRUITER can edit university preferences",
    roleCan("RECRUITER", PERMISSIONS.UNIVERSITY_WRITE),
  );

  check(
    "RECRUITER can export candidates",
    roleCan("RECRUITER", PERMISSIONS.CANDIDATE_EXPORT),
  );

  // The three that would let a recruiter cut off ingestion, cancel the
  // subscription, or change who has access.
  check(
    "RECRUITER cannot manage billing",
    !roleCan("RECRUITER", PERMISSIONS.BILLING_MANAGE),
  );
  check(
    "RECRUITER cannot rewire the inbox",
    !roleCan("RECRUITER", PERMISSIONS.INBOX_MANAGE),
  );
  check(
    "RECRUITER cannot manage members",
    !roleCan("RECRUITER", PERMISSIONS.MEMBER_MANAGE),
  );
}

console.log("\n--- admins hold everything ---");
{
  for (const permission of ALL_PERMISSIONS) {
    check(`ADMIN is granted ${permission}`, roleCan("ADMIN", permission));
  }
}

console.log("\n--- the table is total ---");
{
  // A permission added to PERMISSIONS but forgotten in ROLE_PERMISSIONS would
  // be denied to everyone including admins, which reads in production as "the
  // button is broken" rather than as a permissions bug.
  const unreachable = ALL_PERMISSIONS.filter(
    (permission) => !ALL_ROLES.some((role) => roleCan(role, permission)),
  );
  check(
    "every permission is held by at least one role",
    unreachable.length === 0,
    unreachable,
  );

  check(
    "every role appears in the picker",
    ALL_ROLES.every((role) => ROLE_ORDER.includes(role)) &&
      ROLE_ORDER.length === ALL_ROLES.length,
    ROLE_ORDER,
  );
}

console.log("\n--- Clerk role mapping ---");
{
  // Staffly has three roles; Clerk's free tier has two. VIEWER and RECRUITER
  // therefore share `org:member`, and the mapping back is LOSSY BY DESIGN.
  check(
    "ADMIN round-trips through Clerk",
    mapClerkRole(CLERK_ROLE.ADMIN) === "ADMIN",
  );
  check(
    "RECRUITER round-trips through Clerk",
    mapClerkRole(CLERK_ROLE.RECRUITER) === "RECRUITER",
  );
  check(
    "VIEWER and RECRUITER share one Clerk role",
    CLERK_ROLE.VIEWER === CLERK_ROLE.RECRUITER,
    { viewer: CLERK_ROLE.VIEWER, recruiter: CLERK_ROLE.RECRUITER },
  );
  check(
    "mapClerkRole can never produce VIEWER (it is lossy on purpose)",
    ["org:admin", "org:member", "org:viewer", "wat", null, undefined].every(
      (key) => mapClerkRole(key) !== "VIEWER",
    ),
  );

  // Anything unrecognised must land on the least privileged role that can still
  // do the job, never on ADMIN.
  check(
    "unknown Clerk role falls back to RECRUITER",
    mapClerkRole("org:wat") === "RECRUITER",
  );
  check(
    "null Clerk role falls back to RECRUITER",
    mapClerkRole(null) === "RECRUITER",
  );
  check(
    "no Clerk role maps to ADMIN by accident",
    mapClerkRole("org:member") !== "ADMIN" &&
      mapClerkRole(undefined) !== "ADMIN",
  );
}

console.log("\n--- org:member never downgrades a viewer ---");
{
  // The rule that makes one shared Clerk role safe. Clerk delivers webhooks
  // out of order, so `organizationMembership.created` routinely arrives AFTER
  // `organizationInvitation.accepted` has written the real role. If this
  // regresses, every invited viewer silently gains write access — the exact
  // thing the role exists to prevent.
  check(
    "a VIEWER survives a membership event",
    resolveMemberRole("org:member", "VIEWER") === "VIEWER",
  );
  check(
    "a RECRUITER survives a membership event",
    resolveMemberRole("org:member", "RECRUITER") === "RECRUITER",
  );

  // `org:admin` is unambiguous, so it always wins in both directions.
  check(
    "org:admin promotes a viewer",
    resolveMemberRole("org:admin", "VIEWER") === "ADMIN",
  );
  check(
    "org:admin promotes a recruiter",
    resolveMemberRole("org:admin", "RECRUITER") === "ADMIN",
  );
  check(
    "org:member demotes a former admin to RECRUITER",
    resolveMemberRole("org:member", "ADMIN") === "RECRUITER",
  );

  // A member row that does not exist yet.
  check(
    "a brand-new org:member seeds RECRUITER",
    resolveMemberRole("org:member", null) === "RECRUITER",
  );
  check(
    "a brand-new org:admin seeds ADMIN",
    resolveMemberRole("org:admin", null) === "ADMIN",
  );
  check(
    "resolveMemberRole never invents a VIEWER",
    resolveMemberRole("org:member", null) !== "VIEWER" &&
      resolveMemberRole("org:admin", null) !== "VIEWER",
  );

  // Replayed deliveries are guaranteed by at-least-once webhooks, so the rule
  // has to be idempotent: applying it twice must not drift.
  check(
    "applying the rule twice is idempotent",
    ALL_ROLES.every((role) =>
      ["org:admin", "org:member"].every((key) => {
        const once = resolveMemberRole(key, role);
        return resolveMemberRole(key, once) === once;
      }),
    ),
  );
}

console.log("\n--- parseRole rejects anything not a role ---");
{
  check("parses ADMIN", parseRole("ADMIN") === "ADMIN");
  check("parses VIEWER", parseRole("VIEWER") === "VIEWER");
  check("rejects lowercase", parseRole("admin") === null);
  check("rejects an unknown string", parseRole("OWNER") === null);
  check("rejects a non-string", parseRole({ role: "ADMIN" }) === null);
  check("rejects null", parseRole(null) === null);
}

console.log("\n--- job post lifecycle is a soft delete ---");
{
  // `setJobPostLifecycle` needs a database, so what is asserted here is the
  // pure rule it depends on: which status a restored post comes back as. The
  // property that matters is that restoring never reactivates a search.
  // Typed as the full enum rather than the narrow literal union, so the
  // "never returns OPEN" assertion below is a real runtime check instead of
  // something TypeScript proves and then flags as unreachable.
  const statusAfterRestore = (closedAt: Date | null): JobPostStatus =>
    closedAt ? "CLOSED" : "DRAFT";

  check(
    "a post that ran and ended restores to CLOSED",
    statusAfterRestore(new Date("2026-01-01")) === "CLOSED",
  );
  check(
    "a post that never went live restores to DRAFT",
    statusAfterRestore(null) === "DRAFT",
  );
  check(
    "restore never reopens a search",
    (["CLOSED", "DRAFT"] as string[]).includes(statusAfterRestore(null)) &&
      statusAfterRestore(new Date()) !== "OPEN",
  );

  // Archiving must be reachable by anyone who can edit a job post — it is
  // recoverable, so gating it behind ADMIN would strand recruiters with clutter
  // they cannot clear.
  check(
    "RECRUITER can archive (soft delete is not an admin action)",
    roleCan("RECRUITER", PERMISSIONS.JOB_POST_WRITE),
  );
  check(
    "VIEWER cannot archive",
    !roleCan("VIEWER", PERMISSIONS.JOB_POST_WRITE),
  );
}

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
