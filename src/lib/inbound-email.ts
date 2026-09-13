import { z } from "zod";

/**
 * The Resend inbound-email payload seam.
 *
 * ⚠️ THIS IS THE ONE PART OF THE PIPELINE BUILT AGAINST AN ASSUMED SHAPE.
 *
 * Everything downstream — storage, the Inngest function, candidate creation —
 * consumes `NormalizedInboundEmail` below, never the raw payload. So if Resend's
 * actual field names differ, the fix is confined to this file: adjust the schema
 * and `normalizeInboundEmail`, and nothing else changes.
 *
 * The schema is deliberately permissive about the variations that are plausible
 * without the docs in front of us:
 *
 *   - `to` / `from` as either a bare string or an array of strings
 *   - addresses as either `"a@b.com"` or `{ email, name }` objects
 *   - attachment bodies as either inline base64 (`content`) or a fetchable
 *     `url` / `download_url`
 *   - the envelope as either `{ type, data: {...} }` or a flat object
 *
 * TODO(resend): confirm against Resend's inbound reference and tighten. The
 * `parseInboundEmail` failure path logs the received keys, so the first real
 * delivery tells you exactly what to change.
 */

/* -------------------------------------------------------------------------- */
/* Raw payload                                                                 */
/* -------------------------------------------------------------------------- */

const addressSchema = z.union([
  z.string(),
  z.object({
    email: z.string().optional(),
    address: z.string().optional(),
    name: z.string().nullish(),
  }),
]);

const addressListSchema = z.union([addressSchema, z.array(addressSchema)]);

const attachmentSchema = z.object({
  /**
   * Resend's attachment id. This is the ONLY handle on the bytes: the webhook
   * carries metadata only, so the body is fetched later via
   * `resolveAttachmentDownload` in `src/lib/resend-inbound.ts`.
   */
  id: z.string().nullish(),
  filename: z.string().nullish(),
  name: z.string().nullish(),
  content_type: z.string().nullish(),
  contentType: z.string().nullish(),
  type: z.string().nullish(),
  /** Inline body, base64-encoded. */
  content: z.string().nullish(),
  /** Or a URL to fetch the body from. */
  url: z.string().nullish(),
  download_url: z.string().nullish(),
  size: z.number().nullish(),
  content_id: z.string().nullish(),
  /** Set by some providers on inline images (signatures, logos). */
  disposition: z.string().nullish(),
  /** Resend's spelling of the same field. */
  content_disposition: z.string().nullish(),
});

const inboundDataSchema = z.object({
  /** Provider-side id for the message; used for audit paths and dedup later. */
  email_id: z.string().nullish(),
  id: z.string().nullish(),
  message_id: z.string().nullish(),
  from: addressListSchema.nullish(),
  to: addressListSchema.nullish(),
  subject: z.string().nullish(),
  text: z.string().nullish(),
  html: z.string().nullish(),
  created_at: z.string().nullish(),
  attachments: z.array(attachmentSchema).nullish(),
});

/** Accepts `{ type, data }` or a flat body. */
export const inboundEmailPayloadSchema = z.union([
  z.object({
    type: z.string().nullish(),
    created_at: z.string().nullish(),
    data: inboundDataSchema,
  }),
  inboundDataSchema,
]);

/* -------------------------------------------------------------------------- */
/* Normalized shape — what the rest of the app actually uses                   */
/* -------------------------------------------------------------------------- */

export interface InboundAttachment {
  /**
   * Provider-side attachment id. With Resend this is how the bytes are found —
   * the webhook has no body and no URL, so ingestion trades this id for a
   * short-lived download URL at the moment it needs it.
   */
  id?: string;
  filename: string;
  contentType: string;
  /** Base64 body when delivered inline. */
  content?: string;
  /** URL to fetch the body from when not inline. */
  url?: string;
  /** Bytes, when the provider tells us up front. */
  size?: number;
  /** True for inline images — signatures, logos, tracking pixels. */
  inline: boolean;
}

export interface NormalizedInboundEmail {
  /** Provider message id, or a synthesized one when absent. */
  messageId: string;
  /**
   * Resend's own `email_id`, when the payload carried one.
   *
   * Kept separate from `messageId`, which may have fallen back to the RFC
   * `Message-ID` or to a synthesized value — neither of which Resend's API can
   * be queried with. Null here means the body and attachments are unfetchable,
   * so it is checked rather than assumed at the call site.
   */
  providerEmailId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  /** Every recipient, lowercased. One of these is our forwarding alias. */
  recipients: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  receivedAt: string;
  attachments: InboundAttachment[];
}

