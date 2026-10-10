import { cn } from "@/lib/utils";

/**
 * "How it works": three steps, each with a small picture of that step.
 *
 * The pictures are the point. "Resumes are read and structured" is a sentence
 * every screening tool prints; a filled-in record next to it is what makes a
 * reader believe this one does it.
 */

function EmailIllustration() {
  return (
    <div className="space-y-2.5 font-mono text-xs">
      <div className="truncate rounded-xl border border-border bg-card px-4 py-3 text-muted-foreground">
        To: <span className="text-brand">acme@mail.stafflyconsulting.com</span>
      </div>
      {["Mariam Haddad", "Sofia Lindqvist"].map((name, index) => (
        <div
          key={name}
          className={cn(
            "flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 font-sans text-sm",
            // The second message is dimmed: still arriving, not yet read.
            index > 0 && "opacity-60",
          )}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-brand" />
          <span className="min-w-0 flex-1 truncate">Application — {name}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            CV.pdf
          </span>
        </div>
      ))}
    </div>
  );
}

const EXTRACTED_FIELDS = [
  { label: "Name", value: "Mariam Haddad" },
  { label: "Location", value: "Lisbon, PT" },
  { label: "Experience", value: "8 years" },
];

function ExtractionIllustration() {
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-y-2.5 text-sm">
      {EXTRACTED_FIELDS.map((field) => (
        <div key={field.label} className="contents">
          <dt className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
            {field.label}
          </dt>
          <dd className="font-medium">{field.value}</dd>
        </div>
      ))}
      <dt className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
        Skills
      </dt>
      <dd className="flex flex-wrap gap-1.5">
        {["Go", "Postgres", "Kafka"].map((skill) => (
          <span
            key={skill}
            className="rounded-md bg-brand-subtle px-2 py-0.5 text-brand"
          >
            {skill}
          </span>
        ))}
      </dd>
    </dl>
  );
}

const SCORED_CRITERIA = [
  { label: "Backend years", fill: 1, met: true },
  { label: "Go or Rust", fill: 1, met: true },
  { label: "Led migration", fill: 0.5, met: false },
];

function ScoringIllustration() {
  return (
    <div>
      <div className="flex items-end justify-between">
        <span className="text-sm text-muted-foreground">Weighted score</span>
        <span className="text-4xl leading-none font-semibold text-success tabular-nums">
          92
        </span>
      </div>
      <ul className="mt-4 space-y-2.5">
        {SCORED_CRITERIA.map((criterion) => (
          <li
            key={criterion.label}
            className="flex items-center justify-between gap-4 text-sm text-muted-foreground"
          >
            {criterion.label}
            <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-border">
              <span
                style={{ width: `${criterion.fill * 100}%` }}
                className={cn(
                  "block h-full rounded-full",
                  criterion.met ? "bg-success" : "bg-warning",
                )}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STEPS = [
  {
    title: "Applications arrive by email",
    // One address per organization, which is what the product actually issues.
    body: "Your organization gets its own inbound address. Forward your careers inbox once and applications land in Staffly automatically.",
    Illustration: EmailIllustration,
  },
  {
    title: "Resumes are read and structured",
    body: "Contact details, education, experience and skills are extracted into fields you can filter on — no manual data entry.",
    Illustration: ExtractionIllustration,
  },
  {
    title: "Candidates are scored on your criteria",
    body: "Define what matters per role, weight it, and get a 0–100 score with a written rationale for every criterion.",
    Illustration: ScoringIllustration,
  },
];

export function LandingSteps() {
  return (
    <section className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <p className="font-mono text-xs tracking-[0.2em] text-brand uppercase">
          How it works
        </p>
        <h2 className="mt-4 max-w-xl text-4xl leading-[1.05] font-semibold tracking-tighter text-balance sm:text-5xl">
          From forwarded email to{" "}
          <span className="font-serif font-normal tracking-normal italic">
            ranked shortlist
          </span>
        </h2>

        <ol className="mt-14 grid gap-5 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col overflow-hidden rounded-3xl border border-border bg-muted/60"
            >
              {/* Fixed height and vertically centred, so three illustrations
                  of different heights still give three cards whose text starts
                  on the same line. */}
              <div
                aria-hidden
                className="flex h-56 flex-col justify-center border-b border-border px-6 sm:px-8"
              >
                <step.Illustration />
              </div>
              <div className="flex-1 bg-background/70 p-6 sm:p-8">
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
