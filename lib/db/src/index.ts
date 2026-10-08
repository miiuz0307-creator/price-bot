import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

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

export * from "./schema";
