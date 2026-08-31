import "server-only";

import { fileExtension } from "@/lib/inbound-email";

/**
 * Pulls a text layer out of a resume file, when there is one.
 *
 * Two paths downstream:
 *
 *   - **Text found** → send the text to Claude. Cheaper (no image tokens),
 *     faster, and the model sees exactly the characters the document contains.
 *   - **No usable text** → the caller sends the *file itself* to Claude as a
 *     document block and lets the model read it visually. A scanned CV is a
 *     photograph of a page; no amount of PDF parsing will produce text, and a
 *     separate OCR service would just be a worse version of what the model
 *     already does.
 *
 * The decision is made by `looksUsable()` below, not by file type — a PDF
 * exported from a design tool can carry a text layer that is pure ligature
 * soup, and that is worse than no text at all.
 */

export type ResumeTextResult =
  | { kind: "text"; text: string; pages?: number }
  | { kind: "needs-vision"; reason: string };

/** Below this, whatever came out is not a resume's worth of text. */
const MIN_USABLE_CHARS = 200;

/**
 * Ratio of characters that must be plain readable ASCII/Latin.
 *
 * Broken CID-font extraction typically yields long runs of replacement chars or
 * control bytes; real prose clears this comfortably even in other scripts,
 * because digits, punctuation and whitespace all count.
 */
const MIN_PRINTABLE_RATIO = 0.75;

function printableRatio(text: string): number {
  if (text.length === 0) return 0;
  // Control characters (except tab/newline) and the replacement character are
  // the signal that extraction produced garbage rather than words.
  const bad = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/g);
  return 1 - (bad?.length ?? 0) / text.length;
}

function looksUsable(
  text: string,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();

  if (trimmed.length < MIN_USABLE_CHARS) {
    return {
      ok: false,
      reason: `only ${trimmed.length} chars of text (likely a scan or image-based PDF)`,
    };
  }

  const ratio = printableRatio(trimmed);
  if (ratio < MIN_PRINTABLE_RATIO) {
    return {
      ok: false,
      reason: `text layer is ${Math.round((1 - ratio) * 100)}% unreadable characters (broken font encoding)`,
    };
  }

  return { ok: true };
}

/** Collapses the ragged whitespace PDF extraction leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(bytes: Uint8Array): Promise<ResumeTextResult> {
  // `unpdf` is a serverless-friendly build of pdf.js — no filesystem access and
  // no worker thread, which matters inside an Inngest step.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(document, {
    mergePages: true,
  });

  const merged = tidy(Array.isArray(text) ? text.join("\n\n") : text);
  const verdict = looksUsable(merged);

  return verdict.ok
    ? { kind: "text", text: merged, pages: totalPages }
    : { kind: "needs-vision", reason: verdict.reason };
}

async function extractDocx(bytes: Uint8Array): Promise<ResumeTextResult> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(bytes),
  });

  const cleaned = tidy(value);
  const verdict = looksUsable(cleaned);

  return verdict.ok
    ? { kind: "text", text: cleaned }
    : { kind: "needs-vision", reason: verdict.reason };
}

/**
 * Best-effort text extraction. Never throws — a parser blowing up on a
 * malformed file is a reason to fall back to vision, not to fail the candidate.
 */
export async function extractResumeText(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<ResumeTextResult> {
  const extension = fileExtension(filename);
  const isPdf = contentType.includes("pdf") || extension === "pdf";
  const isDocx =
    contentType.includes("wordprocessingml") || extension === "docx";

  try {
    if (isPdf) return await extractPdf(bytes);
    if (isDocx) return await extractDocx(bytes);
  } catch (error) {
    return {
      kind: "needs-vision",
      reason: `parser failed (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  // Legacy .doc and .rtf have no maintained pure-JS parser worth adding as a
  // dependency. The model reads them directly instead.
  return {
    kind: "needs-vision",
    reason: `no text extractor for ${extension || contentType}`,
  };
}

/**
 * Claude accepts PDFs as document blocks natively. Anything else has to be
 * converted before it can be sent visually, which we do not do — those fail
 * with a clear reason rather than silently producing an empty extraction.
 */
export function supportsVisionFallback(
  filename: string,
  contentType: string,
): boolean {
  return contentType.includes("pdf") || fileExtension(filename) === "pdf";
}
