#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: $0 BACKUP_DIRECTORY" >&2
  exit 2
fi

backup="$(cd "$1" && pwd)"
for file in database.dump assets.tar.gz assets.sha256 SHA256SUMS manifest.json; do
  [[ -f "$backup/$file" ]] || { echo "Missing backup file: $file" >&2; exit 2; }
done
(cd "$backup" && sha256sum --check SHA256SUMS)
read -r -p "This replaces the Papyr database and all assets. Type RESTORE to continue: " confirmation
[[ "$confirmation" == RESTORE ]] || { echo "Restore cancelled."; exit 1; }

root="$(cd "$(dirname "$0")/.." && pwd)"
compose=(docker compose -f "$root/infra/compose.yaml")
api_was_running=false
if [[ -n "$("${compose[@]}" ps --status running -q api)" ]]; then api_was_running=true; fi
"${compose[@]}" up -d db
"${compose[@]}" stop api >/dev/null
"${compose[@]}" exec -T db pg_restore --exit-on-error --no-owner --clean --if-exists --create --username=papyr --dbname=postgres <"$backup/database.dump"
"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh api -c 'find /data/assets -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
"${compose[@]}" run --rm --no-deps --entrypoint tar api -C /data/assets -xzf - <"$backup/assets.tar.gz"
"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh api -c 'cd /data/assets && sha256sum --check -' <"$backup/assets.sha256"
if [[ "$api_was_running" == true ]]; then "${compose[@]}" start api >/dev/null; fi
echo "Restore completed from $backup"
