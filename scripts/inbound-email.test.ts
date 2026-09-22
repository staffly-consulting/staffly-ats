/**
 * Tests for the inbound-email adapter — the one seam built against an assumed
 * Resend payload shape. Run: npm run test:inbound
 *
 * These are pure; nothing here touches the network, Storage or the database.
 */
import {
  classifyAttachment,
  inboundEmailPayloadSchema,
  matchJobPostBySubject,
  normalizeInboundEmail,
  safeFilename,
  type InboundAttachment,
  type JobPostTitleCandidate,
} from "../src/lib/inbound-email";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

function parse(payload: unknown) {
  const result = inboundEmailPayloadSchema.safeParse(payload);
  if (!result.success) return null;
  return normalizeInboundEmail(result.data);
}

const pdf = (over: Partial<InboundAttachment> = {}): InboundAttachment => ({
  filename: "cv.pdf",
  contentType: "application/pdf",
  content: "ZmFrZQ==",
  inline: false,
  ...over,
});

console.log("\n--- envelope variants ---");
const wrapped = parse({
  type: "email.received",
  created_at: "2026-08-23T10:00:00Z",
  data: {
    email_id: "msg_1",
    from: "ada@example.com",
    to: ["acme-ab12cd34@mail.stafflyconsulting.com"],
    subject: "Application",
    text: "CV attached",
    attachments: [
      {
        filename: "cv.pdf",
        content_type: "application/pdf",
        content: "ZmFrZQ==",
      },
    ],
  },
});
check("{ type, data } envelope parses", wrapped !== null);
check("message id read", wrapped?.messageId === "msg_1");
check(
  "recipient lowercased",
  wrapped?.recipients[0] === "acme-ab12cd34@mail.stafflyconsulting.com",
);
check("attachment mapped", wrapped?.attachments.length === 1);

const flat = parse({
  id: "msg_2",
  from: "b@example.com",
  to: "alias@mail.stafflyconsulting.com",
  attachments: [],
});
check("flat (no data wrapper) envelope parses", flat !== null);
check("bare-string `to` becomes a list", flat?.recipients.length === 1);

console.log("\n--- address forms ---");
check(
  'display name form "Ada Lovelace <ada@x.com>"',
  parse({ id: "m", from: "Ada Lovelace <ADA@x.com>", to: "a@b.com" })
    ?.fromEmail === "ada@x.com",
);
check(
  "display name extracted",
  parse({ id: "m", from: "Ada Lovelace <ada@x.com>", to: "a@b.com" })
    ?.fromName === "Ada Lovelace",
);
check(
  "object form { email, name }",
  parse({ id: "m", from: { email: "C@x.com", name: "Cy" }, to: "a@b.com" })
    ?.fromEmail === "c@x.com",
);
check(
  "multiple recipients all captured",
  parse({
    id: "m",
    from: "a@b.com",
    to: ["one@x.com", "two@mail.stafflyconsulting.com"],
  })?.recipients.length === 2,
);
check(
  "quoted display name stripped",
  parse({ id: "m", from: '"Ada L" <ada@x.com>', to: "a@b.com" })?.fromName ===
    "Ada L",
);

console.log("\n--- missing / hostile payloads ---");
check(
  "garbage rejected",
  inboundEmailPayloadSchema.safeParse("nope").success === false,
);
check(
  "null rejected",
  inboundEmailPayloadSchema.safeParse(null).success === false,
);
check(
  "empty object tolerated (no recipients)",
  parse({})?.recipients.length === 0,
);
check(
  "absent attachments becomes []",
  parse({ id: "m" })?.attachments.length === 0,
);

