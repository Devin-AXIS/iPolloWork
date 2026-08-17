# Public API examples

Runnable examples for driving iPolloWork over HTTP, with no desktop UI involved.

## Setup

Start a server against a workspace:

```bash
npm install -g ipollowork-server
ipollowork-server --workspace /path/to/workspace --approval auto
```

The first boot prints a client token. Export it:

```bash
export IPOLLOWORK_BASE_URL=http://127.0.0.1:8787
export IPOLLOWORK_TOKEN=<the token printed above>
```

`--approval auto` approves tool use automatically, which is what you want for a first run.
For unattended production use, prefer a per-token approval policy over the global switch —
see `04-ci-review.sh`.

## Examples

| File | Shows |
|---|---|
| `01-stream-session.ts` | Create a session, send a prompt, stream the reply token by token |
| `02-handle-permissions.ts` | Answer tool-permission requests programmatically |
| `03-run-task.py` | Submit a goal and block until it finishes (Python) |
| `04-ci-review.sh` | A pure-curl CI job: review a diff and fail the build on findings |
| `05-webhook-receiver.ts` | Verify webhook signatures and react to task events |

## Running

TypeScript examples (from the repo root):

```bash
pnpm --filter @ipollowork/api-sdk build
node --experimental-strip-types examples/public-api/01-stream-session.ts
```

Python example:

```bash
python3 examples/public-api/03-run-task.py
```

Shell example:

```bash
bash examples/public-api/04-ci-review.sh origin/main
```

## Discovering the API

The server documents itself, so these examples never go stale relative to your build:

```bash
curl -H "Authorization: Bearer $IPOLLOWORK_TOKEN" $IPOLLOWORK_BASE_URL/api/v1/modules
curl -H "Authorization: Bearer $IPOLLOWORK_TOKEN" $IPOLLOWORK_BASE_URL/api/v1/openapi.json
open $IPOLLOWORK_BASE_URL/api/v1/docs
```
