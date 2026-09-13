import { inngest, type StafflyEvents } from "@/inngest/client";
import {
  MAX_ATTACHMENT_BYTES,
  classifyAttachment,
  safeFilename,
  type InboundAttachment,
} from "@/lib/inbound-email";
import { prisma } from "@/lib/prisma";
import {
  fetchReceivedEmailBody,
  resolveAttachmentDownload,
} from "@/lib/resend-inbound";
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

/**
 * Bytes for one attachment.
 *
 * Three sources, in order of directness:
 *
 *   1. `content` — inline base64. No provider we use does this, but the seam
 *      accepts it and decoding is free.
 *   2. `url` — a body URL already on the payload.
 *   3. Resend's attachments API, keyed on `providerEmailId` + the attachment
 *      id. This is the real path: `email.received` carries metadata only.
 *
 * Called from inside the upload step on purpose. The URL from (3) is presigned
 * and expires in about an hour, so minting it in an earlier memoized step would
 * mean a retry the next day replaying a dead link and silently losing a
 * candidate. Mint and download are one unit of work.
 */
async function loadAttachmentBody(
  attachment: InboundAttachment,
  providerEmailId: string | null,
): Promise<{ base64: string; bytes: number } | { error: string }> {
  if (attachment.content) {
    const bytes = Buffer.from(attachment.content, "base64").byteLength;
    if (bytes > MAX_ATTACHMENT_BYTES) {
      return { error: `too large after decode (${bytes} bytes)` };
    }
    console.log(
      `[process-resume] FETCH "${attachment.filename}" source=inline bytes=${bytes}`,
    );
    return { base64: attachment.content, bytes };
  }

  let sourceUrl = attachment.url;
  let source = sourceUrl ? "payload-url" : "resend-api";

  if (!sourceUrl) {
    if (!providerEmailId) {
      return {
        error:
          "attachment has no inline content, no URL, and no Resend email id to fetch it with",
      };
    }

    const resolved = await resolveAttachmentDownload(providerEmailId, {
      id: attachment.id,
      filename: attachment.filename,
    });

    if (!resolved?.downloadUrl) {
      return {
        error: `Resend has no download URL for attachment ${attachment.id ?? attachment.filename}`,
      };
    }

    // Resend reports the real size here; the webhook does not. Check it before
    // spending the bandwidth.
    if (resolved.size && resolved.size > MAX_ATTACHMENT_BYTES) {
      return { error: `too large (${resolved.size} bytes)` };
    }

    sourceUrl = resolved.downloadUrl;
    source = "resend-api";
    console.log(
      `[process-resume] FETCH "${attachment.filename}" source=resend-api declaredSize=${
        resolved.size ?? "?"
      } urlExpires=${resolved.expiresAt ?? "?"}`,
    );
  }

  // A presigned URL carries its own credentials in the query string, and S3-style
  // backends reject a request that ALSO sends an Authorization header. So the
  // key goes out only for a URL that came from the payload — never for one the
  // attachments API just minted.
  const isPresigned = sourceUrl !== attachment.url;
  const response = await fetch(sourceUrl, {
    headers:
      !isPresigned && process.env.RESEND_API_KEY
        ? { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
        : undefined,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      `[process-resume] DOWNLOAD failed ${response.status} source=${source} file="${attachment.filename}" :: ${detail.slice(0, 200)}`,
    );
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

  console.log(
    `[process-resume] DOWNLOAD ok source=${source} file="${attachment.filename}" bytes=${buffer.byteLength} contentType=${
      response.headers.get("content-type") ?? "?"
    }`,
  );

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
    const { orgId, messageId, providerEmailId } = data;

    logger.info(
      `[process-resume] START org=${orgId} messageId=${messageId} providerEmailId=${
        providerEmailId ?? "MISSING"
      } attachments=${data.attachments.length}`,
    );

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

    logger.info(
      `[process-resume] TRIAGE kept=${triage.keep.length} skipped=${triage.skipped.length} :: keeping [${triage.keep
        .map((k) => k.filename)
        .join(", ")}]`,
    );

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
    // 2. Fetch the body Resend did not send.
    //
    // `email.received` has no `text`/`html`, so without this the archive would
    // record an empty message and any future body-based matching would have
    // nothing to read. Unlike the attachment URLs this response does not
    // expire, so it is safe in a memoized step of its own.
    //
    // Never fatal: the body is context, the attachment is the product. An
    // archive missing its covering note is worth strictly more than a run that
    // aborted before ingesting the CV.
    // ---------------------------------------------------------------------
    const body = await step.run("fetch-email-body", async () => {
      if (data.text) {
        logger.info(
          `[process-resume] BODY source=webhook len=${data.text.length}ch`,
        );
        return { text: data.text, html: null as string | null };
      }
      if (!providerEmailId) {
        logger.warn(
          "[process-resume] BODY source=none (no providerEmailId) — archive will have no message text",
        );
        return { text: null, html: null };
      }

      try {
        const fetched = await fetchReceivedEmailBody(providerEmailId);
        logger.info(
          `[process-resume] BODY source=resend-api text=${fetched.text?.length ?? 0}ch html=${
            fetched.html?.length ?? 0
          }ch`,
        );
        return { text: fetched.text, html: fetched.html };
      } catch (error) {
        logger.warn(
          `[process-resume] could not fetch body for ${messageId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return { text: null, html: null };
      }
    });

    // ---------------------------------------------------------------------
    // 3. Archive the raw email once per message.
    // ---------------------------------------------------------------------
    const rawEmailKey = await step.run("archive-raw-email", async () => {
      const path = rawEmailObjectPath(orgId, messageId);
      const archive = {
        messageId,
        providerEmailId,
        receivedAt: data.receivedAt,
        from: { email: data.fromEmail, name: data.fromName },
        subject: data.subject,
        text: body.text,
        html: body.html,
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
    // 4. Allocate candidate ids up front.
    //
    // The storage path embeds the candidate id, so the id has to exist before
    // the upload. Allocating inside a memoized step means a retry reuses the
    // same ids instead of orphaning files under ids nothing references.
    // ---------------------------------------------------------------------
    const candidateIds = await step.run("allocate-candidate-ids", () =>
      triage.keep.map(() => crypto.randomUUID()),
    );

    // ---------------------------------------------------------------------
    // 5. One candidate per resume file.
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
          const fileBody = await loadAttachmentBody(
            attachment,
            providerEmailId,
          );

          if ("error" in fileBody) {
            // A body we cannot fetch will not become fetchable on retry, so
            // fail the attachment rather than the run.
            logger.warn(
              `[process-resume] dropping "${filename}" on ${messageId}: ${fileBody.error}`,
            );
            return { skipped: fileBody.error };
          }

          const stored = await uploadObject(
            resumeObjectPath(orgId, candidateId, filename),
            Buffer.from(fileBody.base64, "base64"),
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

    // One line that answers "did staging work?" without reading the rest.
    logger.info(
      `[process-resume] DONE org=${orgId} messageId=${messageId} created=${results.length} skippedAtTriage=${
        triage.skipped.length
      } failedToDownload=${triage.keep.length - results.length} bodySource=${
        body.text ? "present" : "empty"
      } rawEmailKey=${rawEmailKey}`,
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
