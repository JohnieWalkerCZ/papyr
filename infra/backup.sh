#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 BACKUP_DIRECTORY" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
backup="$(mkdir -p "$(dirname "$1")" && cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [[ -e "$backup" ]]; then
  echo "Backup directory already exists: $backup" >&2
  exit 2
fi
mkdir "$backup"
compose=(docker compose -f "$root/infra/compose.yaml")
api_was_running=false
if [[ -n "$("${compose[@]}" ps --status running -q api)" ]]; then api_was_running=true; fi

restart_api() {
  if [[ "$api_was_running" == true ]]; then "${compose[@]}" start api >/dev/null; fi
}
trap restart_api EXIT

"${compose[@]}" stop api >/dev/null
"${compose[@]}" exec -T db pg_dump --no-owner --format=custom --username=papyr papyr >"$backup/database.dump"
"${compose[@]}" run --rm --no-deps --entrypoint tar api -C /data/assets -czf - . >"$backup/assets.tar.gz"
"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh api -c 'cd /data/assets && find . -type f -print0 | sort -z | xargs -0 -r sha256sum' >"$backup/assets.sha256"
(
  cd "$backup"
  sha256sum database.dump assets.tar.gz assets.sha256 >SHA256SUMS
  printf '{\n  "formatVersion": 1,\n  "createdAtUtc": "%s",\n  "files": {\n    "database.dump": "%s",\n    "assets.tar.gz": "%s",\n    "assets.sha256": "%s"\n  }\n}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(sha256sum database.dump | cut -d' ' -f1)" \
    "$(sha256sum assets.tar.gz | cut -d' ' -f1)" \
    "$(sha256sum assets.sha256 | cut -d' ' -f1)" >manifest.json
)
echo "Backup written to $backup"
