#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres and runs tests/db/*_test.sql.
# Needs Postgres 15+ binaries (initdb, pg_ctl, psql) on PATH or in PG_BIN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PG_BIN:$PATH"
PORT="${PGTEST_PORT:-54329}"
DATA="$(mktemp -d)"
LOG="$DATA/pg.log"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$DATA"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() { "${RUN_AS[@]}" pg_ctl -D "$DATA/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

"${RUN_AS[@]}" initdb -D "$DATA/db" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$DATA/db" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$LOG" -w start >/dev/null

PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -f "$ROOT/tests/db/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -f "$f" >/dev/null
done
# Migrations must be re-runnable where they claim to be (seed files).
for f in "$ROOT"/supabase/migrations/*seed*.sql; do
  "${PSQL[@]}" -f "$f" >/dev/null
done

fail=0
for f in "$ROOT"/tests/db/*_test.sql; do
  if "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err"; then
    echo "pass     $(basename "$f")"
  else
    echo "FAIL     $(basename "$f")"; cat "$DATA/err"; fail=1
  fi
done
exit $fail
