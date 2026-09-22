import "server-only";

/**
 * Reading the parts of an inbound email that Resend does not put in the webhook.
 *
 * Resend's `email.received` payload is METADATA ONLY. It names the attachments
 * — id, filename, content type, disposition — and stops there. There is no body
 * and no attachment bytes, deliberately: inlining a 10 MB CV would blow the
 * request-body limit of every serverless platform the webhook might land on.
 *
 * So the pipeline is: the webhook tells us an email exists and roughly what is
 * in it, and these two calls fetch the parts we actually need.
 *
 *   GET /emails/receiving/{id}              → subject, text, html
 *   GET /emails/receiving/{id}/attachments  → a presigned download_url each
 *
 * -----------------------------------------------------------------------------
 * The expiry, and why it decides where these are called from
 * -----------------------------------------------------------------------------
 *
 * `download_url` is presigned and short-lived — Resend returns an `expires_at`
 * roughly an hour out. That makes it unsafe to memoize in an Inngest step: a
 * step that succeeds, then a later step that fails and retries tomorrow, would
 * replay a dead URL and drop a real applicant on the floor.
 *
 * Hence `resolveAttachmentDownload` is called from INSIDE the same step that
 * downloads the bytes, never from a step of its own. Minting and using the URL
 * are one unit of work. `fetchReceivedEmailBody` has no such constraint — the
 * body is plain JSON — so that one is safe to memoize.
 */

const RESEND_API_BASE = "https://api.resend.com";

export interface ReceivedEmailBody {
  subject: string | null;
  text: string | null;
  html: string | null;
}

export interface ReceivedAttachment {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
}

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      "Missing RESEND_API_KEY. Inbound attachments cannot be fetched without it — Resend's webhook carries metadata only.",
    );
  }
  return key;
}

async function getJson(path: string): Promise<unknown> {
  const startedAt = Date.now();
  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
    },
  });
  const ms = Date.now() - startedAt;

  if (!response.ok) {
    // Include the body: Resend puts the useful half of the reason there, and
    // without it a 422 is indistinguishable from a 404 in the logs.
    const detail = await response.text().catch(() => "");
    console.error(
      `[resend-api] GET ${path} -> ${response.status} in ${ms}ms :: ${detail.slice(0, 300)}`,
    );
    throw new Error(
      `Resend GET ${path} failed with ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  console.log(`[resend-api] GET ${path} -> 200 in ${ms}ms`);
  return response.json();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Subject and body of a received email.
 *
 * Safe to call from a memoized step — nothing here expires.
 */
export async function fetchReceivedEmailBody(
  emailId: string,
): Promise<ReceivedEmailBody> {
  const body = asRecord(await getJson(`/emails/receiving/${emailId}`));

  const result = {
    subject: str(body.subject),
    text: str(body.text),
    html: str(body.html),
  };

  // Lengths, not contents: the body of an application is personal data and has
  // no business in a log line. The length is enough to tell "fetched nothing"
  // from "fetched something", which is the only question staging is asking.
  console.log(
    `[resend-api] body ${emailId}: keys=[${Object.keys(body).join(",")}] subject=${
      result.subject ? "yes" : "no"
    } text=${result.text?.length ?? 0}ch html=${result.html?.length ?? 0}ch`,
  );

  return result;
}

/**
 * Every address a received email was delivered or addressed to, lowercased.
 *
 * The webhook's `to` is the header, which on a Gmail auto-forward still names
 * the forwarding mailbox rather than our alias. `received_for` is the envelope
 * and does name the alias, so this is the fallback when the webhook's own
 * addresses match no inbox.
 */
export async function fetchReceivedEmailRecipients(
  emailId: string,
): Promise<string[]> {
  const body = asRecord(await getJson(`/emails/receiving/${emailId}`));
  const addresses = [body.received_for, body.to, body.cc, body.bcc].flatMap(
    (value) => (Array.isArray(value) ? value : []),
  );

  return [
    ...new Set(
      addresses
        .map((value) => {
          if (typeof value !== "string") return null;
          const angled = /<([^>]+)>/.exec(value);
          return (angled ? angled[1] : value).trim().toLowerCase() || null;
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

/**
 * Attachment records, each carrying a freshly minted presigned `download_url`.
 *
 * MUST be called from inside the step that consumes the URL — see the note at
 * the top of this file.
 */
export async function listReceivedAttachments(
  emailId: string,
): Promise<ReceivedAttachment[]> {
  const payload = asRecord(
    await getJson(`/emails/receiving/${emailId}/attachments`),
  );
  const rows = Array.isArray(payload.data) ? payload.data : [];

  const mapped = rows.map((row) => {
    const item = asRecord(row);
    return {
      id: str(item.id) ?? "",
      filename: str(item.filename),
      contentType: str(item.content_type),
      size: num(item.size),
      downloadUrl: str(item.download_url),
      expiresAt: str(item.expires_at),
    };
  });

  // The response envelope is logged as keys because a wrong assumption about it
  // (`data` vs `attachments`, say) produces an empty list rather than an error —
  // the exact failure this whole path exists to avoid.
  console.log(
    `[resend-api] attachments ${emailId}: envelope=[${Object.keys(payload).join(",")}] count=${mapped.length}`,
  );
  for (const row of mapped) {
    console.log(
      `[resend-api]   - id=${row.id || "MISSING"} file="${row.filename ?? "?"}" type=${
        row.contentType ?? "?"
      } size=${row.size ?? "?"} url=${row.downloadUrl ? "yes" : "NO"} expires=${row.expiresAt ?? "?"}`,
    );
  }

  return mapped;
}

/**
 * The `download_url` for one attachment of one email.
 *
 * Matches on the attachment id from the webhook payload. Falls back to filename
 * only when the id is absent — an id is what Resend actually keys on, and two
 * attachments on one email can genuinely share a filename ("resume.pdf" twice
 * from an agency), so filename matching is a last resort rather than a
 * shortcut.
 */
export async function resolveAttachmentDownload(
  emailId: string,
  attachment: { id?: string; filename?: string },
): Promise<ReceivedAttachment | null> {
  const rows = await listReceivedAttachments(emailId);

  if (attachment.id) {
    const byId = rows.find((row) => row.id === attachment.id);
    if (byId) {
      console.log(`[resend-api] matched attachment by id=${attachment.id}`);
      return byId;
    }
  }

  if (attachment.filename) {
    const byName = rows.find((row) => row.filename === attachment.filename);
    if (byName) {
      // Worth a warning even though it worked: it means the webhook's id did
      // not appear in the API response, so the two are keyed differently and
      // the id path needs revisiting before an email arrives with two files
      // of the same name.
      console.warn(
        `[resend-api] fell back to filename match for "${attachment.filename}" (webhook id=${attachment.id ?? "none"} not found in API response)`,
      );
      return byName;
    }
  }

  console.error(
    `[resend-api] NO MATCH for attachment id=${attachment.id ?? "none"} file="${attachment.filename ?? "?"}" among [${rows
      .map((row) => `${row.id}:${row.filename}`)
      .join(", ")}]`,
  );
  return null;
}
