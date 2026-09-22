import { inngest, type StafflyEvents } from "@/inngest/client";
import {
  sendFailureDigest,
  type FailureDigestCandidate,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * `candidate/processing-failed` → one email to the org's admins.
 *
 * Batched rather than one email per failure. A single agency forwarding twenty
 * unreadable scans would otherwise send twenty emails in a minute, which is how
 * a notification becomes something people filter to trash. `batchEvents`
 * collects up to 5 failures per org over five minutes and sends one digest.
 *
 * Fired from the error paths of the extraction and scoring functions — never
 * from a request handler, so a send that hangs cannot slow a page down.
 */

type ProcessingFailed = StafflyEvents["candidate/processing-failed"];

export const notifyFailuresFunction = inngest.createFunction(
  {
    id: "notify-processing-failures",
    name: "Notify org of processing failures",
    retries: 2,
    batchEvents: {
      // Inngest's free plan caps batch size at 5 and rejects the whole app
      // sync above it. Raise once on a paid plan.
      maxSize: 5,
      // Inngest types this window in seconds only.
      timeout: "300s",
      // Per org: one tenant's burst must not delay another's notification.
      key: "event.data.orgId",
    },
    triggers: [{ event: "candidate/processing-failed" }],
  },
  async ({ events, step, logger }) => {
    // Filter rather than cast: a batch can also contain Inngest's own
    // `inngest/function.invoked` event when a run is triggered by hand, and its
    // payload has none of these fields.
    const batch = events
      .filter((event) => event.name === "candidate/processing-failed")
      .map((event) => event.data as ProcessingFailed);

    const orgId = batch[0]?.orgId;

    if (!orgId) return { skipped: "empty-batch" };

    const payload = await step.run("gather-recipients", async () => {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true },
      });

      // The org may have been deleted between the failure and this batch
      // firing — five minutes is long enough for that to happen.
      if (!org) return null;

      // Admins only. Sending an operational alert to every recruiter in a large
      // org is noise; admins are who can act on a systemic problem.
      const admins = await prisma.orgMember.findMany({
        where: { orgId, role: "ADMIN" },
        select: { email: true },
      });

      // Fall back to the whole team rather than sending nothing — an org whose
      // membership webhook has not synced roles yet would otherwise be silent
      // exactly when it most needs telling.
      const recipients =
        admins.length > 0
          ? admins.map((a) => a.email)
          : (
              await prisma.orgMember.findMany({
                where: { orgId },
                select: { email: true },
                take: 10,
              })
            ).map((m) => m.email);

      // Deduplicate: several candidate ids can arrive for the same person, and
      // a retried event can repeat one.
      const seen = new Set<string>();
      const candidateIds = batch
        .map((entry) => entry.candidateId)
        .filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

      // Re-read from the database rather than trusting the event payload: a
      // candidate that has since been retried successfully should not be
      // reported as failed.
      const rows = await prisma.candidate.findMany({
        where: { id: { in: candidateIds }, orgId, status: "ERROR" },
        select: {
          id: true,
          name: true,
          email: true,
          extractedData: true,
          jobPost: { select: { title: true } },
        },
      });

      const candidates: FailureDigestCandidate[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        stage:
          row.extractedData === null || row.extractedData === undefined
            ? "extraction"
            : "scoring",
        jobPostTitle: row.jobPost?.title ?? null,
      }));

      return {
        orgName: org.name,
        to: [...new Set(recipients)],
        candidates,
      };
    });

    if (!payload) {
      logger.info(`[notify-failures] org ${orgId} no longer exists; skipping`);
      return { skipped: "org-deleted" };
    }

    if (payload.candidates.length === 0) {
      logger.info(
        `[notify-failures] org ${orgId}: every candidate in the batch has since recovered`,
      );
      return { skipped: "all-recovered" };
    }

    const result = await step.run("send-digest", () =>
      sendFailureDigest({
        to: payload.to,
        orgName: payload.orgName,
        candidates: payload.candidates,
      }),
    );

    if (!result.ok) {
      if (result.skipped) {
        // Not configured. Log once and move on rather than retrying forever.
        logger.warn(
          `[notify-failures] not sent for org ${orgId}: ${result.error}`,
        );
        return { skipped: result.error };
      }
      // A real send failure — let the step retry.
      throw new Error(`Failed to send failure digest: ${result.error}`);
    }

    logger.info(
      `[notify-failures] org ${orgId}: told ${payload.to.length} admin(s) about ${payload.candidates.length} failure(s)`,
    );

    return {
      sent: true,
      recipients: payload.to.length,
      candidates: payload.candidates.length,
    };
  },
);
