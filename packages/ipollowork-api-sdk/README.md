# @ipollowork/api-sdk

Official TypeScript client for the iPolloWork public API. Zero runtime dependencies.

## Install

```bash
npm install @ipollowork/api-sdk
```

## Quick start

Start a server and mint a token:

```bash
ipollowork-server --workspace /path/to/workspace --approval auto
```

The server prints a client token on first boot. Then:

```ts
import { IPolloWorkClient } from "@ipollowork/api-sdk";

const client = new IPolloWorkClient({
  baseUrl: "http://127.0.0.1:8787",
  token: process.env.IPOLLOWORK_TOKEN,
});

const [workspace] = (await client.listWorkspaces()).items;

// Session responses are an envelope: the session plus the engine and its capabilities.
const { session, capabilities } = await client.createSession(workspace.id, { title: "Release notes" });

await client.promptText(workspace.id, session.id, "Summarize the changes since v0.20 into release notes.");

for await (const event of client.streamSession(workspace.id, session.id)) {
  if (event.type === "message.delta") process.stdout.write(event.delta);
  if (event.type === "session.idle") break;
}
```

## Streaming and resumption

Every streamed event carries a `seq` cursor. Pass the last one you handled as `after` to
resume after a dropped connection without losing events:

```ts
let cursor: string | undefined;
try {
  for await (const event of client.streamSession(ws, sid, { after: cursor })) {
    cursor = event.seq ?? cursor;
    handle(event);
  }
} catch {
  // Reconnect from `cursor`; events between the drop and the retry are replayed.
}
```

Resumption requires an engine that supports it. Check
`GET /api/v1/workspaces/:id/sessions/:sid` or the engine capability list — the OpenCode
engine has durable cursors, DeepSeek Harness does not.

## Engine differences

The API is engine-agnostic, but two prompt options are not universally supported. Rather
than accept and ignore them, the server rejects them with `501
engine_prompt_option_unsupported` and names the fields in `details.unsupported`:

```ts
try {
  await client.prompt(ws, sid, { parts: [{ type: "text", text: "…" }], system: "Be terse" });
} catch (error) {
  if (error instanceof IPolloWorkApiError && error.code === "engine_prompt_option_unsupported") {
    // OpenCode's v2 prompt endpoint has no system-prompt field. Fold the instruction into
    // the message text, or set it on the agent instead.
  }
}
```

`createSession` and `getSession` both report what the engine actually applies under
`capabilities.promptOptions`.

## Approving tool use

When the server runs with manual approvals, the agent pauses and emits a permission
request. Answer it to let the run continue:

```ts
for await (const event of client.streamSession(ws, sid)) {
  if (event.type === "permission.asked") {
    const safe = event.permission.kind === "read";
    await client.replyPermission(ws, sid, event.permission.id, safe ? "once" : "reject");
  }
}
```

## Tasks

For unattended automation, `runTask` submits a goal and resolves when it finishes:

```ts
const task = await client.runTask(
  workspace.id,
  { goal: "Fix the failing tests in src/parser", approvalPolicy: "auto" },
  { onEvent: (name, data) => console.log(name, data) },
);

console.log(task.state, task.summary);
```

Tasks are held in memory by the server and do not survive a restart. For long or critical
runs, drive sessions directly and keep your own record.

## Errors

Failures throw `IPolloWorkApiError`. Branch on `code`, which is stable; `message` is not.

```ts
import { IPolloWorkApiError } from "@ipollowork/api-sdk";

try {
  await client.getSession(ws, "missing");
} catch (error) {
  if (error instanceof IPolloWorkApiError) {
    if (error.code === "session_not_found") return null;
    if (error.isAuthError) throw new Error("Token lacks the required scope");
    if (error.isRetryable) return retry();
  }
  throw error;
}
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
