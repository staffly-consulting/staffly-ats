-- Adds the EXTRACTED status: the resume has been read and `extractedData`
-- populated, but the candidate has not been scored against any job post yet.
--
-- `BEFORE 'SCORED'` rather than a bare ADD VALUE (which appends): enum sort
-- order in Postgres follows declaration order, so this keeps ORDER BY status
-- matching the real pipeline sequence and mirrors the schema file.
--
-- Safe inside Prisma's migration transaction on PG 12+ as long as the new value
-- is not *used* in the same transaction — nothing below references it.
ALTER TYPE "CandidateStatus" ADD VALUE IF NOT EXISTS 'EXTRACTED' BEFORE 'SCORED';
