import "server-only";

import writeXlsxFile, { type SheetData } from "write-excel-file/node";

import type { JobPostCandidate } from "@/lib/candidates";
import type { JobPostSummary } from "@/lib/job-posts";
import { SCORE_THRESHOLDS } from "@/lib/score";
import type { Criterion } from "@/lib/types";

/**
 * The shortlist export: a real .xlsx workbook, not a CSV.
 *
 * Two reasons it is xlsx rather than the simpler format:
 *
 *   1. It is opened in Excel or Sheets by a hiring manager, and a CSV of forty
 *      columns with free-text summaries in them is unreadable there — no column
 *      widths, no frozen header, no wrapped text, and any summary containing a
 *      comma or newline is at the mercy of the reader's parser.
 *   2. CSV injection. A candidate's name is attacker-controlled — it comes from
 *      a resume attached to an email anyone can send to the org's forwarding
 *      address — and a name beginning `=`, `+`, `-` or `@` becomes a live
 *      formula when a CSV is opened in Excel. In xlsx a value is typed in the
 *      file itself: strings are written as strings, and a formula only exists
 *      where one is explicitly asked for. Nothing below ever asks.
 *
 * The workbook has two sheets. "Candidates" is the data. "About this export"
 * is provenance — which job post, which filters, how many rows, scored against
 * what criteria — because this file gets forwarded, and a spreadsheet of scores
 * with no statement of what was measured is worse than no spreadsheet.
 */

/** Column widths, in characters. Free text gets room; codes do not. */
const HEADER = {
  fontWeight: "bold",
  backgroundColor: "#F1F5F9",
  align: "left",
  alignVertical: "center",
  wrap: true,
} as const;

const TEXT = { alignVertical: "top", wrap: true } as const;

/** Row labels on the About sheet: bold, but no header fill. */
const LABEL = { fontWeight: "bold", alignVertical: "top" } as const;

interface ExportContext {
  job: JobPostSummary;
  candidates: JobPostCandidate[];
  /** Human-readable description of the filters in force, or null for none. */
  filterSummary: string | null;
  /** True when the row cap was reached and the file is not the whole set. */
  truncated: boolean;
  exportedBy: string;
  exportedAt: Date;
}

/** Empty cells read better as an em dash than as a blank a reader distrusts. */
function text(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function yesNo(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Yes" : "No";
}

/** ISO string to a Date the spreadsheet can sort and format as a date. */
function date(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

const EDUCATION_LABELS: Record<string, string> = {
  high_school: "High school",
  bachelors: "Bachelor's",
  masters: "Master's",
  phd: "PhD",
  other: "Other",
};

/**
 * Candidates ordered for a shortlist: best score first, unscored last.
 *
 * The on-screen table orders by arrival, which is right for triage and wrong
 * for a file whose whole purpose is "here are the people worth meeting".
 * Unscored candidates sort to the bottom rather than being dropped — they are
 * real applications, and silently omitting them from an export would hide work
 * still queued.
 */
function forShortlist(candidates: JobPostCandidate[]): JobPostCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });
}

interface ColumnSpec {
  header: string;
  width: number;
  /** Cell value. Strings, numbers, dates and booleans only — never a formula. */
  value: (
    candidate: JobPostCandidate,
    index: number,
  ) => string | number | Date | null;
  type?: StringConstructor | NumberConstructor | DateConstructor;
  format?: string;
}

const COLUMNS: ColumnSpec[] = [
  { header: "#", width: 5, value: (_, index) => index + 1, type: Number },
  {
    header: "Name",
    width: 24,
    value: (c) => text(c.extracted?.fullName ?? c.name),
    type: String,
  },
  {
    header: "Email",
    width: 28,
    value: (c) => text(c.extracted?.email ?? c.email),
    type: String,
  },
  {
    header: "Phone",
    width: 16,
    value: (c) => text(c.extracted?.phone ?? c.phone),
    type: String,
  },
  {
    header: "Nationality",
    width: 14,
    value: (c) => text(c.extracted?.nationality ?? c.nationality),
    type: String,
  },
  {
    header: "Location",
    width: 18,
    value: (c) => text(c.extracted?.location),
    type: String,
  },
  {
    header: "Score",
    width: 8,
    // Left as a real number so the reader can sort, filter and conditionally
    // format on it. `null` for unscored, which Excel shows as an empty cell —
    // correctly different from a zero.
    value: (c) => c.score,
    type: Number,
  },
  {
    header: "Decision",
    width: 12,
    // The human call, beside the model's number so a reader can see where the
    // two differ. "—" is a candidate nobody has ruled on yet, which is
    // different from one that was considered and passed over.
    value: (c) =>
      c.status === "SHORTLISTED"
        ? "Shortlisted"
        : c.status === "REJECTED"
          ? "Rejected"
          : "—",
    type: String,
  },
  {
    header: "Meets requirements",
    width: 12,
    value: (c) => yesNo(c.mandatoryPassed),
    type: String,
  },
  {
    header: "Years experience",
    width: 10,
    value: (c) => c.extracted?.yearsOfExperience ?? null,
    type: Number,
  },
  {
    header: "Education",
    width: 14,
    value: (c) =>
      c.extracted?.educationLevel
        ? (EDUCATION_LABELS[c.extracted.educationLevel] ??
          c.extracted.educationLevel)
        : "—",
    type: String,
  },
  {
    header: "University",
    width: 26,
    value: (c) => text(c.extracted?.university),
    type: String,
  },
  {
    header: "Degree",
    width: 24,
    value: (c) => text(c.extracted?.degree),
    type: String,
  },
  {
    header: "Skills",
    width: 40,
    value: (c) =>
      c.extracted?.skills.length ? c.extracted.skills.join(", ") : "—",
    type: String,
  },
  {
    header: "Summary",
    width: 60,
    // The model's own 2-3 sentence précis of the resume. The single most useful
    // column for someone reading this file who never opens the CV.
    value: (c) => text(c.extracted?.rawSummary),
    type: String,
  },
  {
    header: "Why this score",
    width: 60,
    value: (c) => text(c.scoreRationale),
    type: String,
  },
  {
    header: "Referral",
    width: 10,
    value: (c) => yesNo(c.referral),
    type: String,
  },
  {
    header: "Referral bonus",
    width: 10,
    value: (c) => c.referralBonusApplied,
    type: Number,
  },
  {
    header: "University bonus",
    width: 10,
    value: (c) => c.universityBonusApplied,
    type: Number,
  },
  {
    header: "Flagged",
    width: 10,
    value: (c) => yesNo(c.flagged),
    type: String,
  },
  {
    header: "Flag reason",
    width: 34,
    value: (c) => text(c.flagReason),
    type: String,
  },
  {
    header: "Status",
    width: 13,
    value: (c) => c.status,
    type: String,
  },
  {
    header: "Received",
    width: 12,
    value: (c) => date(c.ingestedAt),
    type: Date,
    format: "yyyy-mm-dd",
  },
  {
    header: "Scored",
    width: 12,
    value: (c) => date(c.scoredAt),
    type: Date,
    format: "yyyy-mm-dd",
  },
];

