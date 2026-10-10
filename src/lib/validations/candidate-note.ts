import { z } from "zod";

/**
 * Long enough for real interview feedback, short enough that a note stays a
 * note. Shared with the client so the textarea stops at the same length the
 * server enforces.
 */
export const NOTE_MAX_LENGTH = 2000;

export const noteBodySchema = z
  .string()
  .trim()
  .min(1, "Write something before saving.")
  .max(NOTE_MAX_LENGTH, `Notes are limited to ${NOTE_MAX_LENGTH} characters.`);
