-- Tracks whether anyone has opened a candidate yet.
--
-- Org-wide rather than per-person: one column, one answer. Nullable, so no
-- backfill is needed and no default has to lie — every existing candidate is
-- genuinely unread, because nothing was recording it before now.
ALTER TABLE "candidates"
  ADD COLUMN "readAt" TIMESTAMP(3);

-- The unread queue is the common read on the job post page, and it is a
-- partial index: only unread rows are indexed, so it stays small as a job post
-- accumulates thousands of candidates that have all been looked at.
CREATE INDEX "candidates_orgId_jobPostId_unread_idx"
  ON "candidates" ("orgId", "jobPostId")
  WHERE "readAt" IS NULL;
