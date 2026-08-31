import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * The Prisma CLI reads `.env`, while Next.js reads `.env.local`. Loading both
 * here — `.env.local` first, so it wins — means one file holds the credentials
 * for both, which is what `.env.local.example` documents.
 */
dotenv.config({ path: [".env.local", ".env"], quiet: true });

/**
 * `datasource.url` is used by the CLI only: `migrate`, `db`, `studio`,
 * `introspect`. It deliberately points at `DIRECT_URL`, the un-pooled Supabase
 * connection on port 5432 — migrations create and drop objects inside a
 * session, which pgBouncer's transaction pooling on 6543 cannot support.
 *
 * Application queries use the pooled `DATABASE_URL` through the driver adapter
 * in `src/lib/prisma.ts`. The two are intentionally different connections.
 *
 * Falling back to an empty string rather than `env("DIRECT_URL")` keeps
 * `prisma generate` working with no environment at all — it never opens a
 * connection, and it runs on `postinstall`, including in CI and on Vercel where
 * secrets may not be present at install time. Commands that do need a database
 * fail with Prisma's own connection error.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL ?? "",
    /**
     * Only needed by `prisma migrate diff --from-migrations` and `migrate dev`,
     * which replay the migration history into a throwaway database to compute a
     * diff. Never touched at runtime, and never pointed at a real database —
     * Prisma drops and recreates whatever is here.
     *
     * Spread rather than defaulted to "": Prisma rejects an empty string
     * outright, which would break `migrate deploy` for everyone who has no
     * shadow database configured.
     */
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
  migrations: {
    path: "prisma/migrations",
  },
});
