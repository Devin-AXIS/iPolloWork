#!/usr/bin/env sh
set -eu

IPOLLOWALK_WORKSPACE="${IPOLLOWALK_WORKSPACE:-/workspace}"
IPOLLOWALK_DATA_DIR="${IPOLLOWALK_DATA_DIR:-/data/ipollowalk-orchestrator}"
IPOLLOWALK_SIDECAR_DIR="${IPOLLOWALK_SIDECAR_DIR:-/data/sidecars}"
IPOLLOWALK_PORT="${IPOLLOWALK_PORT:-8787}"
IPOLLOWALK_OPENCODE_PORT="${IPOLLOWALK_OPENCODE_PORT:-4096}"
IPOLLOWALK_TOKEN="${IPOLLOWALK_TOKEN:-microsandbox-token}"
IPOLLOWALK_HOST_TOKEN="${IPOLLOWALK_HOST_TOKEN:-microsandbox-host-token}"
IPOLLOWALK_APPROVAL_MODE="${IPOLLOWALK_APPROVAL_MODE:-auto}"
IPOLLOWALK_CORS_ORIGINS="${IPOLLOWALK_CORS_ORIGINS:-*}"
IPOLLOWALK_CONNECT_HOST="${IPOLLOWALK_CONNECT_HOST:-127.0.0.1}"
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

mkdir -p "$IPOLLOWALK_WORKSPACE" "$IPOLLOWALK_DATA_DIR" "$IPOLLOWALK_SIDECAR_DIR"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"

printf '%s\n' "Starting iPolloWalk micro-sandbox"
printf '%s\n' "- workspace: $IPOLLOWALK_WORKSPACE"
printf '%s\n' "- home: $HOME"
printf '%s\n' "- ipollowalk url: http://$IPOLLOWALK_CONNECT_HOST:$IPOLLOWALK_PORT"
printf '%s\n' "- client token: $IPOLLOWALK_TOKEN"
printf '%s\n' "- host token: $IPOLLOWALK_HOST_TOKEN"
printf '%s\n' "- health: curl http://$IPOLLOWALK_CONNECT_HOST:$IPOLLOWALK_PORT/health"
printf '%s\n' "- auth test: curl -H \"Authorization: Bearer $IPOLLOWALK_TOKEN\" http://$IPOLLOWALK_CONNECT_HOST:$IPOLLOWALK_PORT/workspaces"

exec ipollowalk serve \
  --workspace "$IPOLLOWALK_WORKSPACE" \
  --remote-access \
  --ipollowalk-port "$IPOLLOWALK_PORT" \
  --opencode-host 127.0.0.1 \
  --opencode-port "$IPOLLOWALK_OPENCODE_PORT" \
  --ipollowalk-token "$IPOLLOWALK_TOKEN" \
  --ipollowalk-host-token "$IPOLLOWALK_HOST_TOKEN" \
  --approval "$IPOLLOWALK_APPROVAL_MODE" \
  --cors "$IPOLLOWALK_CORS_ORIGINS" \
  --connect-host "$IPOLLOWALK_CONNECT_HOST" \
  --allow-external \
  --sidecar-source external \
  --opencode-source external \
  --ipollowalk-server-bin /usr/local/bin/ipollowalk-server \
  --opencode-bin /usr/local/bin/opencode
