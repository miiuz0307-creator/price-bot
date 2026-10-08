import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { runMigrations } from "./migrations";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// DATABASE_SSL:
//   unset / "off"  → whatever the connection string says (Replit, local Postgres)
//   "require"      → encrypted connection without certificate pinning (Supabase pooler, Railway)
//   "verify"       → encrypted and certificate verified (needs a trusted CA chain)
const sslMode = (process.env.DATABASE_SSL ?? "off").toLowerCase();
const ssl = sslMode === "require" ? { rejectUnauthorized: false }
  : sslMode === "verify" ? { rejectUnauthorized: true }
  : undefined;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(ssl ? { ssl } : {}),
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
export const db = drizzle(pool, { schema });

/**
 * Resolves once the database schema is up to date. Started on first import so
 * every entry point (server, tests, scripts) gets the same schema. Set
 * DB_AUTO_MIGRATE=0 to skip (e.g. read-only tooling).
 */
export const migrationsReady: Promise<void> = process.env.DB_AUTO_MIGRATE === "0"
  ? Promise.resolve()
  : runMigrations(pool, (message) => console.log(message));
// Avoid an unhandled rejection before someone awaits it; awaiting still rethrows.
migrationsReady.catch(() => undefined);

export { runMigrations, migrations } from "./migrations";
export * from "./schema";
