import pg from "pg";

/**
 * One-time copy of all data from another price-bot database (e.g. the old
 * Replit database) into this one. Runs only while this database has no
 * products yet, so it can never overwrite a live catalog.
 *
 * Administrators are matched by phone (the owner may already exist here); their
 * personal codes and roles come from the source. Other tables keep their ids,
 * with administrator references translated, then sequences are fixed.
 * Temporary surge offers are not copied (they expire in minutes anyway).
 */
const tables = [
  "price_bot_admins",
  "price_bot_products",
  "price_bot_abbreviations",
  "price_bot_targets",
  "price_bot_lookups",
  "price_bot_surge_settings",
] as const;

type Log = (message: string) => void;

export async function importFromDatabase(sourceUrl: string, target: pg.Pool, log: Log = () => undefined) {
  const client = await target.connect();
  try {
    const { rows: [counts] } = await client.query<{ products: number }>(
      "SELECT (SELECT count(*) FROM price_bot_products)::int AS products",
    );
    if (counts.products > 0) {
      log("Data import skipped: this database already has data (remove IMPORT_FROM_DATABASE_URL)");
      return { imported: false as const };
    }
    const ssl = /sslmode=disable/u.test(sourceUrl) || /localhost|127\.0\.0\.1/u.test(sourceUrl) ? undefined : { rejectUnauthorized: false };
    const source = new pg.Pool({ connectionString: sourceUrl, ssl, max: 2, connectionTimeoutMillis: 15_000 });
    try {
      const summary: Record<string, number> = {};
      await client.query("BEGIN");
      // Administrators: upsert by phone, remember source id → target id.
      const adminIds = new Map<number, number>();
      {
        const { rows: admins } = await source.query("SELECT * FROM price_bot_admins ORDER BY id");
        for (const admin of admins) {
          const { rows: [row] } = await client.query<{ id: number }>(
            `INSERT INTO price_bot_admins (phone, label, role, active, code_hash, added_at) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (phone) DO UPDATE SET label = EXCLUDED.label, role = EXCLUDED.role, active = EXCLUDED.active,
               code_hash = COALESCE(EXCLUDED.code_hash, price_bot_admins.code_hash)
             RETURNING id`,
            [admin.phone, admin.label, admin.role, admin.active, admin.code_hash, admin.added_at],
          );
          adminIds.set(admin.id, row.id);
        }
        summary.price_bot_admins = admins.length;
      }
      for (const table of tables) {
        if (table === "price_bot_admins") continue;
        const sourceColumns = await columnsOf(source, table);
        if (!sourceColumns.size) { summary[table] = 0; continue; }
        const targetColumns = await columnsOf(client, table);
        const columns = [...targetColumns.keys()].filter((column) => sourceColumns.has(column));
        const { rows: sourceRows } = await source.query(`SELECT ${columns.map(quote).join(", ")} FROM ${table}`);
        // Translate administrator references; drop rows of administrators that no longer exist.
        const rows = columns.includes("admin_id")
          ? sourceRows.flatMap((row) => row.admin_id === null ? [row] : adminIds.has(row.admin_id) ? [{ ...row, admin_id: adminIds.get(row.admin_id) }] : [])
          : sourceRows;
        for (let start = 0; start < rows.length; start += 200) {
          const batch = rows.slice(start, start + 200);
          const values: unknown[] = [];
          const tuples = batch.map((row) => `(${columns.map((column) => {
            const value = row[column];
            values.push(targetColumns.get(column) === "jsonb" && value !== null ? JSON.stringify(value) : value);
            return `$${values.length}`;
          }).join(", ")})`);
          await client.query(`INSERT INTO ${table} (${columns.map(quote).join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`, values);
        }
        if (targetColumns.has("id") && rows.length) {
          await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT coalesce(max(id), 0) FROM ${table}), 1), (SELECT count(*) > 0 FROM ${table}))`);
        }
        summary[table] = rows.length;
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('price_bot_admins', 'id'), (SELECT coalesce(max(id), 1) FROM price_bot_admins))`);
      // Managers imported from before permissions existed keep everything they could do.
      await client.query(`UPDATE price_bot_admins SET permissions = ARRAY['catalog.edit', 'targets.manage', 'lookups.manage', 'surge.manage', 'whatsapp.manage']
        WHERE role <> 'owner' AND permissions = '{}'`);
      await client.query("COMMIT");
      log(`Data import finished: ${Object.entries(summary).map(([table, count]) => `${table.replace("price_bot_", "")}=${count}`).join(", ")}`);
      return { imported: true as const, summary };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(`Data import failed (nothing was changed): ${(error as Error).message}`);
    } finally {
      await source.end().catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

const quote = (identifier: string) => `"${identifier.replace(/"/gu, '""')}"`;

async function columnsOf(db: pg.Pool | pg.PoolClient, table: string) {
  const { rows } = await db.query<{ column_name: string; data_type: string }>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    [table],
  );
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}