function pickAddress(value: unknown): {
  email: string | null;
  name: string | null;
} {
  if (typeof value === "string") {
    // Handles "Ada Lovelace <ada@example.com>" as well as a bare address.
    const angled = /<([^>]+)>/.exec(value);
    if (angled) {
      return {
        email: angled[1].trim().toLowerCase(),
        name: value.slice(0, angled.index).trim().replace(/^"|"$/g, "") || null,
      };
    }
    return { email: value.trim().toLowerCase() || null, name: null };
  }

  if (value && typeof value === "object") {
    const record = value as {
      email?: string;
      address?: string;
      name?: unknown;
    };
    const email = (record.email ?? record.address ?? "").trim().toLowerCase();
    return {
      email: email || null,
      name: typeof record.name === "string" ? record.name : null,
    };
  }

  return { email: null, name: null };
}

function toAddressList(
  value: unknown,
): { email: string; name: string | null }[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map(pickAddress)
    .filter((entry): entry is { email: string; name: string | null } =>
      Boolean(entry.email),
    );
}

export function normalizeInboundEmail(
  payload: z.infer<typeof inboundEmailPayloadSchema>,
): NormalizedInboundEmail {
  const data = "data" in payload ? payload.data : payload;

  const from = toAddressList(data.from)[0] ?? { email: null, name: null };
  const recipients = toAddressList(data.to).map((entry) => entry.email);

  const attachments: InboundAttachment[] = (data.attachments ?? []).map(
    (attachment, index) => ({
      id: attachment.id ?? undefined,
      filename: attachment.filename ?? attachment.name ?? `attachment-${index}`,
      contentType:
        attachment.content_type ??
        attachment.contentType ??
        attachment.type ??
        "application/octet-stream",
      content: attachment.content ?? undefined,
      url: attachment.url ?? attachment.download_url ?? undefined,
      size: attachment.size ?? undefined,
      // `content_id` set with no explicit disposition is the classic marker of
      // an image embedded in the signature rather than a real attachment.
      //
      // Both spellings are consulted: Resend sends `content_disposition`, so
      // reading only `disposition` would leave it undefined and let the
      // `content_id` heuristic misfile a genuine attachment that happens to
      // carry one — a real CV, dropped before triage, with no error anywhere.
      inline: (() => {
        const disposition =
          attachment.disposition ?? attachment.content_disposition;
        return (
          disposition === "inline" ||
          (Boolean(attachment.content_id) && disposition !== "attachment")
        );
      })(),
    }),
  );

  return {
    messageId:
      data.email_id ??
      data.message_id ??
      data.id ??
      // No provider id: fall back to something stable enough for an audit path.
      `inbound-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    providerEmailId: data.email_id ?? data.id ?? null,
    fromEmail: from.email,
    fromName: from.name,
    recipients,
    subject: data.subject ?? null,
    text: data.text ?? null,
    html: data.html ?? null,
    receivedAt:
      ("created_at" in payload ? payload.created_at : data.created_at) ??
      new Date().toISOString(),
    attachments,
  };
}

/* -------------------------------------------------------------------------- */
/* Resume detection                                                            */
/* -------------------------------------------------------------------------- */

const RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/rtf",
]);

const RESUME_EXTENSIONS = new Set(["pdf", "doc", "docx", "rtf"]);

/** 10 MB. Anything larger is almost certainly not a CV. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function fileExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

export type AttachmentVerdict =
  { keep: true } | { keep: false; reason: string };

/**
 * Best-effort filter, as specified: keep documents that could plausibly be a
 * CV, drop the obvious junk. It does not read the file — a cover letter with no
 * resume is indistinguishable from a resume at this layer and gets through.
 * The AI extraction step is where that gets sorted out.
 */
export function classifyAttachment(
  attachment: InboundAttachment,
): AttachmentVerdict {
  if (attachment.inline) {
    return { keep: false, reason: "inline image (signature or logo)" };
  }

  const extension = fileExtension(attachment.filename);
  const mimeOk = RESUME_MIME_TYPES.has(attachment.contentType.toLowerCase());
  const extensionOk = RESUME_EXTENSIONS.has(extension);

  // Either signal is enough: forwarded mail routinely arrives with a generic
  // `application/octet-stream` content type but an intact `.pdf` filename.
  if (!mimeOk && !extensionOk) {
    return {
      keep: false,
      reason: `unsupported type (${attachment.contentType}, .${extension || "no extension"})`,
    };
  }

  if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) {
    return {
      keep: false,
      reason: `too large (${Math.round(attachment.size / 1024 / 1024)} MB, limit ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`,
    };
  }

  return { keep: true };
}

/** Strips path separators and anything else that could escape the storage prefix. */
export function safeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[/\\]+/g, "_")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "resume";
}
