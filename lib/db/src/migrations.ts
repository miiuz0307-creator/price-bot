import type { Pool } from "pg";

/**
 * Ordered, idempotent schema migrations, applied automatically at server start.
 *
 * Rules:
 *  - Never edit a migration that has shipped; add a new one.
 *  - Every statement must be safe on a database that already has the change
 *    (IF NOT EXISTS / guarded DO blocks), because the original Replit database
 *    was created with `drizzle push` and has no migration history.
 *  - Names follow Drizzle's conventions so the CI schema check can compare the
 *    migrated database with the TypeScript schema.
 */
export const migrations: { id: string; sql: string }[] = [
  {
    id: "0000_baseline",
    sql: `
CREATE TABLE IF NOT EXISTS price_bot_products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'ILS',
  aliases text[] NOT NULL DEFAULT '{}',
  distance text NOT NULL DEFAULT '',
  duration text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT '',
  price_matrix jsonb NOT NULL DEFAULT '[]'::jsonb,
  wait_time text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_bot_admins (
  id serial PRIMARY KEY,
  phone text NOT NULL,
  label text NOT NULL DEFAULT 'מנהל',
  role text NOT NULL DEFAULT 'admin',
  active boolean NOT NULL DEFAULT true,
  code_hash text,
  added_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_bot_admins_phone_unique UNIQUE (phone)
);

CREATE TABLE IF NOT EXISTS price_bot_targets (
  id serial PRIMARY KEY,
  admin_id integer,
  kind text NOT NULL,
  identifier text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  added_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_bot_targets_admin_id_price_bot_admins_id_fk FOREIGN KEY (admin_id) REFERENCES price_bot_admins(id) ON DELETE CASCADE,
  CONSTRAINT price_bot_targets_admin_identifier_unique UNIQUE (admin_id, identifier)
);

CREATE TABLE IF NOT EXISTS price_bot_lookups (
  id serial PRIMARY KEY,
  admin_id integer,
  "from" text NOT NULL,
  body text NOT NULL,
  matched boolean NOT NULL DEFAULT false,
  estimate jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_bot_lookups_admin_id_price_bot_admins_id_fk FOREIGN KEY (admin_id) REFERENCES price_bot_admins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_bot_abbreviations (
  id serial PRIMARY KEY,
  shortcut text NOT NULL,
  normalized_shortcut text NOT NULL,
  expansion text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_bot_abbreviations_normalized_shortcut_unique UNIQUE (normalized_shortcut)
);

CREATE TABLE IF NOT EXISTS price_bot_surge_settings (
  admin_id integer PRIMARY KEY,
  active boolean NOT NULL DEFAULT false,
  group_identifiers text[] NOT NULL DEFAULT '{}',
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_bot_surge_settings_admin_id_price_bot_admins_id_fk FOREIGN KEY (admin_id) REFERENCES price_bot_admins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_bot_surge_offers (
  id serial PRIMARY KEY,
  admin_id integer NOT NULL,
  product_id integer NOT NULL,
  price integer NOT NULL,
  vehicle_type text NOT NULL DEFAULT 'regular',
  extra_passenger boolean NOT NULL DEFAULT false,
  direction_key text NOT NULL DEFAULT '',
  quoted_route text NOT NULL DEFAULT '',
  group_identifier text NOT NULL,
  observed_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT price_bot_surge_offers_admin_id_price_bot_admins_id_fk FOREIGN KEY (admin_id) REFERENCES price_bot_admins(id) ON DELETE CASCADE,
  CONSTRAINT price_bot_surge_offers_product_id_price_bot_products_id_fk FOREIGN KEY (product_id) REFERENCES price_bot_products(id) ON DELETE CASCADE,
  CONSTRAINT price_bot_surge_offers_direction_variant_unique UNIQUE (admin_id, product_id, vehicle_type, extra_passenger, direction_key)
);
`,
  },
  {
    id: "0001_accounts_permissions_sessions",
    sql: `
ALTER TABLE price_bot_admins ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE price_bot_admins ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE price_bot_admins ADD COLUMN IF NOT EXISTS whatsapp_owner_id integer;
ALTER TABLE price_bot_admins ADD COLUMN IF NOT EXISTS invited_at timestamp with time zone;
ALTER TABLE price_bot_admins ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone;
ALTER TABLE price_bot_admins ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_bot_admins_email_unique') THEN
    ALTER TABLE price_bot_admins ADD CONSTRAINT price_bot_admins_email_unique UNIQUE (email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_bot_admins_whatsapp_owner_id_price_bot_admins_id_fk') THEN
    ALTER TABLE price_bot_admins ADD CONSTRAINT price_bot_admins_whatsapp_owner_id_price_bot_admins_id_fk
      FOREIGN KEY (whatsapp_owner_id) REFERENCES price_bot_admins(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Existing managers keep everything they could do before (catalog editing included);
-- only managing other users becomes owner-controlled. The owner can narrow this later.
UPDATE price_bot_admins
   SET permissions = ARRAY['catalog.edit', 'targets.manage', 'lookups.manage', 'surge.manage', 'whatsapp.manage']
 WHERE role <> 'owner' AND permissions = '{}';

CREATE INDEX IF NOT EXISTS price_bot_lookups_admin_pending_idx ON price_bot_lookups (admin_id, matched, created_at);

CREATE TABLE IF NOT EXISTS price_bot_sessions (
  id serial PRIMARY KEY,
  token_hash text NOT NULL,
  admin_id integer NOT NULL,
  method text NOT NULL DEFAULT 'pin',
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  CONSTRAINT price_bot_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT price_bot_sessions_admin_id_price_bot_admins_id_fk FOREIGN KEY (admin_id) REFERENCES price_bot_admins(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS price_bot_sessions_admin_idx ON price_bot_sessions (admin_id);

CREATE TABLE IF NOT EXISTS price_bot_login_codes (
  id serial PRIMARY KEY,
  admin_id integer NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  CONSTRAINT price_bot_login_codes_admin_id_price_bot_admins_id_fk FOREIGN KEY (admin_id) REFERENCES price_bot_admins(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS price_bot_login_codes_admin_idx ON price_bot_login_codes (admin_id);

CREATE TABLE IF NOT EXISTS price_bot_audit_log (
  id serial PRIMARY KEY,
  actor_id integer,
  action text NOT NULL,
  target_type text NOT NULL DEFAULT '',
  target_id text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_bot_audit_log_actor_id_price_bot_admins_id_fk FOREIGN KEY (actor_id) REFERENCES price_bot_admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS price_bot_audit_log_created_idx ON price_bot_audit_log (created_at);
CREATE INDEX IF NOT EXISTS price_bot_audit_log_actor_idx ON price_bot_audit_log (actor_id);
`,
  },
];

/** Applies pending migrations once, under an advisory lock (safe with several instances). */
export async function runMigrations(pool: Pool, log: (message: string) => void = () => undefined) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274001)");
    await client.query(`CREATE TABLE IF NOT EXISTS price_bot_schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamp with time zone NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ id: string }>("SELECT id FROM price_bot_schema_migrations");
    const applied = new Set(rows.map((row) => row.id));
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO price_bot_schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
        log(`Applied database migration ${migration.id}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Database migration ${migration.id} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274001)").catch(() => undefined);
    client.release();
  }
}
