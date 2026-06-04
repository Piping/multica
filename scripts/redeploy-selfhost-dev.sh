#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-.env}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-multica-backend}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-multica-frontend}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-multica-postgres}"
NETWORK_NAME="${NETWORK_NAME:-multica}"
BACKEND_VOLUME="${BACKEND_VOLUME:-multica_backend_uploads}"
BACKEND_IMAGE="${BACKEND_IMAGE:-multica-backend:dev}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-multica-web:dev}"
BACKEND_ALIAS="${BACKEND_ALIAS:-backend}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
REMOTE_API_URL="${REMOTE_API_URL:-http://backend:8080}"
NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-}"
NEXT_PUBLIC_APP_VERSION="${NEXT_PUBLIC_APP_VERSION:-dev}"
MODE="auto"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: bash scripts/redeploy-selfhost-dev.sh [--dry-run] [--compose] [--manual]

Rebuild the local self-host backend/frontend Docker images from the current
checkout and update the running services.

Behavior:
  - Prefer docker compose / docker-compose when available.
  - Fall back to a manual docker build + docker run rollout when compose is
    unavailable.
  - Manual mode preserves the currently running container env when possible.

Options:
  --dry-run   Print the commands without executing them.
  --compose   Force compose mode.
  --manual    Force manual mode.
  -h, --help  Show this help.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --compose)
      MODE="compose"
      ;;
    --manual)
      MODE="manual"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

log() {
  echo "==> $*"
}

die() {
  echo "✗ $*" >&2
  exit 1
}

run() {
  if [ "$DRY_RUN" = true ]; then
    printf '+'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
    return 0
  fi
  "$@"
}

