import { z } from "zod";

/**
 * The contract Claude's extraction output must satisfy.
 *
 * This is the schema handed to the model as a structured-output format *and*
 * the schema the response is validated against on the way back. One definition,
 * so the model cannot be asked for one shape and checked against another.
 *
 * Design notes that matter for the scoring step (Step 7) which consumes this:
 *
 *   - Everything except `skills` / `workHistory` / `certifications` / booleans
 *     is nullable. A resume that does not state something must come back null,
 *     never an invented value — scoring on a hallucinated `yearsOfExperience`
 *     is worse than scoring on a missing one.
 *   - Dates are free-form strings. Resumes write "Jan 2019", "2019-01",
 *     "Spring 2019" and "2019 – present"; parsing them into `Date` here would
 *     mean guessing, and a wrong date is indistinguishable from a right one
 *     downstream.
 *   - `nationality` is only populated when the resume states it outright. It is
 *     never inferred from a name, a language, or a location — that inference is
 *     both unreliable and, in a hiring context, discriminatory.
 */

export const EXTRACTED_EDUCATION_LEVELS = [
  "high_school",
  "bachelors",
  "masters",
  "phd",
  "other",
] as const;

export const workHistoryEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  /** Free-form as written on the resume, e.g. "Jan 2019". */
  startDate: z.string().nullable(),
  /** Free-form; "Present" is a normal value here. */
  endDate: z.string().nullable(),
  description: z.string().nullable(),
});

export const certificationSchema = z.object({
  name: z.string(),
  dateObtained: z.string().nullable(),
  credentialUrl: z.string().nullable(),
});

export const extractedResumeDataSchema = z.object({
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Only when explicitly stated. Never inferred from name, language or location. */
  nationality: z.string().nullable(),
  location: z.string().nullable(),
  yearsOfExperience: z.number().nullable(),
  educationLevel: z.enum(EXTRACTED_EDUCATION_LEVELS).nullable(),
  university: z.string().nullable(),
  degree: z.string().nullable(),
  skills: z.array(z.string()),
  workHistory: z.array(workHistoryEntrySchema),
  certifications: z.array(certificationSchema),
  /** True only when the text names a specific referrer. */
  referralMentioned: z.boolean(),
  referralNote: z.string().nullable(),
  /** 2–3 sentences, written by the model. */
  rawSummary: z.string(),
});

export type ExtractedResumeData = z.infer<typeof extractedResumeDataSchema>;
export type WorkHistoryEntry = z.infer<typeof workHistoryEntrySchema>;
export type Certification = z.infer<typeof certificationSchema>;

/**
 * Reads a `Candidate.extractedData` Json column back into the typed shape.
 *
 * Returns null rather than throwing on anything malformed: the column can hold
 * output from an older prompt version, and a render must never crash because a
 * field moved.
 */
export function parseExtractedData(value: unknown): ExtractedResumeData | null {
  if (value === null || value === undefined) return null;
  const result = extractedResumeDataSchema.safeParse(value);
  return result.success ? result.data : null;
}
