/**
 * Puts an internal organization on the unlimited plan.
 *
 * Run: npm run seed:internal
 *      npm run seed:internal -- --org org_xxx      (a specific org)
 *      npm run seed:internal -- --list             (show orgs, change nothing)
 *
 * This is for organizations we own — our own workspace, demos, support
 * accounts. They are on ENTERPRISE, which in `lib/plans.ts` means no feature is
 * gated and the application pool never registers overage, so nothing here is
 * ever billed.
 *
 * Deliberately NOT wired into ingestion, the webhook, or any automatic path. An
 * org that grants itself unlimited usage should be a decision someone made on
 * purpose, at a terminal, not a code path a customer could reach.
 *
 * Idempotent: running it twice leaves the same state.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PLANS, subscriptionIsActive } from "../src/lib/plans";

/** Matched case-insensitively when no --org is given. */
const DEFAULT_INTERNAL_ORG_NAMES = ["staffly organization", "staffly"];

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL. Copy .env.local to .env, or run with DATABASE_URL set.",
    );
  }
  return url;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connectionString() }),
});

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const listOnly = process.argv.includes("--list");
  const explicitOrgId = arg("org");

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      planTier: true,
      applicationsUsedInCycle: true,
      poolCycleAnchor: true,
      stripeSubscriptionId: true,
      stripeSubscriptionStatus: true,
      requiresSubscription: true,
      _count: { select: { members: true, jobPosts: true, candidates: true } },
    },
  });

  if (orgs.length === 0) {
    console.log("No organizations exist yet. Sign in and create one first.");
    return;
  }

  if (listOnly) {
    console.log("\nOrganizations:\n");
    for (const org of orgs) {
      // `planTier` alone stopped telling the whole story once the paywall
      // landed: an ENTERPRISE org with no subscription is locked out unless
      // `requiresSubscription` is false. Both are printed so a blank screen can
      // be diagnosed from here rather than from the database.
      const access = subscriptionIsActive(org)
        ? "access: OK"
        : "access: LOCKED — no active subscription and requiresSubscription is true";

      console.log(
        `  ${org.id}\n    ${org.name}  ·  ${org.planTier}  ·  ` +
          `${org._count.members} member(s), ${org._count.jobPosts} job post(s), ${org._count.candidates} candidate(s)\n` +
          `    status: ${org.stripeSubscriptionStatus ?? "none"}  ·  ` +
          `requiresSubscription: ${org.requiresSubscription}  ·  ${access}`,
      );
    }
    console.log("");
    return;
  }

  const target = explicitOrgId
    ? orgs.find((org) => org.id === explicitOrgId)
    : orgs.find((org) =>
        DEFAULT_INTERNAL_ORG_NAMES.includes(org.name.trim().toLowerCase()),
      );

  if (!target) {
    console.error(
      explicitOrgId
        ? `\nNo organization with id ${explicitOrgId}.\n`
        : `\nNo organization matched ${DEFAULT_INTERNAL_ORG_NAMES.map((n) => `"${n}"`).join(" or ")}.\n` +
            `Pass one explicitly:  npm run seed:internal -- --org <id>\n` +
            `Or list them:         npm run seed:internal -- --list\n`,
    );
    process.exitCode = 1;
    return;
  }

  // A paying customer must never be silently switched to a free plan — that
  // would cancel their billing relationship from a script.
  if (target.stripeSubscriptionId) {
    console.error(
      `\nRefusing: ${target.name} (${target.id}) has an active Stripe subscription ` +
        `(${target.stripeSubscriptionId}).\nCancel it in Stripe first if this really is an internal org.\n`,
    );
    process.exitCode = 1;
    return;
  }

  // The tier alone no longer settles it. Since the paywall, an ENTERPRISE org
  // with `requiresSubscription: true` and no Stripe subscription is locked out
  // — the tier says "unlimited" while the gate says "pay first". Returning
  // early on the tier would leave that org broken with the script reporting
  // nothing to do, so the exemption is checked too.
  if (target.planTier === "ENTERPRISE" && !target.requiresSubscription) {
    console.log(
      `\n${target.name} (${target.id}) is already on ENTERPRISE and exempt from the paywall. Nothing to do.\n`,
    );
    return;
  }

  const updated = await prisma.organization.update({
    where: { id: target.id },
    data: {
      planTier: "ENTERPRISE",
      // Legacy free-text column, kept in step so the two never contradict.
      subscriptionTier: "enterprise",
      // The point of an internal org: exempt from the paywall entirely. Without
      // this the tier grants every feature while `subscriptionIsActive` denies
      // all of them, because there is no Stripe subscription behind it.
      requiresSubscription: false,
      // No Stripe subscription backs this, so there is no interval to record.
      billingInterval: null,
      // The pool still needs an anchor: the daily reset job only looks at orgs
      // that have one, and the usage panel renders "resets on…" from it. On
      // ENTERPRISE it never triggers overage, but leaving it null would make
      // this org invisible to the reset job forever.
      poolCycleAnchor: target.poolCycleAnchor ?? new Date(),
      applicationsUsedInCycle: 0,
    },
    select: { id: true, name: true, planTier: true, poolCycleAnchor: true },
  });

  const plan = PLANS[updated.planTier];
  console.log(`
  ${updated.name}
  ${updated.id}

    plan          ${updated.planTier}  (${plan.label})
    applications  unlimited — never registers overage
    job posts     ${plan.jobPostLimit ?? "unlimited"}
    inboxes       ${plan.inboxLimit}
    features      every gated feature unlocked
    billing       none — no Stripe subscription attached
    pool anchor   ${updated.poolCycleAnchor?.toISOString() ?? "none"}

  Usage counting still runs, so the ledger records what this org consumes —
  useful for knowing our own cost, without any of it being billable.
`);
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
