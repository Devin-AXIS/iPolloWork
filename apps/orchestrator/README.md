# iPolloWalk Orchestrator

Host orchestrator for opencode + iPolloWalk server. This is a CLI-first way to run host mode without the desktop UI.

Published on npm as `ipollowalk-orchestrator` and installs the `ipollowalk` command.

## Quick start

```bash
npm install -g ipollowalk-orchestrator
ipollowalk start --workspace /path/to/workspace --approval auto
```

When run in a TTY, `ipollowalk` shows an interactive status dashboard with service health, ports, and
connection details. Use `ipollowalk serve` or `--no-tui` for log-only mode.

```bash
ipollowalk serve --workspace /path/to/workspace
```

`ipollowalk` ships as a compiled binary, so Bun is not required at runtime.

If npm skips the optional platform package, `postinstall` falls back to downloading the matching
binary from the `ipollowalk-orchestrator-v<version>` GitHub release. Override the download host with
`IPOLLOWALK_ORCHESTRATOR_DOWNLOAD_BASE_URL` when you need to use a mirror.

`ipollowalk` downloads and caches the `ipollowalk-server` and `opencode` sidecars on
first run using a SHA-256 manifest. Use `--sidecar-dir` or `IPOLLOWALK_SIDECAR_DIR` to control the
cache location, and `--sidecar-base-url` / `--sidecar-manifest` to point at a custom host.

Use `--sidecar-source` to control where `ipollowalk-server` is resolved (`auto` | `bundled` |
`downloaded` | `external`), and `--opencode-source` to control `opencode` resolution. Set
`IPOLLOWALK_SIDECAR_SOURCE` / `IPOLLOWALK_OPENCODE_SOURCE` to apply the same policies via env vars.

By default the manifest is fetched from
`https://github.com/Devin-AXIS/iPolloWalk/releases/download/ipollowalk-orchestrator-v<version>/ipollowalk-orchestrator-sidecars.json`.

For development overrides only, set `IPOLLOWALK_ALLOW_EXTERNAL=1` or pass `--allow-external` to use
locally installed `ipollowalk-server` binaries.

Add `--verbose` (or `IPOLLOWALK_VERBOSE=1`) to print extra diagnostics about resolved binaries.

OpenCode hot reload is enabled by default when launched via `ipollowalk`.
Tune it with:

- `--opencode-hot-reload` / `--no-opencode-hot-reload`
- `--opencode-hot-reload-debounce-ms <ms>`
- `--opencode-hot-reload-cooldown-ms <ms>`

Equivalent env vars:

- `IPOLLOWALK_OPENCODE_HOT_RELOAD` (router mode)
- `IPOLLOWALK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `IPOLLOWALK_OPENCODE_HOT_RELOAD_COOLDOWN_MS`
- `IPOLLOWALK_OPENCODE_HOT_RELOAD` (start/serve mode)
- `IPOLLOWALK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `IPOLLOWALK_OPENCODE_HOT_RELOAD_COOLDOWN_MS`

Or from source:

```bash
pnpm --filter ipollowalk-orchestrator dev -- \
  start --workspace /path/to/workspace --approval auto --allow-external
```

When `IPOLLOWALK_DEV_MODE=1` is set, orchestrator uses an isolated OpenCode dev state for config, auth, data, cache, and state. iPolloWalk's repo-level `pnpm dev` commands enable this automatically so local development does not reuse your personal OpenCode environment.

The command prints pairing URLs by default and withholds live credentials from stdout to avoid leaking them into shell history or collected logs. Use `--json` only when you explicitly need the raw pairing secrets in command output.

Use `--detach` to keep services running and exit the dashboard. The detach summary includes the
iPolloWalk URL and a redacted `opencode attach` command, while keeping live credentials out of the detached summary.

## Sandbox mode (Docker / Apple container)

`ipollowalk` can run the sidecars inside a Linux container boundary while still mounting your workspace
from the host.

```bash
# Auto-pick sandbox backend (prefers Apple container on supported Macs)
ipollowalk start --sandbox auto --workspace /path/to/workspace --approval auto

# Explicit backends
ipollowalk start --sandbox docker --workspace /path/to/workspace --approval auto
ipollowalk start --sandbox container --workspace /path/to/workspace --approval auto
```

Notes:

