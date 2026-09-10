import "server-only";

import { fileExtension } from "@/lib/inbound-email";
import {
  describeHiddenText,
  scanForHiddenText,
  stripHiddenText,
  type HiddenSpan,
} from "@/lib/hidden-text";

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

/**
 * What a deterministic scan found hidden in the document, if anything.
 *
 * Present on the text path only. The vision path does not need it: text drawn
 * in white on white, or at one point, or in an invisible render mode, is as
 * invisible to a model looking at the rendered page as it is to a person. The
 * text layer is the only place this attack works, which is exactly why it is
 * defended here rather than in the prompt.
 */
export interface HiddenTextFinding {
  /** Spans removed from `text` before it goes anywhere near the model. */
  removed: HiddenSpan[];
  /** Human-readable, for the candidate flag a recruiter will read. */
  summary: string;
}

export type ResumeTextResult =
  | {
      kind: "text";
      text: string;
      pages?: number;
      /** Set only when hidden text was found AND removed. */
      hidden?: HiddenTextFinding;
    }
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

  // One parse, shared. pdf.js takes ownership of the buffer it is given, so a
  // second `getDocumentProxy` over the same bytes fails on a detached
  // ArrayBuffer — the scan takes the document rather than the bytes.
  const document = await getDocumentProxy(bytes);
  const [{ text, totalPages }, scan] = await Promise.all([
    extractText(document, { mergePages: true }),
    scanForHiddenText(document),
  ]);

  const merged = tidy(Array.isArray(text) ? text.join("\n\n") : text);

  // Stripped BEFORE the usability verdict, so a document whose only substantial
  // text is an injection is correctly judged to have no usable text and goes to
  // vision, rather than reaching the model as a page of instructions.
  const stripped = stripHiddenText(merged, scan.spans);

  if (stripped.suppressed) {
    // The scan claimed most of the document was invisible, which is far more
    // likely to be a detector failure than a resume. Logged rather than acted
    // on — see MAX_HIDDEN_SHARE.
    console.warn(
      `[resume-text] hidden-text scan flagged ${scan.spans.length} span(s) covering most of the document; ignoring the scan`,
    );
  }

  const verdict = looksUsable(stripped.text);

  if (!verdict.ok) return { kind: "needs-vision", reason: verdict.reason };

  return {
    kind: "text",
    text: stripped.text,
    pages: totalPages,
    ...(stripped.removed.length > 0
      ? {
          hidden: {
            removed: stripped.removed,
            summary: describeHiddenText(stripped.removed),
          },
        }
      : {}),
  };
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
