# iPolloWalk Server

Filesystem-backed API for iPolloWalk remote clients. This package provides the iPolloWalk server layer described in `apps/app/pr/ipollowalk-server.md` and is intentionally independent from the desktop app.

## Quick start

```bash
npm install -g ipollowalk-server
ipollowalk-server --workspace /path/to/workspace --approval auto
```

`ipollowalk-server` ships as a compiled binary, so Bun is not required at runtime.

Or from source:

```bash
pnpm --filter ipollowalk-server dev -- \
  --workspace /path/to/workspace \
  --approval auto
```

The server logs the client token and host token on boot when they are auto-generated.

Add `--verbose` to print resolved config details on startup. Use `--version` to print the server version and exit.

## Config file

Defaults to `~/.config/ipollowalk/server.json` (override with `IPOLLOWALK_SERVER_CONFIG` or `--config`).

```json
{
  "host": "127.0.0.1",
  "port": 8787,
  "approval": { "mode": "manual", "timeoutMs": 30000 },
  "workspaces": [
    {
      "path": "/Users/susan/Finance",
      "name": "Finance",
      "workspaceType": "local",
      "baseUrl": "http://127.0.0.1:4096",
      "directory": "/Users/susan/Finance"
    }
  ],
  "corsOrigins": ["http://localhost:5173"]
}
```

## Environment variables

- `IPOLLOWALK_SERVER_CONFIG` path to config JSON
- `IPOLLOWALK_HOST` / `IPOLLOWALK_PORT`
- `IPOLLOWALK_TOKEN` client bearer token
- `IPOLLOWALK_HOST_TOKEN` host approval token
- `IPOLLOWALK_APPROVAL_MODE` (`manual` | `auto`)
- `IPOLLOWALK_APPROVAL_TIMEOUT_MS`
- `IPOLLOWALK_WORKSPACES` (JSON array or comma-separated list of paths)
- `IPOLLOWALK_CORS_ORIGINS` (comma-separated list or `*`)
- `IPOLLOWALK_OPENCODE_BASE_URL`
- `IPOLLOWALK_OPENCODE_DIRECTORY`
- `IPOLLOWALK_OPENCODE_USERNAME`
- `IPOLLOWALK_OPENCODE_PASSWORD`

Token management (scoped tokens):

- `IPOLLOWALK_TOKEN_STORE` path to token store JSON (default: alongside `server.json`)

File injection / artifacts:

- `IPOLLOWALK_INBOX_ENABLED` (`1` | `0`)
- `IPOLLOWALK_INBOX_MAX_BYTES` (default: 50MB, capped)
- `IPOLLOWALK_OUTBOX_ENABLED` (`1` | `0`)

Sandbox advertisement (for capability discovery):

- `IPOLLOWALK_SANDBOX_ENABLED` (`1` | `0`)
- `IPOLLOWALK_SANDBOX_BACKEND` (`docker` | `container` | `none`)

## Endpoints

- `GET /health`
- `GET /status`
- `GET /capabilities`
- `GET /whoami`
- `GET /workspaces`
- `GET /workspace/:id/config`
- `PATCH /workspace/:id/config`
- `GET /workspace/:id/events`
- `POST /workspace/:id/engine/reload`
- `GET /workspace/:id/plugins`
- `POST /workspace/:id/plugins`
- `DELETE /workspace/:id/plugins/:name`
- `GET /workspace/:id/skills`
- `POST /workspace/:id/skills`
- `GET /workspace/:id/mcp`
- `POST /workspace/:id/mcp`
- `DELETE /workspace/:id/mcp/:name`
- `GET /workspace/:id/commands`
- `POST /workspace/:id/commands`
- `DELETE /workspace/:id/commands/:name`
- `GET /workspace/:id/audit`
- `GET /workspace/:id/export`
- `POST /workspace/:id/import/preview`
- `POST /workspace/:id/import`

Token management (host/owner auth):

- `GET /tokens`
- `POST /tokens` (body: `{ "scope": "owner"|"collaborator"|"viewer", "label"?: string }`)
- `DELETE /tokens/:id`

Inbox/outbox:

- `POST /workspace/:id/inbox` (multipart upload into `.opencode/ipollowalk/inbox/`)
- `GET /workspace/:id/artifacts`
- `GET /workspace/:id/artifacts/:artifactId`
- `POST /workspace/:id/files/sessions`
- `POST /files/sessions/:sessionId/renew`
- `DELETE /files/sessions/:sessionId`
- `GET /files/sessions/:sessionId/catalog/snapshot`
- `GET /files/sessions/:sessionId/catalog/events`
- `POST /files/sessions/:sessionId/read-batch`
- `POST /files/sessions/:sessionId/write-batch`
- `POST /files/sessions/:sessionId/ops`

Toy UI (static assets served by the server):

- `GET /ui`
- `GET /w/:id/ui`
- `GET /ui/assets/*`

OpenCode proxy:

- `GET|POST|... /opencode/*`
- `GET|POST|... /w/:id/opencode/*`

## Approvals

All writes are gated by host approval.

Host APIs accept either:

- `X-iPolloWalk-Host-Token: <token>` (legacy host token), or
- `Authorization: Bearer <token>` where the token scope is `owner`.

Approvals endpoints:

- `GET /approvals`
- `POST /approvals/:id` with `{ "reply": "allow" | "deny" }`

Set `IPOLLOWALK_APPROVAL_MODE=auto` to auto-approve during local development.