- `--sandbox auto` prefers Apple `container` on supported Macs (arm64), otherwise Docker.
- Docker backend requires `docker` on your PATH.
- Apple container backend requires the `container` CLI (https://github.com/apple/container).
- In sandbox mode, sidecars are resolved for a Linux target (and `--sidecar-source` / `--opencode-source`
  are effectively `downloaded`).
- Custom `--*-bin` overrides are not supported in sandbox mode yet.
- Use `--sandbox-image` to pick an image with the toolchain you want available to OpenCode.
- Use `--sandbox-persist-dir` to control the host directory mounted at `/persist` inside the container.

### Extra mounts (allowlisted)

You can add explicit, validated mounts into `/workspace/extra/*`:

```bash
ipollowalk start --sandbox auto --sandbox-mount "/path/on/host:datasets:ro" --workspace /path/to/workspace
```

Additional mounts are blocked unless you create an allowlist at:

- `~/.config/ipollowalk/sandbox-mount-allowlist.json`

Override with `IPOLLOWALK_SANDBOX_MOUNT_ALLOWLIST`.

## Logging

`ipollowalk` emits a unified log stream from OpenCode and iPolloWalk server. Use JSON format for
structured, OpenTelemetry-friendly logs and a stable run id for correlation.

```bash
IPOLLOWALK_LOG_FORMAT=json ipollowalk start --workspace /path/to/workspace
```

Use `--run-id` or `IPOLLOWALK_RUN_ID` to supply your own correlation id.

OpenCode runs at `INFO` by default, which produces large log files in
`~/.local/share/opencode/log/`. Pass `--opencode-log-level <DEBUG|INFO|WARN|ERROR>` (or set
`IPOLLOWALK_OPENCODE_LOG_LEVEL`) to forward `--log-level` to managed `opencode serve` and reduce log
volume.

iPolloWalk server logs every request with method, path, status, and duration. Disable this when running
`ipollowalk-server` directly by setting `IPOLLOWALK_LOG_REQUESTS=0` or passing `--no-log-requests`.

## Router daemon (multi-workspace)

The router keeps a single OpenCode process alive and switches workspaces JIT using the `directory` parameter.

```bash
ipollowalk daemon start
ipollowalk workspace add /path/to/workspace-a
ipollowalk workspace add /path/to/workspace-b
ipollowalk workspace list --json
ipollowalk workspace path <id>
ipollowalk instance dispose <id>
```

Use `IPOLLOWALK_DATA_DIR` or `--data-dir` to isolate router state in tests.

## Pairing notes

- Use the **iPolloWalk connect URL** and **client token** to connect a remote iPolloWalk client.
- The iPolloWalk server advertises the **OpenCode connect URL** plus optional basic auth credentials to the client.

## Approvals (manual mode)

```bash
ipollowalk approvals list \
  --ipollowalk-url http://<host>:8787 \
  --host-token <token>

ipollowalk approvals reply <id> --allow \
  --ipollowalk-url http://<host>:8787 \
  --host-token <token>
```

## Health checks

```bash
ipollowalk status \
  --ipollowalk-url http://<host>:8787 \
  --opencode-url http://<host>:4096
```

## File sessions (JIT catalog + batch read/write)

Create a short-lived workspace file session and sync files in batches:

```bash
# Create writable session
ipollowalk files session create \
  --ipollowalk-url http://<host>:8787 \
  --token <client-token> \
  --workspace-id <workspace-id> \
  --write \
  --json

# Fetch catalog snapshot
ipollowalk files catalog <session-id> \
  --ipollowalk-url http://<host>:8787 \
  --token <client-token> \
  --limit 200 \
  --json

# Read one or more files
ipollowalk files read <session-id> \
  --ipollowalk-url http://<host>:8787 \
  --token <client-token> \
  --paths "README.md,notes/todo.md" \
  --json

# Write a file (inline content or --file)
ipollowalk files write <session-id> \
  --ipollowalk-url http://<host>:8787 \
  --token <client-token> \
  --path notes/todo.md \
  --content "hello from ipollowalk" \
  --json

# Watch change events and close session
ipollowalk files events <session-id> --ipollowalk-url http://<host>:8787 --token <client-token> --since 0 --json
ipollowalk files session close <session-id> --ipollowalk-url http://<host>:8787 --token <client-token> --json
```

## Smoke checks

```bash
ipollowalk start --workspace /path/to/workspace --check --check-events
```

This starts the services, verifies health + SSE events, then exits cleanly.

## Local development

Point to source CLIs for fast iteration:

```bash
ipollowalk start \
  --workspace /path/to/workspace \
  --allow-external \
  --ipollowalk-server-bin apps/server/src/cli.ts
```
