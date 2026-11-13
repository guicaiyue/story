#!/usr/bin/env bash
#
# Builds the isolated DEV database from the real legacy structure + a dump of
# production content.
#
# 03-decisions D7: production `story` is NEVER written to during development —
# it serves storynook.cn. All migrations, seeds and integration work target
# `story-dev-postgres` instead.
#
# Usage:
#   ./scripts/dev-db.sh dump     # read-only export from production (COPY)
#   ./scripts/dev-db.sh restore  # rebuild dev DB: legacy schema -> content -> migrations
#   ./scripts/dev-db.sh reset    # drop and recreate the dev database
#
# The production reads are strictly SELECT/COPY TO STDOUT.

set -euo pipefail

DEV_CONTAINER="${DEV_CONTAINER:-story-dev-postgres}"
DEV_USER="${DEV_USER:-storydev}"
DEV_DB="${DEV_DB:-story_dev}"
PROD_CONTAINER="${PROD_CONTAINER:-postgres}"
PROD_DB="${PROD_DB:-story}"
DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.dev-data"
LEGACY_SCHEMA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/prisma/legacy-schema.sql"

mkdir -p "$DATA_DIR"

dev_psql() { docker exec -i "$DEV_CONTAINER" psql -U "$DEV_USER" -d "$DEV_DB" "$@"; }
prod_copy() { docker exec "$PROD_CONTAINER" psql -U postgres -d "$PROD_DB" -c "\copy ($1) TO STDOUT"; }

dump_content() {
  echo "==> exporting legacy columns from production (read-only)"
  prod_copy "SELECT id, name, sort_id FROM public.story_category ORDER BY id" > "$DATA_DIR/story_category.tsv"
  prod_copy "SELECT id, category_id, title, category_name, created_at, excerpt, length FROM public.story_main ORDER BY id" > "$DATA_DIR/story_main.tsv"
  prod_copy "SELECT id, story_id, content FROM public.story_content ORDER BY id" > "$DATA_DIR/story_content.tsv"

  echo "    story_category : $(( $(wc -l < "$DATA_DIR/story_category.tsv") )) rows"
  echo "    story_main     : $(( $(wc -l < "$DATA_DIR/story_main.tsv") )) rows"
  echo "    story_content  : $(( $(wc -l < "$DATA_DIR/story_content.tsv") )) rows"
}

reset_db() {
  echo "==> recreating dev database $DEV_DB"
  dev_psql -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" >/dev/null
  dev_psql -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS app CASCADE;" >/dev/null
}

restore_db() {
  echo "==> applying legacy schema (pre-M1 structure)"
  dev_psql -v ON_ERROR_STOP=1 -q < "$LEGACY_SCHEMA"

  echo "==> loading production content dump"
  # COPY into the legacy column set; sequences are fixed up afterwards.
  dev_psql -v ON_ERROR_STOP=1 -q -c "\copy public.story_category (id, name, sort_id) FROM STDIN" < "$DATA_DIR/story_category.tsv"
  dev_psql -v ON_ERROR_STOP=1 -q -c "\copy public.story_main (id, category_id, title, category_name, created_at, excerpt, length) FROM STDIN" < "$DATA_DIR/story_main.tsv"
  dev_psql -v ON_ERROR_STOP=1 -q -c "\copy public.story_content (id, story_id, content) FROM STDIN" < "$DATA_DIR/story_content.tsv"

  dev_psql -v ON_ERROR_STOP=1 -q -c "SELECT setval('story_main_id_seq', (SELECT max(id) FROM public.story_main));"
  dev_psql -v ON_ERROR_STOP=1 -q -c "SELECT setval('story_content_id_seq', (SELECT max(id) FROM public.story_content));"
  dev_psql -v ON_ERROR_STOP=1 -q -c "SELECT setval('story_category_id_seq', (SELECT max(id) FROM public.story_category));"

  echo "==> dev database rebuilt:"
  dev_psql -tAc "SELECT 'stories=' || (SELECT count(*) FROM public.story_main) || ' contents=' || (SELECT count(*) FROM public.story_content) || ' categories=' || (SELECT count(*) FROM public.story_category)"
}

case "${1:-restore}" in
  dump)    dump_content ;;
  reset)   reset_db ;;
  restore) reset_db; restore_db ;;
  *) echo "usage: $0 {dump|restore|reset}" >&2; exit 1 ;;
esac
