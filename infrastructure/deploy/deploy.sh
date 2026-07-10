#!/usr/bin/env bash
# Deploy with health gate + automatic rollback (docs/02 §4).
#
#   ./deploy.sh <api-image> <web-image>
#
# Runs on the target box (or locally against the prod compose). Keeps a
# `previous` tag alongside the new one; if the health gate fails, the
# previous images are restored and the script exits non-zero so CI reports
# the deploy as failed-but-recovered.
set -euo pipefail

API_IMAGE="${1:?usage: deploy.sh <api-image> <web-image>}"
WEB_IMAGE="${2:?usage: deploy.sh <api-image> <web-image>}"
HEALTH_URL="${HEALTH_URL:-http://localhost:4000/api/v1/health}"
# Plugin (`docker compose`) or classic (`docker-compose`) — take what exists
if docker compose version > /dev/null 2>&1; then
  COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
else
  COMPOSE=(docker-compose -f docker-compose.yml -f docker-compose.prod.yml)
fi
STATE_DIR="${STATE_DIR:-.deploy-state}"
mkdir -p "$STATE_DIR"

log() { printf '\n== %s\n' "$*"; }

health_gate() {
  for attempt in $(seq 1 10); do
    if curl -fsS --max-time 3 "$HEALTH_URL" > /dev/null 2>&1; then
      log "health gate PASSED (attempt $attempt)"
      return 0
    fi
    sleep 3
  done
  return 1
}

deploy() {
  local api="$1" web="$2"
  API_IMAGE="$api" WEB_IMAGE="$web" "${COMPOSE[@]}" pull api web workers 2>/dev/null || true
  log "running database migrations ($api)"
  API_IMAGE="$api" WEB_IMAGE="$web" "${COMPOSE[@]}" run --rm migrate
  log "restarting services"
  API_IMAGE="$api" WEB_IMAGE="$web" "${COMPOSE[@]}" up -d api workers web
}

# Remember what is currently live so we can roll back to it
PREVIOUS_API="$(cat "$STATE_DIR/api" 2>/dev/null || true)"
PREVIOUS_WEB="$(cat "$STATE_DIR/web" 2>/dev/null || true)"

log "deploying $API_IMAGE / $WEB_IMAGE"
# A failed migrate/up counts as a failed deploy too — fall through to rollback
DEPLOY_OK=true
deploy "$API_IMAGE" "$WEB_IMAGE" || DEPLOY_OK=false

if $DEPLOY_OK && health_gate; then
  printf '%s' "$API_IMAGE" > "$STATE_DIR/api"
  printf '%s' "$WEB_IMAGE" > "$STATE_DIR/web"
  log "deploy OK — recorded as rollback target for next time"
  exit 0
fi

log "HEALTH GATE FAILED for $API_IMAGE"
if [[ -n "$PREVIOUS_API" ]]; then
  log "rolling back to $PREVIOUS_API / $PREVIOUS_WEB"
  deploy "$PREVIOUS_API" "$PREVIOUS_WEB"
  if health_gate; then
    log "rollback complete — previous version restored"
  else
    log "rollback ALSO unhealthy — manual intervention required"
  fi
else
  log "no previous version recorded — leaving the failed deploy up for debugging"
fi
exit 1
