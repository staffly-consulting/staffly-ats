import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

/**
 * Daily cron: roll over any org whose annual application pool has elapsed.
 *
 * Deliberately NOT driven by a Stripe webhook. The pool is annual regardless of
 * billing cadence, so a monthly-billed org invoices twelve times per pool cycle
 * — resetting on `invoice.paid` would hand them their full annual allowance
 * every month. The anchor is ours; Stripe has no opinion on it.
 *
 * The anchor advances from its own previous value, never from `now()`. Advancing
 * from now would push the anniversary later on every run — a job that fires a
 * few hours late, twenty times, silently moves a customer's renewal date.
 */

/** Anniversary of the anchor, one year on. */
function addOneYear(date: Date): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export const resetUsagePoolsFunction = inngest.createFunction(
  {
    id: "reset-usage-pools",
    name: "Reset annual application pools",
    retries: 3,
    // 03:00 UTC — outside the working day in most timezones we are likely to
    // serve, so a reset never lands mid-shift for a recruiter watching a
    // counter. Inngest v4 takes triggers inside the options object.
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step, logger }) => {
    const now = new Date();

    // Anything returned from a step is JSON round-tripped by Inngest, so Dates
    // come back as strings. Serialised explicitly here rather than relying on
    // that implicitly — the alternative is a `Date` that is secretly a string.
    const due = await step.run("find-due-pools", async () => {
      // A pool is due when the anchor is more than a year old. Expressed as
      // "anchor <= now - 1 year" so the comparison happens in SQL rather than
      // pulling every organization into memory.
      const cutoff = new Date(now);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);

      const rows = await prisma.organization.findMany({
        where: { poolCycleAnchor: { not: null, lte: cutoff } },
        select: {
          id: true,
          poolCycleAnchor: true,
          applicationsUsedInCycle: true,
        },
      });

      return rows.map((row) => ({
        id: row.id,
        anchorIso: row.poolCycleAnchor!.toISOString(),
        applicationsUsedInCycle: row.applicationsUsedInCycle,
      }));
    });

    if (due.length === 0) {
      logger.info("[reset-usage-pools] no pools due");
      return { reset: 0 };
    }

    const results = await step.run("reset-pools", async () => {
      const summary: {
        orgId: string;
        used: number;
        cyclesAdvanced: number;
        newAnchor: string;
      }[] = [];

      for (const org of due) {
        // Normally one year. The loop covers an org whose anchor is several
        // years stale — a long-dormant account, or a cron that was off for a
        // while — landing them on the correct anniversary rather than one year
        // after whenever the job happened to run.
        let anchor = new Date(org.anchorIso);
        let cyclesAdvanced = 0;
        while (addOneYear(anchor) <= now) {
          anchor = addOneYear(anchor);
          cyclesAdvanced += 1;
        }

        await prisma.organization.update({
          where: { id: org.id },
          data: { poolCycleAnchor: anchor, applicationsUsedInCycle: 0 },
        });

        summary.push({
          orgId: org.id,
          used: org.applicationsUsedInCycle,
          cyclesAdvanced,
          newAnchor: anchor.toISOString(),
        });
      }

      return summary;
    });

    for (const entry of results) {
      // An audit line per org: the closing usage figure is the last chance to
      // see what the cycle actually consumed before the counter goes to zero.
      logger.info(
        `[reset-usage-pools] org ${entry.orgId}: closed cycle at ${entry.used} applications, ` +
          `advanced ${entry.cyclesAdvanced} year(s) to ${entry.newAnchor}`,
      );
    }

    return { reset: results.length, orgs: results };
  },
);
