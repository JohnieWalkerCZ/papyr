#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [[ -f .env ]]; then chmod 600 .env; fi

setup_token="${PAPYR_INITIAL_SETUP_TOKEN:-}"
if [[ -z "$setup_token" && -f .env ]]; then
  setup_token="$(sed -n 's/^PAPYR_INITIAL_SETUP_TOKEN=//p' .env | tail -n 1)"
fi
if [[ -z "$setup_token" ]]; then
  setup_token="$(openssl rand -base64 32)"
  touch .env
  sed -i '/^PAPYR_INITIAL_SETUP_TOKEN=/d' .env
  printf '\nPAPYR_INITIAL_SETUP_TOKEN=%s\n' "$setup_token" >> .env
  printf 'Generated first-owner setup token (saved in .env): %s\n' "$setup_token"
elif [[ ${#setup_token} -lt 32 ]]; then
  echo 'PAPYR_INITIAL_SETUP_TOKEN must be at least 32 characters.' >&2
  exit 1
fi
export PAPYR_INITIAL_SETUP_TOKEN="$setup_token"

docker compose -f infra/compose.yaml up -d --build api db
exec pnpm --filter @papyr/web dev
