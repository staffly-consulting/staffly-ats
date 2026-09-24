import { inngest, type StafflyEvents } from "@/inngest/client";
import { checkSubscription } from "@/lib/entitlements";
import { extractResume, type ResumeSource } from "@/lib/extraction";
import { prisma } from "@/lib/prisma";
import { extractResumeText, supportsVisionFallback } from "@/lib/resume-text";
import { downloadObject } from "@/lib/storage";

/**
 * `candidate/created` → read the resume → populate `extractedData`.
 *
 * Step boundaries are chosen so each expensive or fallible thing retries on its
 * own: marking PROCESSING, downloading the file, parsing text, and the Claude
 * call are separate. A rate-limited API response re-runs only the model call,
 * not the download.
 *
 * Scoring is deliberately not here. This function ends at `EXTRACTED`.
 */

type CandidateCreated = StafflyEvents["candidate/created"];

/** Only these move forward; anything else has already been handled. */
const EXTRACTABLE_STATUSES = ["NEW", "PROCESSING", "ERROR"] as const;

export const extractResumeFunction = inngest.createFunction(
  {
    id: "extract-resume",
    name: "Extract resume data",
    // Transport hiccups shouldn't cost a candidate. Validation failures do not
    // reach here — they resolve to ERROR inside the step and return normally.
    retries: 3,
    concurrency: { key: "event.data.orgId", limit: 3 },
    // Per-org ceiling on model calls, independent of what triggered them.
    //
    // `concurrency` above paces work; it does not bound it — three at a time,
    // forever, is still unbounded spend. This is the bound. It sits below the
    // per-candidate cap in `candidate-actions.ts` because the two catch
    // different things: that one stops one candidate being re-run in a loop,
    // this one stops any single tenant becoming the whole Anthropic bill.
    //
    // Sized well above real ingestion — a busy agency forwarding a morning's
    // applications stays under it — so it only bites on a runaway.
    throttle: { key: "event.data.orgId", limit: 30, period: "1m" },
    triggers: [{ event: "candidate/created" }],
  },
  async ({ event, step, logger }) => {
    const { orgId, candidateId } = event.data as CandidateCreated;

    // -------------------------------------------------------------------
    // 0. No active subscription, no model call.
    //
    // Ingestion already checks this, but extraction is also reachable from
    // the retry action, and a subscription can lapse between the two. Checked
    // before the claim so the candidate keeps its status and can be retried
    // once the org reactivates.
    // -------------------------------------------------------------------
    const subscription = await step.run("check-subscription", () =>
      checkSubscription(orgId),
    );
    if (!subscription.active) {
      logger.warn(
        `[extract-resume] org ${orgId} has no active subscription (${subscription.reason}); not extracting ${candidateId}`,
      );
      return { skipped: "subscription-inactive" };
    }

    // -------------------------------------------------------------------
    // 1. Claim the candidate.
    // -------------------------------------------------------------------
    const claimed = await step.run("mark-processing", async () => {
      const candidate = await prisma.candidate.findFirst({
        where: { id: candidateId, orgId },
        select: { id: true, status: true, resumeFileUrl: true },
      });

      if (!candidate) return null;

      // A re-fired event for a candidate already extracted must not clobber it.
      if (
        !EXTRACTABLE_STATUSES.includes(
          candidate.status as (typeof EXTRACTABLE_STATUSES)[number],
        )
      ) {
        return { skip: candidate.status as string };
      }

      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { status: "PROCESSING" },
      });

      return { resumeFileUrl: candidate.resumeFileUrl };
    });

    if (!claimed) {
      logger.warn(
        `[extract-resume] candidate ${candidateId} not found in ${orgId}`,
      );
      return { skipped: "candidate-not-found" };
    }
    if ("skip" in claimed) {
      logger.info(
        `[extract-resume] candidate ${candidateId} is already ${claimed.skip}; nothing to do`,
      );
      return { skipped: claimed.skip };
    }

    const filename = claimed.resumeFileUrl.split("/").pop() ?? "resume.pdf";

    // -------------------------------------------------------------------
    // 2. Fetch the file and decide text-vs-vision.
    //
    // Both happen in one step: the file bytes are the input to the decision,
    // and passing megabytes of base64 between steps through Inngest's state
    // store would be wasteful.
    // -------------------------------------------------------------------
    const prepared = await step.run("prepare-resume-source", async () => {
      const file = await downloadObject(claimed.resumeFileUrl);
      const parsed = await extractResumeText(
        file.bytes,
        filename,
        file.contentType,
      );

      if (parsed.kind === "text") {
        return {
          source: { kind: "text" as const, text: parsed.text },
          via: `text layer${parsed.pages ? ` (${parsed.pages}p)` : ""}`,
          chars: parsed.text.length,
          // Already removed from `text` above. Carried out of the step so the
          // attempt can be recorded on the candidate — a resume that tried to
          // instruct the screener is something the recruiter should see, not
          // something we quietly clean up and forget.
          hidden: parsed.hidden?.summary ?? null,
        };
      }

      if (!supportsVisionFallback(filename, file.contentType)) {
        return {
          failure: `${parsed.reason}, and this file type cannot be sent to the model directly`,
        };
      }

      return {
        source: {
          kind: "pdf" as const,
          base64: Buffer.from(file.bytes).toString("base64"),
        },
        via: `document input (${parsed.reason})`,
        chars: 0,
        // The vision path needs no scan: text drawn invisibly is as invisible
        // to a model reading the rendered page as it is to a person.
        hidden: null,
      };
    });

    if ("failure" in prepared) {
      await step.run("mark-error-unreadable", () =>
        prisma.candidate.update({
          where: { id: candidateId },
          data: { status: "ERROR" },
        }),
      );
      await step.sendEvent("notify-unreadable", {
        name: "candidate/processing-failed",
        data: { orgId, candidateId, stage: "extraction" },
      });
      logger.error(
        `[extract-resume] cannot read ${filename} for ${candidateId}: ${prepared.failure}`,
      );
      return { status: "ERROR", reason: prepared.failure };
    }

    // Recorded before extraction runs, so the finding survives even if the
    // model call then fails and the candidate lands in ERROR.
    if (prepared.hidden) {
      await step.run("record-hidden-text", () =>
        prisma.candidate.updateMany({
          where: { id: candidateId, orgId },
          data: { hiddenTextFound: true, hiddenTextNote: prepared.hidden },
        }),
      );
      logger.warn(`[extract-resume] ${candidateId}: ${prepared.hidden}`);
    }

    logger.info(
      `[extract-resume] ${candidateId}: reading via ${prepared.via}${prepared.chars ? `, ${prepared.chars} chars` : ""}`,
    );

    // -------------------------------------------------------------------
    // 3. Call Claude.
    // -------------------------------------------------------------------
    const outcome = await step.run("call-claude", () =>
      extractResume(prepared.source as ResumeSource),
    );

    if (outcome.usage) {
      // Structured so cost per resume can be checked against the pricing model
      // without instrumenting anything else.
      logger.info("[extract-resume] usage", {
        candidateId,
        orgId,
        model: outcome.usage.model,
        attempts: outcome.usage.attempts,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        cacheReadTokens: outcome.usage.cacheReadTokens,
        estimatedCostUsd: Number(outcome.usage.estimatedCostUsd.toFixed(5)),
        via: prepared.via,
      });
    }

    if (!outcome.ok) {
      await step.run("mark-error", () =>
        prisma.candidate.update({
          where: { id: candidateId },
          data: { status: "ERROR" },
        }),
      );
      await step.sendEvent("notify-extraction-failed", {
        name: "candidate/processing-failed",
        data: { orgId, candidateId, stage: "extraction" },
      });
      // Logged loudly with the reason — a silent drop here means a candidate
      // that simply never appears, which nobody would notice.
      logger.error(
        `[extract-resume] extraction failed for ${candidateId} after ${outcome.usage?.attempts ?? "?"} attempt(s): ${outcome.error}`,
      );
      return { status: "ERROR", reason: outcome.error };
    }

    // -------------------------------------------------------------------
    // 4. Persist.
    // -------------------------------------------------------------------
    const assignedJobPostId = await step.run("save-extraction", async () => {
      const data = outcome.data;

      const updated = await prisma.candidate.update({
        where: { id: candidateId },
        data: {
          extractedData: data,
          // Only overwrite when the document actually gave us something. A null
          // from extraction means "the resume did not say", which is worse than
          // the envelope guess we already have.
          ...(data.fullName ? { name: data.fullName } : {}),
          ...(data.email ? { email: data.email } : {}),
          ...(data.phone ? { phone: data.phone } : {}),
          ...(data.nationality ? { nationality: data.nationality } : {}),
          status: "EXTRACTED",
        },
        select: { jobPostId: true },
      });

      return updated.jobPostId;
    });

    // Scoring needs both an extracted profile and an assigned job post. If the
    // candidate is already assigned, this was the last piece — hand off now.
    // Otherwise the assignment action fires the same event later.
    if (assignedJobPostId) {
      await step.sendEvent("enqueue-scoring", {
        name: "candidate/ready-for-scoring",
        data: { orgId, candidateId },
      });
    }

    logger.info(
      `[extract-resume] ${candidateId} extracted: ${outcome.data.skills.length} skills, ${outcome.data.workHistory.length} roles`,
    );

    return {
      status: "EXTRACTED",
      skills: outcome.data.skills.length,
      roles: outcome.data.workHistory.length,
      estimatedCostUsd: outcome.usage?.estimatedCostUsd ?? null,
    };
  },
);
