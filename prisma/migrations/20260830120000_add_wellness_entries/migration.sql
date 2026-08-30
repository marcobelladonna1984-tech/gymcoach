-- One row per calendar day of imported wellness metrics (steps / sleep /
-- average heart rate) from the health CSV import. Weight is deliberately NOT
-- stored here: it lives in BodyweightEntry (history) and User.bodyweight (the
-- current value), and the import writes both.
CREATE TABLE "WellnessEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "steps" INTEGER,
  "sleepHours" DOUBLE PRECISION,
  "avgHr" INTEGER,
  "source" TEXT,
  CONSTRAINT "WellnessEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WellnessEntry_userId_date_key" ON "WellnessEntry"("userId", "date");
CREATE INDEX "WellnessEntry_userId_date_idx" ON "WellnessEntry"("userId", "date");

ALTER TABLE "WellnessEntry" ADD CONSTRAINT "WellnessEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
