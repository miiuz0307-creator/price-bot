import pg from "pg";

/**
 * One-time copy of all data from another price-bot database (e.g. the old
 * Replit database) into this one. Runs only when this database has no
 * products and no administrators yet, so it can never overwrite live data.
 *
 * Copies matching columns table by table, keeps ids, then fixes sequences.
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
    const { rows: [counts] } = await client.query<{ products: number; admins: number }>(
      "SELECT (SELECT count(*) FROM price_bot_products)::int AS products, (SELECT count(*) FROM price_bot_admins)::int AS admins",
    );
    if (counts.products > 0 || counts.admins > 0) {
      log("Data import skipped: this database already has data (remove IMPORT_FROM_DATABASE_URL)");
      return { imported: false as const };
    }
    const ssl = /sslmode=disable/u.test(sourceUrl) || /localhost|127\.0\.0\.1/u.test(sourceUrl) ? undefined : { rejectUnauthorized: false };
    const source = new pg.Pool({ connectionString: sourceUrl, ssl, max: 2, connectionTimeoutMillis: 15_000 });
    try {
      const summary: Record<string, number> = {};
      await client.query("BEGIN");
      for (const table of tables) {
        const sourceColumns = await columnsOf(source, table);
        if (!sourceColumns.size) { summary[table] = 0; continue; }
        const targetColumns = await columnsOf(client, table);
        const columns = [...targetColumns.keys()].filter((column) => sourceColumns.has(column));
        const { rows } = await source.query(`SELECT ${columns.map(quote).join(", ")} FROM ${table}`);
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
        if (targetColumns.has("id")) {
          await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT coalesce(max(id), 0) FROM ${table}), 1), (SELECT count(*) > 0 FROM ${table}))`);
        }
        summary[table] = rows.length;
      }
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
