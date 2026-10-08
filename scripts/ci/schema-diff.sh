#!/usr/bin/env bash
# Compares two PostgreSQL databases' schemas (columns, constraints, indexes).
# Usage: scripts/ci/schema-diff.sh <url-a> <url-b>
set -euo pipefail
dump() {
  psql "$1" -At -v ON_ERROR_STOP=1 <<'SQL'
select 'col', table_name, column_name, data_type, is_nullable, coalesce(column_default, '')
  from information_schema.columns
 where table_schema = 'public' and table_name <> 'price_bot_schema_migrations'
 order by table_name, column_name;
select 'con', conrelid::regclass::text, conname, contype
  from pg_constraint
 where connamespace = 'public'::regnamespace and conrelid::regclass::text <> 'price_bot_schema_migrations'
 order by 2, 3;
select 'idx', tablename, indexname, regexp_replace(indexdef, ' USING btree', '')
  from pg_indexes
 where schemaname = 'public' and tablename <> 'price_bot_schema_migrations'
 order by 2, 3;
SQL
}
diff <(dump "$1") <(dump "$2") && echo "Schemas are identical"
