#!/bin/bash
# Restore the already initialized demo database/backend; leave Vite untouched.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$project_root"
[[ "$(uname -s)" == Darwin ]] || { echo 'This script requires macOS.' >&2; exit 1; }
[[ "$(id -u)" != 0 ]] || { echo 'Run as your normal Mac user, without sudo.' >&2; exit 1; }
brew_bin="$(command -v brew || true)"
if [[ -z "$brew_bin" ]]; then
  if [[ -x /opt/homebrew/bin/brew ]]; then brew_bin=/opt/homebrew/bin/brew; else brew_bin=/usr/local/bin/brew; fi
fi
export PATH="$("$brew_bin" --prefix node@22)/bin:$("$brew_bin" --prefix postgresql@16)/bin:$PATH"
demo_root="$project_root/.runtime/local-demo"
data_dir="$demo_root/postgres"
[[ -f "$data_dir/PG_VERSION" && -f "$demo_root/database-password" ]] || {
  echo 'Demo database is not initialized. Run start-local-demo-macos.sh first.' >&2
  exit 1
}
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'Port 3000 is already occupied; refusing to start another backend.' >&2
  exit 1
fi
export NODE_ENV=development PORT=3000
# Explicit local fixture adapter; live FOP remains unconfigured unless separately integrated.
export FOP_DATA_MODE=demo
export DB_HOST=127.0.0.1 DB_PORT=55432 DB_USERNAME=autoflow_demo DB_DATABASE=autoflow_local_demo
export DB_PASSWORD="$(cat "$demo_root/database-password")"
export DB_SSL=false DB_SYNCHRONIZE=false DB_MIGRATIONS_RUN=false
export ENABLE_ADMIN_BOOTSTRAP=false ALIBABA_1688_ENABLED=false

started_database=false
cleanup() {
  if [[ "$started_database" == true ]]; then pg_ctl -D "$data_dir" -m fast -w stop || true; fi
}
trap cleanup EXIT
if ! pg_ctl -D "$data_dir" status >/dev/null 2>&1; then
  if lsof -nP -iTCP:55432 -sTCP:LISTEN >/dev/null 2>&1; then
    echo 'Port 55432 is occupied by another service.' >&2
    exit 1
  fi
  pg_ctl -D "$data_dir" -l "$demo_root/postgres.log" -o '-h 127.0.0.1 -p 55432 -k /tmp' -w start
  started_database=true
fi
actual_data_dir="$(PGPASSWORD="$DB_PASSWORD" psql -X -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_DATABASE" -Atc 'SHOW data_directory')"
[[ "$actual_data_dir" == "$data_dir" ]] || { echo 'Database identity mismatch.' >&2; exit 1; }
echo 'Demo database connected. Starting backend on port 3000.'
echo 'Keep this terminal open. Once Nest is ready, retry the existing login page.'
npm run dev:backend
