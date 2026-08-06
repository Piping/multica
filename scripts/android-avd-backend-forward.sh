#!/usr/bin/env bash
set -euo pipefail

LIMA_INSTANCE="${LIMA_INSTANCE:-deb12}"
LISTEN_HOST="${LISTEN_HOST:-0.0.0.0}"
LISTEN_PORT="${LISTEN_PORT:-18090}"
TARGET_HOST="${TARGET_HOST:-127.0.0.1}"
TARGET_PORT="${TARGET_PORT:-8080}"

usage() {
  cat <<'EOF'
Usage: scripts/android-avd-backend-forward.sh

Expose the self-host backend running inside the Lima VM to an Android emulator.
The emulator can then use:

  http://10.0.2.2:${LISTEN_PORT:-18090}

Environment overrides:
  LIMA_INSTANCE  Lima instance name. Default: deb12
  LISTEN_HOST    Host interface for the SSH forward. Default: 0.0.0.0
  LISTEN_PORT    Host port for the emulator to reach. Default: 18090
  TARGET_HOST    Hostname inside the Lima VM. Default: 127.0.0.1
  TARGET_PORT    Backend port inside the Lima VM. Default: 8080
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

SSH_CONFIG="$HOME/.lima/${LIMA_INSTANCE}/ssh.config"
if [ ! -f "$SSH_CONFIG" ]; then
  echo "Missing Lima SSH config: $SSH_CONFIG" >&2
  echo "Start the Lima instance first or set LIMA_INSTANCE." >&2
  exit 1
fi

echo "Forwarding ${LISTEN_HOST}:${LISTEN_PORT} -> ${LIMA_INSTANCE}:${TARGET_HOST}:${TARGET_PORT}"
echo "Android emulator URL: http://10.0.2.2:${LISTEN_PORT}"
exec ssh \
  -F "$SSH_CONFIG" \
  -N \
  -o ExitOnForwardFailure=yes \
  -L "${LISTEN_HOST}:${LISTEN_PORT}:${TARGET_HOST}:${TARGET_PORT}" \
  "lima-${LIMA_INSTANCE}"
