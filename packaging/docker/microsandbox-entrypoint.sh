#!/usr/bin/env sh
set -eu

IPOLLOWORK_WORKSPACE="${IPOLLOWORK_WORKSPACE:-/workspace}"
IPOLLOWORK_DATA_DIR="${IPOLLOWORK_DATA_DIR:-/data/ipollowork-orchestrator}"
IPOLLOWORK_SIDECAR_DIR="${IPOLLOWORK_SIDECAR_DIR:-/data/sidecars}"
IPOLLOWORK_PORT="${IPOLLOWORK_PORT:-8787}"
IPOLLOWORK_OPENCODE_PORT="${IPOLLOWORK_OPENCODE_PORT:-4096}"
IPOLLOWORK_TOKEN="${IPOLLOWORK_TOKEN:-microsandbox-token}"
IPOLLOWORK_HOST_TOKEN="${IPOLLOWORK_HOST_TOKEN:-microsandbox-host-token}"
IPOLLOWORK_APPROVAL_MODE="${IPOLLOWORK_APPROVAL_MODE:-auto}"
IPOLLOWORK_CORS_ORIGINS="${IPOLLOWORK_CORS_ORIGINS:-*}"
IPOLLOWORK_CONNECT_HOST="${IPOLLOWORK_CONNECT_HOST:-127.0.0.1}"
HOME="${HOME:-/root}"
USER="${USER:-root}"
SHELL="${SHELL:-/bin/sh}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"

if [ "$HOME" = "/" ]; then
  HOME=/root
  XDG_CONFIG_HOME="$HOME/.config"
  XDG_CACHE_HOME="$HOME/.cache"
  XDG_DATA_HOME="$HOME/.local/share"
  XDG_STATE_HOME="$HOME/.local/state"
fi

export HOME USER SHELL XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME

mkdir -p "$IPOLLOWORK_WORKSPACE" "$IPOLLOWORK_DATA_DIR" "$IPOLLOWORK_SIDECAR_DIR"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"

printf '%s\n' "Starting iPolloWork micro-sandbox"
printf '%s\n' "- workspace: $IPOLLOWORK_WORKSPACE"
printf '%s\n' "- home: $HOME"
printf '%s\n' "- ipollowork url: http://$IPOLLOWORK_CONNECT_HOST:$IPOLLOWORK_PORT"
printf '%s\n' "- client token: $IPOLLOWORK_TOKEN"
printf '%s\n' "- host token: $IPOLLOWORK_HOST_TOKEN"
printf '%s\n' "- health: curl http://$IPOLLOWORK_CONNECT_HOST:$IPOLLOWORK_PORT/health"
printf '%s\n' "- auth test: curl -H \"Authorization: Bearer $IPOLLOWORK_TOKEN\" http://$IPOLLOWORK_CONNECT_HOST:$IPOLLOWORK_PORT/workspaces"

exec ipollowork serve \
  --workspace "$IPOLLOWORK_WORKSPACE" \
  --remote-access \
  --ipollowork-port "$IPOLLOWORK_PORT" \
  --opencode-host 127.0.0.1 \
  --opencode-port "$IPOLLOWORK_OPENCODE_PORT" \
  --ipollowork-token "$IPOLLOWORK_TOKEN" \
  --ipollowork-host-token "$IPOLLOWORK_HOST_TOKEN" \
  --approval "$IPOLLOWORK_APPROVAL_MODE" \
  --cors "$IPOLLOWORK_CORS_ORIGINS" \
  --connect-host "$IPOLLOWORK_CONNECT_HOST" \
  --allow-external \
  --sidecar-source external \
  --opencode-source external \
  --ipollowork-server-bin /usr/local/bin/ipollowork-server \
  --opencode-bin /usr/local/bin/opencode
