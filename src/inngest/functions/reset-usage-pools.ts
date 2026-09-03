import { inngest } from "@/inngest/client";
import { addOneMonth } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

/**
 * Daily cron: roll over any org whose monthly application pool has elapsed.
 *
 * The pool is MONTHLY, and that is a deliberate anti-abuse choice rather than a
 * cosmetic one. With an annual pool, a customer could pay for a single month of
 * Shortlist ($79), ingest the entire year's 1,800 applications inside it, and
 * cancel — collecting twelve months of quota for one month of revenue, at a
 * cost to us of roughly $55-90 in model calls. Monthly pooling caps a single
 * paid month's exposure at that month's allowance.
 *
 * Deliberately NOT driven by a Stripe webhook. An annually-billed org invoices
 * once per twelve pool cycles, so resetting on `invoice.paid` would leave them
 * stuck on their first month's allowance for a year. The anchor is ours; Stripe
 * has no opinion on it.
 *
 * The anchor advances from its own previous value, never from `now()`. Advancing
 * from now would push the reset date later on every run — a job that fires a few
 * hours late, thirty times, silently moves a customer's renewal date.
 */

export const resetUsagePoolsFunction = inngest.createFunction(
  {
    id: "reset-usage-pools",
    name: "Reset monthly application pools",
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
      // A pool is due when its anchor is at least a month old. The cutoff is
      // built by subtracting a month from now with the same clamping rule, so
      // month lengths cannot let an org skip a cycle.
      const cutoff = new Date(now);
      const day = cutoff.getUTCDate();
      cutoff.setUTCDate(1);
      cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
      const daysInCutoffMonth = new Date(
        Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
      ).getUTCDate();
      cutoff.setUTCDate(Math.min(day, daysInCutoffMonth));

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
        // Normally one month. The loop covers an org whose anchor is several
        // cycles stale — a long-dormant account, or a cron that was off for a
        // while — landing them on the correct reset date rather than one month
        // after whenever the job happened to run.
        let anchor = new Date(org.anchorIso);
        let cyclesAdvanced = 0;
        while (addOneMonth(anchor) <= now) {
          anchor = addOneMonth(anchor);
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
          `advanced ${entry.cyclesAdvanced} month(s) to ${entry.newAnchor}`,
      );
    }

    return { reset: results.length, orgs: results };
  },
);
