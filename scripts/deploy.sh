#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env.production ]; then
  echo 'Falta .env.production. Copiá .env.production.example y completá los valores del servidor.' >&2
  exit 1
fi
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build app
docker compose --env-file .env.production -f compose.production.yaml up -d --wait --wait-timeout 180 app db backup
