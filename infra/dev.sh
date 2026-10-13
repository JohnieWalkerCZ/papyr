#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [[ -f .env ]]; then chmod 600 .env; fi

setup_token="$(openssl rand -base64 32)"
touch .env
sed -i '/^PAPYR_INITIAL_SETUP_TOKEN=/d' .env
printf '\nPAPYR_INITIAL_SETUP_TOKEN=%s\n' "$setup_token" >> .env
printf 'Generated first-owner setup token (saved in .env): %s\n' "$setup_token"
export PAPYR_INITIAL_SETUP_TOKEN="$setup_token"

docker compose -f infra/compose.yaml up -d --build api db
exec pnpm --filter @papyr/web dev
