import { inngest, type StafflyEvents } from "@/inngest/client";
import {
  MAX_ATTACHMENT_BYTES,
  classifyAttachment,
  safeFilename,
  type InboundAttachment,
} from "@/lib/inbound-email";
import { prisma } from "@/lib/prisma";
import { recordApplicationUsage } from "@/lib/usage";
import {
  rawEmailObjectPath,
  resumeObjectPath,
  uploadObject,
} from "@/lib/storage";

/**
 * `resume/received` → Supabase Storage + `Candidate` rows.
 *
 * Split into `step.run` blocks so each side effect retries independently: a
 * transient Storage failure re-runs the upload without re-creating rows, and a
 * database blip re-runs the insert without re-uploading the file. Inngest
 * memoizes completed steps, so ids allocated in one step stay stable across
 * retries of later ones — which is what keeps this from producing duplicate
 * candidates on a partial failure.
 *
 * Deliberately NOT done here: reading the file. Candidate name and email come
 * from the *envelope* (who sent the mail), not the resume. Parsing the document
 * is the AI extraction step.
 */

type ResumeReceived = StafflyEvents["resume/received"];

async function loadAttachmentBody(
  attachment: InboundAttachment,
): Promise<{ base64: string; bytes: number } | { error: string }> {
  if (attachment.content) {
    const bytes = Buffer.from(attachment.content, "base64").byteLength;
    if (bytes > MAX_ATTACHMENT_BYTES) {
      return { error: `too large after decode (${bytes} bytes)` };
    }
    return { base64: attachment.content, bytes };
  }

  if (!attachment.url) {
    return { error: "attachment has neither inline content nor a URL" };
  }

  // Some providers hand back a URL instead of inlining the body. Authenticate
  // when we have a key — a public URL simply ignores the header.
  const response = await fetch(attachment.url, {
    headers: process.env.RESEND_API_KEY
      ? { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
      : undefined,
  });

  if (!response.ok) {
    return { error: `download failed with ${response.status}` };
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) {
    return { error: `too large (${declared} bytes)` };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    return { error: `too large (${buffer.byteLength} bytes)` };
  }

  return { base64: buffer.toString("base64"), bytes: buffer.byteLength };
}

export const processInboundResume = inngest.createFunction(
  {
    id: "process-inbound-resume",
    name: "Process inbound resume",
    retries: 3,
    // Bounded per-org concurrency keeps one agency blasting 200 CVs from
    // starving every other tenant's ingestion.
    concurrency: { key: "event.data.orgId", limit: 5 },
    // Inngest v4 takes triggers inside the options object.
    triggers: [{ event: "resume/received" }],
  },
  async ({ event, step, logger }) => {
    const data = event.data as ResumeReceived;
    const { orgId, messageId } = data;

    // ---------------------------------------------------------------------
    // 1. Decide which attachments are resumes.
    // ---------------------------------------------------------------------
    const triage = await step.run("triage-attachments", () => {
      const keep: { index: number; filename: string; contentType: string }[] =
        [];
      const skipped: { filename: string; reason: string }[] = [];

      data.attachments.forEach((attachment, index) => {
        const verdict = classifyAttachment(attachment);
        if (verdict.keep) {
          keep.push({
            index,
            filename: attachment.filename,
            contentType: attachment.contentType,
          });
        } else {
          skipped.push({
            filename: attachment.filename,
            reason: verdict.reason,
          });
        }
      });

      return { keep, skipped };
    });

    for (const skip of triage.skipped) {
      logger.warn(
        `[process-resume] skipped attachment "${skip.filename}": ${skip.reason}`,
      );
    }

    // An email with no resume is a normal event — someone asking a question,
    // an auto-reply, a bounce. Nothing to create, and nothing went wrong.
    if (triage.keep.length === 0) {
      logger.info(
        `[process-resume] no resume attachments on message ${messageId}; nothing to ingest`,
      );
      return {
        candidatesCreated: 0,
        skipped: triage.skipped.length,
        reason: "no-resume-attachments",
      };
    }

    // ---------------------------------------------------------------------
    // 2. Archive the raw email once per message.
    // ---------------------------------------------------------------------
    const rawEmailKey = await step.run("archive-raw-email", async () => {
      const path = rawEmailObjectPath(orgId, messageId);
      const archive = {
        messageId,
        receivedAt: data.receivedAt,
        from: { email: data.fromEmail, name: data.fromName },
        subject: data.subject,
        text: data.text,
        attachments: data.attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          inline: attachment.inline,
        })),
      };

      // The archive stores metadata and body text, not the attachment bytes —
      // those live next to their candidate and would double storage here.
      const stored = await uploadObject(
        path,
        JSON.stringify(archive, null, 2),
        "application/json",
      );
      return stored.key;
    });

    // ---------------------------------------------------------------------
    // 3. Allocate candidate ids up front.
    //
    // The storage path embeds the candidate id, so the id has to exist before
    // the upload. Allocating inside a memoized step means a retry reuses the
    // same ids instead of orphaning files under ids nothing references.
    // ---------------------------------------------------------------------
    const candidateIds = await step.run("allocate-candidate-ids", () =>
      triage.keep.map(() => crypto.randomUUID()),
    );

    // ---------------------------------------------------------------------
    // 4. One candidate per resume file.
    //
    // Agencies routinely forward a single email with several CVs attached. One
    // row per attachment is the only reading that does not silently drop
    // people; the cost is that a genuine two-file application (CV + portfolio,
    // both PDFs) produces two rows. That is recoverable by a human — a dropped
    // applicant is not. Dedup lands with AI extraction, which gives a real
    // identity signal to match on.
    // ---------------------------------------------------------------------
    const results: {
      candidateId: string;
      key: string;
      usage: Awaited<ReturnType<typeof recordApplicationUsage>>;
    }[] = [];

    for (const [position, target] of triage.keep.entries()) {
      const candidateId = candidateIds[position];
      const attachment = data.attachments[target.index];
      const filename = safeFilename(target.filename);

      const uploaded = await step.run(
        `upload-resume-${position}`,
        async (): Promise<
          { key: string; bytes: number } | { skipped: string }
        > => {
          const body = await loadAttachmentBody(attachment);

          if ("error" in body) {
            // A body we cannot fetch will not become fetchable on retry, so
            // fail the attachment rather than the run.
            logger.warn(
              `[process-resume] dropping "${filename}" on ${messageId}: ${body.error}`,
            );
            return { skipped: body.error };
          }

          const stored = await uploadObject(
            resumeObjectPath(orgId, candidateId, filename),
            Buffer.from(body.base64, "base64"),
            target.contentType,
          );
          return { key: stored.key, bytes: stored.bytes };
        },
      );

      if ("skipped" in uploaded) continue;

      await step.run(`create-candidate-${position}`, async () => {
        await prisma.candidate.upsert({
          where: { id: candidateId },
          // Upsert rather than create: if this step retries after the row
          // landed but before Inngest recorded the result, a bare create would
          // throw on the primary key.
          create: {
            id: candidateId,
            orgId,
            // TODO(matching): `jobPostId` stays null. Which role a resume is
            // for is genuinely unknown at this layer — the subject line may
            // name it, the body may, or neither. Until that is designed, these
            // land in /dashboard/inbox for manual assignment. See the summary
            // for why this decision blocks the AI step's shape.
            jobPostId: null,
            // Name and email come from the ENVELOPE, not the resume. Whoever
            // forwarded the mail is often the recruiter, not the candidate, so
            // treat these as provisional until extraction overwrites them.
            name: data.fromName,
            email: data.fromEmail,
            resumeFileUrl: uploaded.key,
            rawEmailSource: rawEmailKey,
            status: "NEW",
          },
          update: {},
        });
      });

      // Counted in its own step so a billing failure retries independently of
      // the candidate insert — the candidate is already saved and must not be
      // re-created if the counter update fails.
      const usage = await step.run(`count-usage-${position}`, () =>
        recordApplicationUsage({ orgId, candidateId }),
      );

      results.push({
        candidateId,
        key: uploaded.key,
        usage: usage ?? null,
      });
    }

    // Applications past the included pool are billed. Emitted after the loop so
    // one send covers the whole email, and kept separate from the extraction
    // handoff because a billing problem must not stop a resume being processed.
    const overage = results.filter((result) => result.usage?.wasOverage);
    if (overage.length > 0) {
      await step.sendEvent(
        "enqueue-overage",
        overage.map((result) => ({
          name: "billing/overage-recorded" as const,
          data: {
            orgId,
            candidateId: result.candidateId,
            ledgerEntryId: result.usage!.ledgerEntryId,
            stripeCustomerId: result.usage!.stripeCustomerId,
          },
        })),
      );
      logger.info(
        `[process-resume] org ${orgId}: ${overage.length} application(s) over quota, queued for billing`,
      );
    }

    // Hand each new candidate to extraction. Sent as one batch after the loop
    // so a failure here cannot leave some candidates enqueued and others not —
    // the step retries the whole send, and the extraction function is
    // idempotent on candidate status.
    if (results.length > 0) {
      await step.sendEvent(
        "enqueue-extraction",
        results.map((result) => ({
          name: "candidate/created" as const,
          data: { orgId, candidateId: result.candidateId },
        })),
      );
    }

    logger.info(
      `[process-resume] ${results.length} candidate(s) created for org ${orgId} from ${messageId}`,
    );

    return {
      candidatesCreated: results.length,
      skipped: triage.skipped.length,
      rawEmailKey,
    };
  },
);

/** Registered in `src/app/api/inngest/route.ts`. */
export const functions = [processInboundResume];
