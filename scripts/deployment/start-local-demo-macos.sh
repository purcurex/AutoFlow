#!/bin/bash
# Run from the macOS Terminal. Existing .env files and databases are not edited.
set -euo pipefail

[[ "$(uname -s)" == Darwin ]] || { echo 'This script requires macOS.' >&2; exit 1; }
[[ "$(id -u)" != 0 ]] || { echo 'Run as your normal Mac user, not with sudo.' >&2; exit 1; }
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$project_root"

brew_bin="$(command -v brew || true)"
if [[ -z "$brew_bin" ]]; then
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$candidate" ]]; then brew_bin="$candidate"; break; fi
  done
fi
if [[ -z "$brew_bin" ]]; then
  installer="$(mktemp -t autoflow-homebrew)"
  curl --fail --location --connect-timeout 15 --max-time 120 \
    https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
  /bin/bash "$installer"
  rm -f "$installer"
  if [[ "$(uname -m)" == arm64 ]]; then brew_bin=/opt/homebrew/bin/brew; else brew_bin=/usr/local/bin/brew; fi
fi

"$brew_bin" install node@22 postgresql@16
export PATH="$("$brew_bin" --prefix node@22)/bin:$("$brew_bin" --prefix postgresql@16)/bin:$PATH"
node --version
npm --version

export NODE_ENV=development
export DB_HOST=127.0.0.1 DB_PORT=55432
export DB_USERNAME=autoflow_demo DB_DATABASE=autoflow_local_demo
export DB_SSL=false DB_SYNCHRONIZE=false DB_MIGRATIONS_RUN=false
export ENABLE_ADMIN_BOOTSTRAP=false ALIBABA_1688_ENABLED=false
export DEV_SEED_PASSWORD=AutoFlowLocal123
export PORT=3000

for app_port in 3000 5173; do
  if lsof -nP -iTCP:"$app_port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $app_port is already in use. Stop that service before continuing." >&2
    exit 1
  fi
done

umask 077
demo_root="$project_root/.runtime/local-demo"
data_dir="$demo_root/postgres"
mkdir -p "$demo_root"
if [[ ! -f "$demo_root/database-password" ]]; then
  if [[ -f "$data_dir/PG_VERSION" ]]; then
    echo 'Existing demo cluster is missing its password file; refusing to reset it.' >&2
    exit 1
  fi
  openssl rand -hex 24 > "$demo_root/database-password"
fi
export DB_PASSWORD="$(cat "$demo_root/database-password")"
export PGPASSWORD="$DB_PASSWORD"

if [[ ! -f "$data_dir/PG_VERSION" ]]; then
  initdb -D "$data_dir" -U "$DB_USERNAME" \
    --pwfile="$demo_root/database-password" --auth=scram-sha-256 --encoding=UTF8
fi
started_database=false
cleanup() {
  if [[ "$started_database" == true ]]; then
    pg_ctl -D "$data_dir" -m fast -w stop || true
  fi
}
trap cleanup EXIT
if ! pg_ctl -D "$data_dir" status >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$DB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $DB_PORT is occupied; refusing to use an unrelated database." >&2
    exit 1
  fi
  pg_ctl -D "$data_dir" -l "$demo_root/postgres.log" \
    -o "-h 127.0.0.1 -p $DB_PORT -k /tmp" -w start
  started_database=true
fi
actual_data_dir="$(psql -X -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d postgres -Atc 'SHOW data_directory')"
[[ "$actual_data_dir" == "$data_dir" ]] || { echo 'Database identity mismatch; stopping.' >&2; exit 1; }
exists="$(psql -X -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='autoflow_local_demo'")"
if [[ "$exists" != 1 ]]; then
  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" "$DB_DATABASE"
fi

# Reinstall platform-specific dependencies using the existing lockfile.
npm ci
npm run db:migrate
npm run seed --workspace=backend
unset PGPASSWORD
echo
echo 'Demo account initialized: test@autoflow.local / AutoFlowLocal123'
echo 'Starting services. Once Vite and Nest report ready, open http://localhost:5173/login'
echo 'Keep this terminal open; Ctrl+C stops the app and the database started by this script.'
npm run dev
