import "server-only";

import { Resend } from "resend";

/**
 * Outbound email.
 *
 * Deliberately minimal: one notification type (candidates that failed
 * processing) and no preferences system. This is the stub the rest will grow
 * from — see the TODO at the bottom.
 *
 * Resend rather than a second provider, because it is already in the stack for
 * inbound parsing.
 */

export interface FailureDigestCandidate {
  id: string;
  name: string | null;
  email: string | null;
  stage: "extraction" | "scoring";
  jobPostTitle: string | null;
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; skipped?: boolean };

function fromAddress(): string | null {
  // Must be on a domain verified in Resend, or every send is rejected.
  return process.env.RESEND_FROM_EMAIL ?? null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tells the org that some applications did not make it through the pipeline.
 *
 * This is the case with zero visibility outside the app: a candidate that fails
 * extraction never appears on a job post, so without this nobody learns that a
 * real application was dropped.
 *
 * Never throws — a mail failure must not fail the job that triggered it. The
 * candidates are already recorded as `ERROR` and visible at /dashboard/issues;
 * the email is a nudge, not the system of record.
 */
export async function sendFailureDigest(input: {
  to: string[];
  orgName: string;
  candidates: FailureDigestCandidate[];
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = fromAddress();

  // Missing configuration is a skip, not an error: the app is fully functional
  // without outbound mail, and failing the Inngest run over it would be worse
  // than not sending.
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set", skipped: true };
  }
  if (!from) {
    return { ok: false, error: "RESEND_FROM_EMAIL is not set", skipped: true };
  }
  if (input.to.length === 0) {
    return { ok: false, error: "no recipients", skipped: true };
  }
  if (input.candidates.length === 0) {
    return { ok: false, error: "nothing to report", skipped: true };
  }

  const count = input.candidates.length;
  const noun = count === 1 ? "application" : "applications";
  const issuesUrl = `${appUrl()}/dashboard/issues`;

  const rows = input.candidates
    .map((candidate) => {
      const who = escapeHtml(
        candidate.name ?? candidate.email ?? "Unknown sender",
      );
      const role = candidate.jobPostTitle
        ? escapeHtml(candidate.jobPostTitle)
        : "Unassigned";
      const stage =
        candidate.stage === "extraction"
          ? "Could not read the resume"
          : "Could not score against the job criteria";
      return `<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${who}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${role}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${stage}</td>
</tr>`;
    })
    .join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;color:#0f172a;">
  <h2 style="font-size:18px;margin:0 0 8px;">${count} ${noun} need${count === 1 ? "s" : ""} attention</h2>
  <p style="margin:0 0 16px;color:#475569;line-height:1.6;">
    These applications reached ${escapeHtml(input.orgName)} but could not be processed
    automatically. They are real applications that nobody has reviewed.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;">
        <th style="padding:8px 12px;">Candidate</th>
        <th style="padding:8px 12px;">Job post</th>
        <th style="padding:8px 12px;">What failed</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin:20px 0 0;">
    <a href="${issuesUrl}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px;">
      Review and retry
    </a>
  </p>
  <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">
    You are receiving this because you are an admin of ${escapeHtml(input.orgName)} in Staffly ATS+.
  </p>
</div>`;

  const text = [
    `${count} ${noun} need${count === 1 ? "s" : ""} attention`,
    "",
    ...input.candidates.map(
      (candidate) =>
        `- ${candidate.name ?? candidate.email ?? "Unknown sender"} (${candidate.jobPostTitle ?? "Unassigned"}) — ${
          candidate.stage === "extraction"
            ? "could not read the resume"
            : "could not score against the job criteria"
        }`,
    ),
    "",
    `Review and retry: ${issuesUrl}`,
  ].join("\n");

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: `${count} ${noun} need${count === 1 ? "s" : ""} attention — ${input.orgName}`,
      html,
      text,
    });

    if (error) {
      return { ok: false, error: error.message ?? "Resend rejected the send" };
    }
    return { ok: true, id: data?.id ?? null };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/*
 * TODO(notifications): this is the only notification type, hardcoded with no
 * preferences. Others worth adding — a daily digest of newly scored candidates,
 * a nudge when an alias has received nothing since being connected, a warning
 * as an org approaches its application quota. When a second type lands, it
 * needs a per-member opt-out and an unsubscribe link before it goes out to
 * anyone who did not ask for it.
 */
