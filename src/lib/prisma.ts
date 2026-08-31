import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * The primary query layer for all server-side logic.
 *
 * Connects on the pooled Supabase URL (`DATABASE_URL`, port 6543) through the
 * Prisma 7 driver adapter. Migrations use the direct connection instead — see
 * `prisma.config.ts`.
 *
 * SECURITY: this connects as the database owner, which BYPASSES row-level
 * security. RLS does not protect these queries; nothing does except the query
 * itself. Every read and write through this client must filter or stamp
 * `orgId` explicitly, using the org id from `requireOrgContext()` in
 * `src/lib/auth.ts`. See `prisma/migrations/*_rls_policies/migration.sql` for
 * the full reasoning.
 */

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_URL. Copy .env.local.example to .env.local and set the pooled Supabase connection string.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js dev mode re-evaluates modules on every hot reload; without this the
// process accumulates connection pools until Postgres refuses new clients.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getPrismaClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;

  const client = createPrismaClient();
  // Cached in production too: the proxy below would otherwise build a new
  // client (and pool) on every property access.
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Construction is deferred to first use rather than module load.
 *
 * `next build` imports every route module to collect page data, and doing that
 * with a top-level `new PrismaClient()` means the build fails on any machine
 * without DATABASE_URL — CI included. Nothing here touches the database until a
 * query actually runs.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    // Top-level helpers ($transaction, $connect, …) lose their receiver when
    // pulled off the proxy, so rebind them. Model delegates are plain objects
    // and pass through untouched.
    return typeof value === "function" ? value.bind(client) : value;
  },
});
