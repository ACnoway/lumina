#!/bin/sh

set -eu

baseline_migration="20260917000000_baseline"
migration_log="$(mktemp)"
diff_log="$(mktemp)"

cleanup() {
  rm -f "$migration_log" "$diff_log"
}

trap cleanup EXIT

cd /app/apps/backend

# New databases receive the baseline normally. A database initialized by the
# old `prisma db push` startup has no migration history, so migrate deploy
# returns P3005. Only adopt that database when a read-only schema diff proves
# that it exactly matches the current Prisma schema.
if pnpm exec prisma migrate deploy >"$migration_log" 2>&1; then
  cat "$migration_log"
else
  migration_status=$?
  cat "$migration_log"

  if ! grep -Fq 'P3005' "$migration_log"; then
    exit "$migration_status"
  fi

  echo 'Existing database detected without Prisma migration history; verifying schema before baselining.'
  if pnpm exec prisma migrate diff \
    --from-schema-datasource prisma/schema.prisma \
    --to-schema-datamodel prisma/schema.prisma \
    --exit-code >"$diff_log" 2>&1; then
    cat "$diff_log"
  else
    diff_status=$?
    cat "$diff_log"
    echo 'Database schema differs from Prisma schema; refusing to mark the baseline as applied.' >&2
    exit "$diff_status"
  fi

  pnpm exec prisma migrate resolve --applied "$baseline_migration"
  pnpm exec prisma migrate deploy
fi

exec node dist/main.js
