-- Caps forced re-scores per candidate.
--
-- A re-score is an unmetered Claude call: the application was counted once at
-- ingestion and never again, so every re-run is cost with no matching revenue.
-- The cap is generous enough that no honest use reaches it and bounded enough
-- that a held-down button cannot run up an unbounded bill.
--
-- Starts at 0 for existing rows, which is correct rather than merely
-- convenient: nothing was counted before this shipped, so every candidate
-- legitimately begins with a full allowance.
ALTER TABLE "candidates"
  ADD COLUMN "rescoreCount" INTEGER NOT NULL DEFAULT 0;
