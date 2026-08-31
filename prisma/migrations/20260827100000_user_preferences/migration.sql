-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'TH');

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "preferredLanguage" "Language" NOT NULL DEFAULT 'EN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_clerkUserId_key" ON "user_preferences"("clerkUserId");


-- =============================================================================
-- Row Level Security
-- =============================================================================
--
-- Unlike every other table in this schema, `user_preferences` is scoped to a
-- PERSON, not an organization — the whole point is that a preference follows
-- someone across the organizations they belong to. So the policy matches on the
-- JWT's `sub` (the user id) rather than on `staffly_org_id()`.
--
-- Practical effect: a user can read and write only their own row, and cannot
-- see the preferences of anyone else, including their own colleagues.

grant select, insert, update, delete on public.user_preferences to authenticated;
revoke all on public.user_preferences from anon;

alter table public.user_preferences enable row level security;

create policy "user_preferences_own_row_only"
  on public.user_preferences
  for all
  to authenticated
  using ("clerkUserId" = (auth.jwt() ->> 'sub'))
  with check ("clerkUserId" = (auth.jwt() ->> 'sub'));
