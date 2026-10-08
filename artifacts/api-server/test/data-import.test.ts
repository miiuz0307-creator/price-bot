/**
 * Moving from Replit: an old-schema database with data is copied into a fresh one.
 */
import assert from "node:assert/strict";
import test from "node:test";

test("one-time import from an old (Replit-era) database", { timeout: 60_000 }, async () => {
  const { createPool, importFromDatabase, migrations, runMigrations } = await import("@workspace/db");
  const baseUrl = process.env.DATABASE_URL!;
  const urlFor = (name: string) => baseUrl.replace(/\/[^/?]+(\?|$)/u, `/${name}$1`);
  const admin = createPool(baseUrl);
  for (const name of ["import_src", "import_dst"]) {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  }
  await admin.end();

  // Source = the old schema only (what `drizzle push` created on Replit), no migration history.
  const source = createPool(urlFor("import_src"));
  await source.query(migrations.find((migration) => migration.id === "0000_baseline")!.sql);
  await source.query(`INSERT INTO price_bot_admins (id, phone, label, role, code_hash) VALUES
    (1, '0504107826', 'מיכאל', 'owner', 'scrypt$salt$hash'), (2, '0521234567', 'יצחק', 'admin', NULL)`);
  await source.query(`INSERT INTO price_bot_products (id, name, price, aliases, price_matrix, wait_time) VALUES
    (5, 'בני ברק ⇔ ירושלים', 160, ARRAY['בב ים'], '[160,300,190,360,210,400,230,440]', '₪40 לשעה'),
    (9, 'ירושלים ⇔ תל אביב', 250, '{}', '[250]', '')`);
  await source.query(`INSERT INTO price_bot_abbreviations (shortcut, normalized_shortcut, expansion) VALUES ('רג', 'רג', 'רמת גן')`);
  await source.query(`INSERT INTO price_bot_targets (admin_id, kind, identifier, label) VALUES (1, 'contact', '972501112222', 'לקוח'), (2, 'group', '120363000000000001', 'קבוצה')`);
  await source.query(`INSERT INTO price_bot_lookups (admin_id, "from", body, matched, estimate) VALUES (1, '972501112222', 'מ דימונה ערד', false, '{"name":"דימונה ⇔ ערד","distanceKm":30,"priceMatrix":[120,230,150,280,170,320,190,360]}')`);
  await source.query(`INSERT INTO price_bot_surge_settings (admin_id, active, group_identifiers) VALUES (1, true, ARRAY['120363000000000001'])`);
  await source.end();

  const target = createPool(urlFor("import_dst"));
  await runMigrations(target);
  const result = await importFromDatabase(urlFor("import_src").replace(/(\?|$)/u, "?sslmode=disable$1"), target);
  assert.equal(result.imported, true);

  const owner = (await target.query("SELECT * FROM price_bot_admins WHERE id = 1")).rows[0];
  assert.equal(owner.code_hash, "scrypt$salt$hash", "owner keeps their personal code");
  assert.deepEqual((await target.query("SELECT permissions FROM price_bot_admins WHERE id = 2")).rows[0].permissions,
    ["catalog.edit", "targets.manage", "lookups.manage", "surge.manage", "whatsapp.manage"]);
  const product = (await target.query("SELECT * FROM price_bot_products WHERE id = 5")).rows[0];
  assert.deepEqual(product.price_matrix, [160, 300, 190, 360, 210, 400, 230, 440]);
  assert.deepEqual(product.aliases, ["בב ים"]);
  assert.equal((await target.query("SELECT count(*)::int AS n FROM price_bot_targets")).rows[0].n, 2);
  assert.equal((await target.query("SELECT estimate FROM price_bot_lookups")).rows[0].estimate.distanceKm, 30);
  assert.deepEqual((await target.query("SELECT group_identifiers FROM price_bot_surge_settings")).rows[0].group_identifiers, ["120363000000000001"]);
  // New rows continue after the imported ids.
  const next = (await target.query("INSERT INTO price_bot_products (name, price) VALUES ('חדש', 1) RETURNING id")).rows[0].id;
  assert.equal(next, 10);
  // Never runs twice / never overwrites.
  assert.equal((await importFromDatabase(urlFor("import_src").replace(/(\?|$)/u, "?sslmode=disable$1"), target)).imported, false);
  await target.end();
});