console.log("\n--- attachment classification ---");
const kept = (a: InboundAttachment) => classifyAttachment(a).keep;
check("pdf kept", kept(pdf()));
check(
  "docx kept",
  kept(
    pdf({
      filename: "resume.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  ),
);
check(
  "doc kept",
  kept(pdf({ filename: "r.doc", contentType: "application/msword" })),
);
check(
  "octet-stream with .pdf name still kept (common in forwarded mail)",
  kept(pdf({ contentType: "application/octet-stream" })),
);
check(
  "png dropped",
  !kept(pdf({ filename: "logo.png", contentType: "image/png" })),
);
check(
  "inline signature image dropped",
  !kept(pdf({ filename: "sig.png", contentType: "image/png", inline: true })),
);
check(
  "inline flag beats a valid pdf type",
  !kept(pdf({ inline: true })),
  classifyAttachment(pdf({ inline: true })),
);
check(
  "oversized dropped",
  !kept(pdf({ size: 11 * 1024 * 1024 })),
  classifyAttachment(pdf({ size: 11 * 1024 * 1024 })),
);
check("exactly 10MB kept", kept(pdf({ size: 10 * 1024 * 1024 })));
check(
  "extensionless octet-stream dropped",
  !kept(
    pdf({ filename: "attachment", contentType: "application/octet-stream" }),
  ),
);
check(
  "zip dropped",
  !kept(pdf({ filename: "docs.zip", contentType: "application/zip" })),
);

console.log("\n--- filename safety (storage keys) ---");
check(
  "path traversal neutralised",
  !safeFilename("../../etc/passwd").includes("/"),
);
check("no leading dots", !safeFilename("...hidden.pdf").startsWith("."));
check("spaces normalised", safeFilename("my resume.pdf") === "my_resume.pdf");
check(
  "extension preserved",
  safeFilename("Ada Lovelace CV.pdf").endsWith(".pdf"),
);
check("empty name gets a fallback", safeFilename("///") !== "");
check("length bounded", safeFilename("x".repeat(400)).length <= 120);

console.log("\n--- inline detection heuristic ---");
const inlineByCid = parse({
  id: "m",
  from: "a@b.com",
  to: "x@mail.stafflyconsulting.com",
  attachments: [
    { filename: "sig.png", content_type: "image/png", content_id: "cid:123" },
    {
      filename: "cv.pdf",
      content_type: "application/pdf",
      disposition: "attachment",
    },
  ],
});
check("content_id marks inline", inlineByCid?.attachments[0].inline === true);
check(
  "explicit attachment disposition is not inline",
  inlineByCid?.attachments[1].inline === false,
);
check(
  "one resume survives triage",
  (inlineByCid?.attachments ?? []).filter((a) => classifyAttachment(a).keep)
    .length === 1,
);

console.log("\n--- Resend email.received: metadata only ---");
//
// The real payload. Resend sends NO body and NO attachment bytes — just ids and
// filenames — because inlining a 10 MB CV would exceed the request-body limit
// of most serverless platforms. The bytes are fetched afterwards from
// `/emails/receiving/{id}/attachments`, which is keyed on `email_id` plus the
// attachment id, so these two fields surviving normalization is the difference
// between a working pipeline and one that silently ingests nothing.
const metadataOnly = parse({
  type: "email.received",
  created_at: "2026-09-11T09:00:00Z",
  data: {
    email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    from: "Ada Lovelace <ada@example.com>",
    to: ["acme-ab12cd34@mail.stafflyconsulting.com"],
    received_for: ["acme-ab12cd34@mail.stafflyconsulting.com"],
    message_id: "<CAF=abc@mail.gmail.com>",
    subject: "Application for Backend Engineer",
    attachments: [
      {
        id: "att_9f2b",
        filename: "ada-lovelace-cv.pdf",
        content_type: "application/pdf",
        content_disposition: "attachment",
      },
    ],
  },
});

check("metadata-only payload parses", metadataOnly !== null);
check(
  "provider email id captured for the attachments API",
  metadataOnly?.providerEmailId === "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
);
check("attachment id captured", metadataOnly?.attachments[0].id === "att_9f2b");
check(
  "no inline content, as Resend sends none",
  metadataOnly?.attachments[0].content === undefined,
);
check(
  "no url either — it is minted later, per download",
  metadataOnly?.attachments[0].url === undefined,
);
check(
  "body is absent until fetched",
  metadataOnly?.text === null && metadataOnly?.html === null,
);
// Triage runs on metadata alone, before any byte is fetched. If this regressed,
// every resume would be discarded before the download step was ever reached.
check(
  "resume still survives triage without bytes",
  classifyAttachment(metadataOnly!.attachments[0]).keep === true,
);
check(
  "sender name parsed from angled address",
  metadataOnly?.fromName === "Ada Lovelace" &&
    metadataOnly?.fromEmail === "ada@example.com",
);

// A payload with no provider id cannot be hydrated at all; ingestion reports the
// attachment as skipped rather than failing the run. Assert the signal it keys
// on rather than the behaviour, which lives in the Inngest function.
const noProviderId = parse({
  message_id: "<no-resend-id@example.com>",
  from: "x@example.com",
  to: "alias@mail.stafflyconsulting.com",
  attachments: [{ filename: "cv.pdf", content_type: "application/pdf" }],
});
check(
  "missing provider id is null, not a fabricated value",
  noProviderId?.providerEmailId === null,
);

// Resend spells it `content_disposition`. Reading only `disposition` would leave
// it undefined, and the content_id heuristic would then file a real CV as an
// inline signature image — discarded at triage, no error raised anywhere.
const dispositionSpelling = parse({
  email_id: "msg_disp",
  from: "c@example.com",
  to: "alias@mail.stafflyconsulting.com",
  attachments: [
    {
      id: "att_logo",
      filename: "logo.png",
      content_type: "image/png",
      content_disposition: "inline",
      content_id: "logo@sig",
    },
    {
      id: "att_cv",
      filename: "cv.pdf",
      content_type: "application/pdf",
      content_disposition: "attachment",
      content_id: "cv@weird", // present, but explicitly an attachment
    },
  ],
});
check(
  "content_disposition inline is honoured",
  dispositionSpelling?.attachments[0].inline === true,
);
check(
  "content_disposition attachment beats a stray content_id",
  dispositionSpelling?.attachments[1].inline === false,
);
check(
  "the CV, not the logo, survives triage",
  (dispositionSpelling?.attachments ?? []).filter(
    (a) => classifyAttachment(a).keep,
  ).length === 1,
);

console.log("\nauto-forwarded recipients");
const forwarded = parse({
  type: "email.received",
  data: {
    email_id: "fwd-1",
    from: "Applicant <applicant@gmail.com>",
    to: ["brian@stafflyconsulting.com"],
    received_for: ["Acme-x7k2@mail.stafflyconsulting.com"],
    subject: "Apply for Software Engineer",
    attachments: [],
  },
});
check(
  "envelope alias is a recipient even when To: names the forwarder",
  forwarded?.recipients.includes("acme-x7k2@mail.stafflyconsulting.com") === true,
  forwarded?.recipients,
);
check(
  "envelope recipient is tried first",
  forwarded?.recipients[0] === "acme-x7k2@mail.stafflyconsulting.com",
);

console.log("\nmatchJobPostBySubject");
const posts: JobPostTitleCandidate[] = [
  { id: "swe", title: "Software Engineer", status: "OPEN", createdAt: "2026-09-01" },
  { id: "senior", title: "Senior Software Engineer", status: "OPEN", createdAt: "2026-09-01" },
  { id: "old-pm", title: "Product Manager", status: "ARCHIVED", createdAt: "2026-01-01" },
  { id: "new-pm", title: "Product Manager", status: "CLOSED", createdAt: "2026-08-01" },
  { id: "qa", title: "Q.A. Analyst", status: "ARCHIVED", createdAt: "2026-02-01" },
];
const matchId = (subject: string | null) =>
  matchJobPostBySubject(subject, posts)?.id ?? null;

check("plain subject matches", matchId("apply for software engineer") === "swe");
check("case and punctuation ignored", matchId("Fwd: Apply for SOFTWARE-ENGINEER!") === "swe");
check("longest title wins", matchId("Application: Senior Software Engineer") === "senior");
check("archived post still matches", matchId("Re: QA Analyst role") === null && matchId("Q A analyst application") === "qa");
check("same title prefers non-archived", matchId("Product Manager - Jane") === "new-pm");
check("partial word does not match", matchId("Software Engineering Lead") === null);
check("no subject, no match", matchId(null) === null);
check("unrelated subject, no match", matchId("Hello there") === null);

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