function candidateSheet(candidates: JobPostCandidate[]): SheetData {
  const header = COLUMNS.map((column) => ({
    value: column.header,
    ...HEADER,
  }));

  const rows = candidates.map((candidate, index) =>
    COLUMNS.map((column) => {
      const value = column.value(candidate, index);

      // An absent value is the bare cell `null`, not `{ value: null }`: the
      // writer types every cell from its `type`, and handing it a null to
      // coerce into a Date or Number throws. Excel renders this as a genuinely
      // empty cell, which for an unscored candidate is the honest answer — and
      // is visibly different from a zero.
      if (value === null || value === undefined) return null;

      return {
        value,
        type: column.type,
        ...(column.format ? { format: column.format } : {}),
        ...TEXT,
      };
    }),
  );

  return [header, ...rows];
}

function criteriaLines(criteria: Criterion[], label: string): string[][] {
  if (criteria.length === 0) return [];
  return [
    [""],
    [label],
    ...criteria.map((criterion) => [
      `  • ${criterion.label} (weight ${criterion.weight})`,
    ]),
  ];
}

function aboutSheet(context: ExportContext): SheetData {
  const { job, candidates, filterSummary, truncated, exportedBy, exportedAt } =
    context;

  const scored = candidates.filter((c) => c.score !== null);
  const strong = scored.filter(
    (c) => (c.score ?? 0) >= SCORE_THRESHOLDS.strong,
  );

  const rows: (string | number | Date | null)[][] = [
    [job.title],
    [""],
    ["Job post status", job.status],
    ["Exported by", exportedBy],
    ["Exported at", exportedAt.toISOString().replace("T", " ").slice(0, 16)],
    [""],
    ["Candidates in this file", candidates.length],
    ["Scored", scored.length],
    [`Scoring ${SCORE_THRESHOLDS.strong} or above`, strong.length],
    ["Not yet scored", candidates.length - scored.length],
    [""],
    ["Filters applied", filterSummary ?? "None — every candidate on this role"],
  ];

  if (truncated) {
    rows.push(
      [""],
      [
        "NOTE",
        "This export hit its row limit and does NOT contain every candidate. Narrow the filters and export again.",
      ],
    );
  }

  rows.push(
    [""],
    [
      "How to read the score",
      `0-100, produced by scoring each candidate against the criteria below. ${SCORE_THRESHOLDS.strong}+ is a strong match, ${SCORE_THRESHOLDS.moderate}+ is worth a look. "Meets requirements" is separate: it is No when a mandatory criterion is unmet, whatever the score.`,
    ],
  );

  const criteria = [
    ...criteriaLines(job.mandatoryCriteria, "Mandatory criteria"),
    ...criteriaLines(job.optionalCriteria, "Optional criteria"),
  ];

  return [
    ...rows.map((row): SheetData[number] => [
      row[0] === null || row[0] === undefined
        ? null
        : { value: row[0], ...LABEL },
      row[1] === null || row[1] === undefined
        ? null
        : { value: row[1], ...TEXT },
    ]),
    ...criteria.map((row): SheetData[number] => [{ value: row[0], ...TEXT }]),
  ];
}

/** The workbook, as a Buffer ready to hand to a Response. */
export async function buildCandidateWorkbook(
  context: ExportContext,
): Promise<Buffer> {
  const ordered = forShortlist(context.candidates);

  return writeXlsxFile([
    {
      sheet: "Candidates",
      data: candidateSheet(ordered),
      columns: COLUMNS.map((column) => ({ width: column.width })),
      // The header row stays visible while scrolling four hundred candidates.
      stickyRowsCount: 1,
    },
    {
      sheet: "About this export",
      data: aboutSheet({ ...context, candidates: ordered }),
      columns: [{ width: 26 }, { width: 90 }],
    },
  ]).toBuffer();
}

/**
 * A filename that is safe on every OS and still says what the file is.
 *
 * The job title is attacker-adjacent (a recruiter types it, but it reaches a
 * `Content-Disposition` header) so it is reduced to ASCII word characters
 * rather than escaped — there is no reason for anything else to survive into a
 * header value.
 */
export function exportFilename(jobTitle: string, at: Date): string {
  const slug =
    jobTitle
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60)
      .toLowerCase() || "job-post";

  return `${slug}-candidates-${at.toISOString().slice(0, 10)}.xlsx`;
}
