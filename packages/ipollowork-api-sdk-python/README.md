# ipollowork-api

Official Python client for the iPolloWork public API. Standard library only — no
dependencies to install in a CI job.

## Install

```bash
pip install ipollowork-api
```

## Quick start

Start a server and mint a token:

```bash
ipollowork-server --workspace /path/to/workspace --approval auto
```

The server prints a client token on first boot. Then:

```python
import os
from ipollowork_api import IPolloWorkClient

client = IPolloWorkClient("http://127.0.0.1:8787", token=os.environ["IPOLLOWORK_TOKEN"])

workspace = client.list_workspaces()["items"][0]

# Session responses are an envelope: the session plus the engine and its capabilities.
created = client.create_session(workspace["id"], title="Release notes")
session_id = created["session"]["id"]

client.prompt_text(
    workspace["id"],
    session_id,
    "Summarize the changes since v0.20 into release notes.",
)

for event in client.stream_session(workspace["id"], session_id):
    if event["type"] == "message.delta":
        print(event["delta"], end="", flush=True)
    elif event["type"] == "session.idle":
        break
```

## Streaming and resumption

Every streamed event carries a `seq` cursor. Pass the last one you handled as `after` to
resume after a dropped connection without losing events:

```python
cursor = None
try:
    for event in client.stream_session(ws, sid, after=cursor):
        cursor = event.get("seq", cursor)
        handle(event)
except Exception:
    # Reconnect from `cursor`; events between the drop and the retry are replayed.
    ...
```

Resumption requires an engine that supports it: the OpenCode engine has durable cursors,
DeepSeek Harness does not.

## Approving tool use

When the server runs with manual approvals, the agent pauses and emits a permission
request. Answer it to let the run continue:

```python
for event in client.stream_session(ws, sid):
    if event["type"] == "permission.asked":
        permission = event["permission"]
        reply = "once" if permission["kind"] == "read" else "reject"
        client.reply_permission(ws, sid, permission["id"], reply)
```

## Tasks

For unattended automation, `run_task` submits a goal and blocks until it finishes:

```python
task = client.run_task(
    workspace["id"],
    goal="Fix the failing tests in src/parser",
    approval_policy="auto",
    on_event=lambda name, data: print(name, data),
)

print(task["state"], task.get("summary"))
```

Tasks are held in memory by the server and do not survive a restart. For long or critical
runs, drive sessions directly and keep your own record.

## Errors

Failures raise `IPolloWorkApiError`. Branch on `code`, which is stable; `message` is not.

```python
from ipollowork_api import IPolloWorkApiError

try:
    client.get_session(ws, "missing")
except IPolloWorkApiError as error:
    if error.code == "session_not_found":
        ...
    elif error.is_auth_error:
        raise RuntimeError("Token lacks the required scope")
    elif error.is_retryable:
        retry()
    else:
        raise
```

## Token scopes

| Scope | Can do |
|---|---|
| `viewer` | Read sessions, messages, and events |
| `collaborator` | Everything above, plus prompt, interrupt, and answer permissions |
| `owner` | Everything above, plus token and policy management |

## API reference

The server publishes its own spec — always accurate for the version you are running:

- `GET /api/v1/openapi.json` — OpenAPI 3.1 document
- `GET /api/v1/docs` — browsable documentation
- `GET /api/v1/modules` — which API modules are enabled

## Tests

```bash
python3 -m unittest discover -s tests
```
