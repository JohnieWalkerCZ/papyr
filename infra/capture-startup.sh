#!/usr/bin/env bash
set -euo pipefail
umask 077

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ $# != 1 || "$1" != /* ]]; then
  echo "Usage: $0 /private/path/papyr-startup.log" >&2
  exit 2
fi
if [[ -e "$1" ]]; then
  echo "Refusing to overwrite existing log: $1" >&2
  exit 2
fi
# Create the file exclusively; startup errors can contain sensitive configuration.
(set -o noclobber; : > "$1")
echo "Capturing startup to $1. Ctrl+C stops the foreground services; volumes are preserved."
cd "$root"
docker compose -f "$root/infra/compose.yaml" --ansi never up --build 2>&1 | tee -a "$1"
