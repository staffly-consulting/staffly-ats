/**
 * Moves forwarding aliases onto the domain currently in INBOUND_EMAIL_DOMAIN.
 *
 * Run: npm run email:realias -- --list      (show what would change, default)
 *      npm run email:realias -- --apply     (actually rewrite them)
 *
 * Why this has to exist: `EmailInbox.forwardingAlias` stores the whole address,
 * domain included, rather than rebuilding it from env on every read. That is the
 * right call — the address is a bearer token a recruiter has already pasted into
 * a Gmail forwarding rule, and it must not silently change under them when an
 * environment variable is edited. The cost is that a genuine domain change needs
 * a deliberate migration, which is this.
 *
 * The readable prefix and the random suffix are preserved; only the domain moves.
 * Keeping the suffix matters: it is the unguessable part, and regenerating it
 * would invalidate the address for no reason.
 *
 * Defaults to a dry run. Rewriting an alias BREAKS the sender's existing
 * forwarding rule until they update it, so nothing changes without --apply.
 */
import "dotenv/config";
import { config } from "dotenv";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// prisma.config.ts loads .env.local for the CLI; plain `tsx` does not.
config({ path: ".env.local" });

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing DATABASE_URL. Check .env.local.");
  }
  return url;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connectionString() }),
});

/** The local part is everything before the LAST "@" — addresses may contain one. */
function splitAlias(alias: string): { local: string; domain: string } | null {
  const at = alias.lastIndexOf("@");
  if (at <= 0 || at === alias.length - 1) return null;
  return { local: alias.slice(0, at), domain: alias.slice(at + 1) };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const target = process.env.INBOUND_EMAIL_DOMAIN?.trim();
  if (!target) {
    console.error(
      `\nINBOUND_EMAIL_DOMAIN is not set in .env.local.\n` +
        `Set it to your mail subdomain (e.g. "mail.yourdomain.com") first —\n` +
        `there is no correct domain to move these aliases to without it.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (target.includes("@") || target.startsWith(".")) {
    console.error(`\nINBOUND_EMAIL_DOMAIN looks wrong: "${target}"\n`);
    console.error(`Expected a bare domain, e.g. "mail.yourdomain.com".\n`);
    process.exitCode = 1;
    return;
  }

  const inboxes = await prisma.emailInbox.findMany({
    orderBy: { connectedAt: "asc" },
    select: {
      id: true,
      orgId: true,
      forwardingAlias: true,
      isActive: true,
      organization: { select: { name: true } },
    },
  });

  if (inboxes.length === 0) {
    console.log(
      `\nNo email inboxes exist yet — nothing to move.\n` +
        `New aliases will be created on ${target} automatically.\n`,
    );
    return;
  }

  const stale = inboxes.filter((inbox) => {
    const parts = splitAlias(inbox.forwardingAlias);
    return parts !== null && parts.domain !== target;
  });

  console.log(`\nTarget domain: ${target}`);
  console.log(
    `Inboxes: ${inboxes.length}, on the wrong domain: ${stale.length}\n`,
  );

  if (stale.length === 0) {
    console.log(`Every alias is already on ${target}. Nothing to do.\n`);
    return;
  }

  const planned: { id: string; from: string; to: string; org: string }[] = [];

  for (const inbox of stale) {
    const parts = splitAlias(inbox.forwardingAlias)!;
    planned.push({
      id: inbox.id,
      from: inbox.forwardingAlias,
      to: `${parts.local}@${target}`,
      org: inbox.organization.name,
    });
  }

  for (const change of planned) {
    console.log(`  ${change.org}`);
    console.log(`    from  ${change.from}`);
    console.log(`    to    ${change.to}`);
  }

  if (!apply) {
    console.log(
      `\nDry run — nothing was changed.\n` +
        `Re-run with --apply to rewrite these:\n\n` +
        `  npm run email:realias -- --apply\n`,
    );
    return;
  }

  // A collision here is essentially impossible (the random suffix is preserved),
  // but forwardingAlias is globally unique and a crash halfway would leave some
  // orgs moved and others not. One transaction, all or nothing.
  await prisma.$transaction(
    planned.map((change) =>
      prisma.emailInbox.update({
        where: { id: change.id },
        data: { forwardingAlias: change.to },
      }),
    ),
  );

  console.log(`\n${planned.length} alias(es) moved to ${target}.\n`);
  console.log(
    `IMPORTANT: anyone forwarding mail to an old address is now sending it\n` +
      `nowhere. Each org needs their forwarding rule updated to the new address,\n` +
      `which is shown on /dashboard/settings/email.\n`,
  );
}

main()
  .catch((error) => {
    console.error("\nRe-alias failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