capture_cmd() {
  if [ "$DRY_RUN" = true ]; then
    printf '+'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
    return 0
  fi
  "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

wait_http() {
  local url="$1"
  local name="$2"
  local timeout="${3:-60}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if [ "$DRY_RUN" = true ]; then
      echo "DRY RUN: would wait for $name at $url"
      return 0
    fi
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  die "$name did not become ready within ${timeout}s ($url)"
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return 0
  fi
  return 1
}

GIT_DIR="$(git rev-parse --git-dir)"
TMP_DIR="$GIT_DIR/codex-tmp"
mkdir -p "$TMP_DIR"
BACKEND_ENV_FILE=""
FRONTEND_ENV_FILE=""

cleanup() {
  if [ -n "$BACKEND_ENV_FILE" ] && [ -f "$BACKEND_ENV_FILE" ]; then
    rm -f "$BACKEND_ENV_FILE"
  fi
  if [ -n "$FRONTEND_ENV_FILE" ] && [ -f "$FRONTEND_ENV_FILE" ]; then
    rm -f "$FRONTEND_ENV_FILE"
  fi
}
trap cleanup EXIT

load_repo_env() {
  if [ ! -f "$ENV_FILE" ]; then
    die "Missing env file: $ENV_FILE"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

write_repo_backend_env() {
  local out="$1"
  load_repo_env
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    /^[A-Za-z_][A-Za-z0-9_]*=/ { print }
  ' "$ENV_FILE" > "$out"

  {
    printf 'DATABASE_URL=postgres://%s:%s@%s:5432/%s?sslmode=disable\n' \
      "${POSTGRES_USER:-multica}" \
      "${POSTGRES_PASSWORD:-multica}" \
      "$POSTGRES_CONTAINER" \
      "${POSTGRES_DB:-multica}"
    printf 'PORT=8080\n'
    printf 'APP_ENV=%s\n' "${APP_ENV:-development}"
    printf 'MULTICA_DEV_VERIFICATION_CODE=%s\n' "${MULTICA_DEV_VERIFICATION_CODE:-888888}"
    printf 'FRONTEND_ORIGIN=%s\n' "${FRONTEND_ORIGIN:-http://127.0.0.1:${FRONTEND_PORT}}"
    printf 'CORS_ALLOWED_ORIGINS=%s\n' "${CORS_ALLOWED_ORIGINS:-http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}}"
    printf 'MULTICA_APP_URL=%s\n' "${MULTICA_APP_URL:-http://127.0.0.1:${FRONTEND_PORT}}"
    printf 'GOOGLE_REDIRECT_URI=%s\n' "${GOOGLE_REDIRECT_URI:-http://127.0.0.1:${FRONTEND_PORT}/auth/callback}"
  } >> "$out"
}

write_repo_frontend_env() {
  local out="$1"
  {
    printf 'HOSTNAME=0.0.0.0\n'
  } > "$out"
}

prepare_env_file_from_container_or_repo() {
  local container="$1"
  local out="$2"
  local fallback="$3"
  if container_exists "$container"; then
    capture_cmd docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" > "$out"
  else
    "$fallback" "$out"
  fi
}

manual_rollout() {
  require_command docker

  if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    die "Docker network '$NETWORK_NAME' does not exist. Start the self-host stack first."
  fi

  BACKEND_ENV_FILE="$(mktemp "$TMP_DIR/backend.env.XXXXXX")"
  FRONTEND_ENV_FILE="$(mktemp "$TMP_DIR/frontend.env.XXXXXX")"

  log "Preparing backend/frontend env files"
  prepare_env_file_from_container_or_repo "$BACKEND_CONTAINER" "$BACKEND_ENV_FILE" write_repo_backend_env
  prepare_env_file_from_container_or_repo "$FRONTEND_CONTAINER" "$FRONTEND_ENV_FILE" write_repo_frontend_env

  log "Building $BACKEND_IMAGE"
  run docker build -t "$BACKEND_IMAGE" -f Dockerfile .

  log "Building $FRONTEND_IMAGE"
  run docker build \
    -t "$FRONTEND_IMAGE" \
    -f Dockerfile.web \
    --build-arg "REMOTE_API_URL=$REMOTE_API_URL" \
    --build-arg "NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL" \
    --build-arg "NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION" \
    .

  if container_exists "$BACKEND_CONTAINER"; then
    log "Removing existing $BACKEND_CONTAINER"
    run docker rm -f "$BACKEND_CONTAINER"
  fi

  log "Starting $BACKEND_CONTAINER"
  run docker run -d \
    --name "$BACKEND_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK_NAME" \
    --network-alias "$BACKEND_ALIAS" \
    -p "127.0.0.1:${BACKEND_PORT}:8080" \
    -v "${BACKEND_VOLUME}:/app/data/uploads" \
    --env-file "$BACKEND_ENV_FILE" \
    "$BACKEND_IMAGE"

  log "Waiting for backend"
  wait_http "http://127.0.0.1:${BACKEND_PORT}/health" "backend" 90

  if container_exists "$FRONTEND_CONTAINER"; then
    log "Removing existing $FRONTEND_CONTAINER"
    run docker rm -f "$FRONTEND_CONTAINER"
  fi

  log "Starting $FRONTEND_CONTAINER"
  run docker run -d \
    --name "$FRONTEND_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK_NAME" \
    -p "127.0.0.1:${FRONTEND_PORT}:3000" \
    --env-file "$FRONTEND_ENV_FILE" \
    "$FRONTEND_IMAGE"

  log "Waiting for frontend"
  wait_http "http://127.0.0.1:${FRONTEND_PORT}" "frontend" 120
}

compose_rollout() {
  require_command docker
  detect_compose || die "Compose mode requested, but neither 'docker compose' nor 'docker-compose' is available."
  log "Using compose command: ${COMPOSE_CMD[*]}"
  run "${COMPOSE_CMD[@]}" -f docker-compose.selfhost.yml -f docker-compose.selfhost.build.yml up -d --build
  log "Waiting for backend"
  wait_http "http://127.0.0.1:${BACKEND_PORT}/health" "backend" 90
  log "Waiting for frontend"
  wait_http "http://127.0.0.1:${FRONTEND_PORT}" "frontend" 120
}

show_status() {
  log "Running containers"
  run docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
}

case "$MODE" in
  compose)
    compose_rollout
    ;;
  manual)
    manual_rollout
    ;;
  auto)
    if detect_compose; then
      compose_rollout
    else
      log "Compose not available; using manual docker fallback"
      manual_rollout
    fi
    ;;
  *)
    die "Unsupported mode: $MODE"
    ;;
esac

show_status
log "Redeploy complete"
