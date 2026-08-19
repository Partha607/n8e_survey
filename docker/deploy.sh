#!/usr/bin/env bash
# Server-side deploy script — lives at /srv/n8e-collect/deploy.sh on the AWS box.
# (Server-only; developer-run scripts stay cross-platform Node per CLAUDE.md.)
# Usage: APP_TAG=v1.2.3 ./deploy.sh   ·   Rollback: APP_TAG=<previous-tag> ./deploy.sh
set -euo pipefail

APP_TAG="${APP_TAG:?APP_TAG required (image tag to deploy)}"
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Deploying n8e-collect ${APP_TAG}"
export APP_TAG

$COMPOSE pull app migrate
echo "==> Running migrations (one-shot)"
$COMPOSE run --rm migrate
echo "==> Swapping app"
$COMPOSE up -d app caddy postgres
echo "==> Waiting for health"
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/core/v1/health > /dev/null 2>&1 || \
     $COMPOSE exec -T app node -e "fetch('http://localhost:3000/api/core/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "==> Healthy. Deployed ${APP_TAG}."
    exit 0
  fi
  sleep 2
done
echo "!! App failed health check after deploy — roll back with the previous APP_TAG" >&2
exit 1
