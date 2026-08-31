/**
 * Tests for the inbound-email adapter — the one seam built against an assumed
 * Resend payload shape. Run: npm run test:inbound
 *
 * These are pure; nothing here touches the network, Storage or the database.
 */
import {
  classifyAttachment,
  inboundEmailPayloadSchema,
  normalizeInboundEmail,
  safeFilename,
  type InboundAttachment,
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
    to: ["acme-ab12cd34@mail.staffly.com"],
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
  wrapped?.recipients[0] === "acme-ab12cd34@mail.staffly.com",
);
check("attachment mapped", wrapped?.attachments.length === 1);

const flat = parse({
  id: "msg_2",
  from: "b@example.com",
  to: "alias@mail.staffly.com",
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
  parse({ id: "m", from: "a@b.com", to: ["one@x.com", "two@mail.staffly.com"] })
    ?.recipients.length === 2,
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
  to: "x@mail.staffly.com",
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

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
