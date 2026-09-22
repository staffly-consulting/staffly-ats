import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { Webhook } from "svix";

import { inngest } from "@/inngest/client";
import { resolveInboxByAlias } from "@/lib/email-inbox";
import {
  inboundEmailPayloadSchema,
  normalizeInboundEmail,
} from "@/lib/inbound-email";
import { fetchReceivedEmailRecipients } from "@/lib/resend-inbound";

/**
 * Resend inbound email → `resume/received`.
 *
 * This handler does the minimum that cannot be deferred — verify the signature,
 * resolve the recipient alias to an org — then emits an event and returns.
 * Downloading attachments and writing rows happens in the Inngest function, so
 * a slow Supabase upload can never push this past Resend's delivery timeout and
 * trigger a redelivery of an email we already accepted.
 *
 * Status codes, chosen so Resend's retries help rather than hurt:
 *
 *   200 — accepted, or deliberately ignored (unknown alias, no alias match).
 *         An unrecognised address will never become recognised by retrying, so
 *         retrying is pure noise.
 *   400 — unverifiable or unparseable. Cannot succeed on retry either.
 *   500 — our fault and probably transient (Inngest unreachable). Retry please.
 */

export async function POST(request: Request) {
  const signingSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (!signingSecret) {
    // Misconfiguration on our side, not a bad request — 500 so deliveries are
    // retried once the secret is in place instead of being discarded.
    console.error("[resend-inbound] RESEND_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const headerList = await headers();
  const svixId = headerList.get("svix-id");
  const svixTimestamp = headerList.get("svix-timestamp");
  const svixSignature = headerList.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix signature headers" },
      { status: 400 },
    );
  }

  // The signature covers the raw body — parse only after verifying.
  const rawBody = await request.text();

  let verified: unknown;
  try {
    verified = new Webhook(signingSecret).verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (error) {
    console.error("[resend-inbound] signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const parsed = inboundEmailPayloadSchema.safeParse(verified);
  if (!parsed.success) {
    // The payload shape is the one assumption in this pipeline. Log the keys we
    // actually received so the first real delivery tells us what to fix in
    // `src/lib/inbound-email.ts`.
    console.error("[resend-inbound] unrecognised payload shape", {
      keys:
        verified && typeof verified === "object"
          ? Object.keys(verified as Record<string, unknown>)
          : typeof verified,
      issues: parsed.error.issues.slice(0, 5),
    });
    return NextResponse.json(
      { error: "Unrecognised payload shape" },
      { status: 400 },
    );
  }

  const email = normalizeInboundEmail(parsed.data);

  // Staging instrumentation. The payload shape is the one assumption this
  // pipeline rests on, so log what actually arrived — every field that decides
  // whether the resume is reachable — before anything acts on it.
  //
  // Deliberately no body text and no sender name: this line ends up in a hosting
  // provider's log retention, and an applicant's covering letter does not belong
  // there. Ids, filenames and counts answer every question staging asks.
  {
    const envelope = "data" in parsed.data ? parsed.data.data : parsed.data;
    console.log(
      `[resend-inbound] RECEIVED type=${
        "type" in parsed.data ? (parsed.data.type ?? "none") : "flat"
      } keys=[${Object.keys(envelope).join(",")}]`,
    );
    console.log(
      `[resend-inbound]   messageId=${email.messageId} providerEmailId=${
        email.providerEmailId ?? "MISSING"
      } recipients=${email.recipients.length} attachments=${email.attachments.length} text=${
        email.text?.length ?? 0
      }ch`,
    );
    email.attachments.forEach((attachment, index) => {
      console.log(
        `[resend-inbound]   att[${index}] id=${attachment.id ?? "MISSING"} file="${
          attachment.filename
        }" type=${attachment.contentType} inline=${attachment.inline} content=${
          attachment.content ? "inline" : "no"
        } url=${attachment.url ? "yes" : "no"}`,
      );
    });
    if (!email.providerEmailId) {
      console.error(
        "[resend-inbound] no provider email id on payload — attachment bytes will be UNREACHABLE; check the field name in src/lib/inbound-email.ts",
      );
    }
  }

  if (email.recipients.length === 0 && !email.providerEmailId) {
    console.warn(
      `[resend-inbound] message ${email.messageId} has no recipients; ignoring`,
    );
    return NextResponse.json({ received: true, ignored: "no-recipients" });
  }

  // A forwarded message can carry several recipients; find the one that is
  // ours. Tenancy is decided here and nowhere else — the org comes from the
  // alias, never from anything the sender controls.
  let inbox: Awaited<ReturnType<typeof resolveInboxByAlias>> = null;
  for (const recipient of email.recipients) {
    inbox = await resolveInboxByAlias(recipient);
    if (inbox) break;
  }

  // An auto-forward keeps the original `To:` header, so the webhook may name
  // only the forwarding mailbox. The envelope (`received_for`) names the alias;
  // fetch it once rather than drop a forwarded application as unknown.
  if (!inbox && email.providerEmailId) {
    let envelope: string[];
    try {
      envelope = await fetchReceivedEmailRecipients(email.providerEmailId);
    } catch (error) {
      // Transient on Resend's side; the message may well be ours. Retry.
      console.error(
        `[resend-inbound] could not fetch envelope recipients for ${email.messageId}`,
        error,
      );
      return NextResponse.json(
        { error: "Could not resolve recipients" },
        { status: 500 },
      );
    }

    for (const recipient of envelope) {
      if (email.recipients.includes(recipient)) continue;
      inbox = await resolveInboxByAlias(recipient);
      if (inbox) break;
    }
  }

  if (!inbox) {
    // Could be a decommissioned alias, a disconnected inbox, or spam hitting
    // the domain. 200 so Resend stops; warn so it is visible in logs.
    console.warn(
      `[resend-inbound] no active inbox for recipients [${email.recipients.join(", ")}] on message ${email.messageId}`,
    );
    return NextResponse.json({ received: true, ignored: "unknown-alias" });
  }

  try {
    await inngest.send({
      name: "resume/received",
      data: {
        orgId: inbox.orgId,
        emailInboxId: inbox.id,
        messageId: email.messageId,
        providerEmailId: email.providerEmailId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        text: email.text,
        receivedAt: email.receivedAt,
        attachments: email.attachments,
      },
    });
  } catch (error) {
    console.error("[resend-inbound] failed to enqueue resume/received", error);
    return NextResponse.json(
      { error: "Could not enqueue processing" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    received: true,
    orgId: inbox.orgId,
    attachments: email.attachments.length,
  });
}

/** Some providers probe the endpoint before enabling delivery. */
export async function GET() {
  return NextResponse.json({ status: "ok", handler: "resend-inbound" });
}
