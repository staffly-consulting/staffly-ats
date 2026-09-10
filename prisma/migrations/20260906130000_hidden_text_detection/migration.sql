-- Records deterministic detection of text hidden from human readers in a
-- resume (white-on-white, microscopic fonts, PDF render mode 3), which is
-- almost always a prompt injection aimed at the AI screener.
--
-- Additive and defaulted, so existing rows are correct without a backfill:
-- nothing was scanned before this shipped, and `false` is the honest value for
-- "we did not look" as well as for "we looked and found nothing". The column
-- never gates anything, so the ambiguity costs nothing.
ALTER TABLE "candidates"
  ADD COLUMN "hiddenTextFound" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hiddenTextNote" TEXT;
