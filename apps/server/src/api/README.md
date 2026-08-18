# Public API component (`/api/v1`)

A self-contained, pluggable API surface for `ipollowork-server`. Every operation is
declared by a **module**; the declaration is the single source of truth, so the live route
table and the published OpenAPI document are generated from the same objects and cannot
drift.

Two things make it a component rather than another routes file:

- **Engine independence.** Handlers talk to `EngineConnection` (`engine/types.ts`), not to
  OpenCode or DeepSeek Harness. `engine/opencode.ts` and `engine/harness.ts` are the only
  files that know an engine's wire format.
- **Independent enable/disable.** Each module can be turned off without touching code, and
  the OpenAPI document follows.

## Mounting

`registerApiV1({ ... })` (`index.ts`) is the composition root: it builds the
`EngineAdapterRegistry`, owns the task and webhook stores, assembles the
`ApiModuleContext`, resolves which modules are enabled, and calls `registerApiModules`.

It is invoked once, at the **end** of `createRoutes` in `../server.ts`, after every legacy
`register*Routes` call. Order matters in exactly one direction: `matchRoute`
(`../routes/registry.ts`) scans the array and returns the **first** match, so appending
routes can never shadow an existing one — but the `compat` module re-dispatches into the
legacy table and must be able to see all of it. It receives `legacyRoutes: () => routes`,
a getter rather than a snapshot, so it reads the finished table at request time.

## Modules

| id | stability | ops | base paths |
| --- | --- | --- | --- |
| `sessions` | stable | 11 | `/api/v1/workspaces/{workspaceId}/sessions…` |
| `tasks` | preview | 5 | `/api/v1/workspaces/{workspaceId}/tasks…` |
| `webhooks` | preview | 5 | `/api/v1/workspaces/{workspaceId}/webhooks…` |
| `policy` | preview | 3 | `/api/v1/whoami`, `/api/v1/tokens/{tokenId}/policy` |
| `openapi` | stable | 3 | `/api/v1/openapi.json`, `/api/v1/docs`, `/api/v1/modules` |
| `compat` | stable | 135 | `/api/v1/…` aliases of legacy routes |

- **`sessions`** — engine-agnostic conversations: create, inspect, prompt, interrupt,
  stream events (SSE, resumable via `?after=` where the engine has a durable cursor), and
  answer permission and question requests.
- **`tasks`** — one-shot automation over a session. Records live in **server memory and are
  lost on restart**; the `sessionId` a task reports is the durable handle. Depends on
  `sessions`.
- **`webhooks`** — outbound subscriptions per workspace, HMAC-signed, bounded retries,
  private-network targets rejected unless explicitly opted in. `index.ts` bridges the task
  store's event log into delivery, which is what makes the `task.*` event names real.
- **`policy`** — the caller's resolved identity, plus per-token workspace binding, approval
  policy and expiry. Policy mutation is `host`-authenticated.
- **`openapi`** — the generated OpenAPI 3.1 document, a dependency-free HTML reference, and
  the catalogue of enabled modules.
- **`compat`** — republishes legacy routes under `/api/v1` by re-dispatching into the legacy
  handler. Legacy paths stay available and unchanged. The toy UI, the raw `/opencode/*`
  proxy, `/w/:id/*` mounts, browser OAuth callbacks, `/mcp-proxy/*` and `/dev/log` are
  deliberately **not** aliased — they are not a stable public contract.

### Enabling and disabling

Every module is enabled by default.

| env var | effect |
| --- | --- |
| `IPOLLOWORK_API_MODULES` | Comma-separated **allowlist**. Only these modules load. |
| `IPOLLOWORK_API_MODULES_DISABLED` | Comma-separated **denylist**, applied after the allowlist. |

An unknown id in either list is a startup error (`api_module_unknown`), not a silent no-op,
so a typo cannot quietly drop an API surface. Disabling a module another enabled module
depends on is also a startup error (`api_module_dependency_missing`) — e.g. `tasks` without
`sessions`.

`GET /api/v1/modules` reports what is actually live, including each operation's method,
path, effect and scope.

## Engines are uniform, but not identical

`EngineConnection` gives both engines one shape, and most of the time a caller never needs
to know which one is behind a workspace. Where the engines genuinely differ, the difference
is reported rather than hidden — `GET /api/v1/workspaces/{id}/sessions/{sid}` returns a
`capabilities` object, and an operation the engine cannot perform answers `501
engine_capability_unsupported` instead of failing in some engine-specific way.

Two differences matter in practice today:

| | OpenCode | DeepSeek Harness |
| --- | --- | --- |
| `?after=` stream resumption | yes — events carry a durable cursor | no — `resumableStreaming: false` |
| `system` / `reasoningEffort` on prompt | not applied | applied |

The second one is the reason `promptOptions` exists. OpenCode's v2 prompt endpoint has no
field for a per-turn system prompt, so passing one would have quietly done nothing; the
module rejects it with `501 engine_prompt_option_unsupported` instead, naming the fields in
`details.unsupported`. A silent no-op is the worse failure: the caller gets a 202 and never
learns the instruction was dropped.

## Auth model

Three gates, applied in this order by `registerApiModules` before a handler runs:

1. **Route auth mode** (`auth`, default `client`) — handed to `addRoute` and enforced by the
   server's dispatcher, exactly as for legacy routes. `client` authenticates a client token,
   `host` a host token.
2. **Writability** — every operation whose `effect` is `write` or `destructive` calls
   `ensureWritable(config)`, which throws `403 read_only` on a read-only server.
3. **Client token scope** — for `auth: "client"` operations only. The required scope is the
   operation's `scope`, defaulting by effect: `read → viewer`, `write` and
   `destructive → collaborator`.

**Handlers must not repeat these checks.** Re-checking scope or writability inside a handler
is redundant at best and, when it disagrees with the declaration, makes the OpenAPI document
lie about what a token needs.

`compat` aliases are the one deliberate exception to the effect-based defaults: each alias
copies the legacy route's auth mode and declares a scope no stricter than the legacy
handler's own check, so an alias can never reject a request the legacy path would accept.
The 13 cases where an alias is stricter — legacy write handlers that never call
`ensureWritable`, and only on a read-only server — are listed in `COMPAT_READ_ONLY_STRICTER`.
That divergence is fail-closed.

Errors are the server's standard shape: `throw new ApiError(status, code, message, details?)`
serialises to `{ code, message, details }`.

## Adding a module

1. Create `modules/<id>/module.ts` exporting an `ApiModule`:

   ```ts
   export const thingsModule: ApiModule = {
     id: "things",
     title: "Things",
     description: "…",
     version: "1.0.0",
     stability: "preview",
     dependsOn: ["sessions"],           // optional; checked against the enabled set
     register(context: ApiModuleContext): ApiOperation[] {
       return [
         {
           operationId: "listThings",   // unique across all modules; becomes the SDK method
           method: "GET",
           path: "/api/v1/workspaces/:workspaceId/things",
           summary: "List things",
           effect: "read",              // read | write | destructive
           // auth defaults to "client"; scope defaults from effect
           responses: { 200: { description: "…", schema: { type: "array" } } },
           handler: async (ctx) => context.jsonResponse({ items: [] }),
         },
       ];
     },
   };
   ```

2. Take everything the handler needs from `ApiModuleContext`: `config`, `jsonResponse`,
   `readJsonBody`, `resolveWorkspace`, and late-bound singletons from `context.services`.
   `index.ts` supplies `engines`, `legacyRoutes`, `getApiRegistry`, `serverVersion`, and —
   when the owning module is enabled — `taskStore`, `taskRunner` and `webhookStore`. A
   module may also accept its own optional injection point (`policy` reads
   `tokenPolicies`, `webhooks` reads `webhookFetch`) and construct a default when absent.
   Read a required service defensively and fail with a `500` naming it — that is a wiring
   bug, not a request error.
3. Add it to `API_MODULES` in `index.ts`. `compat` stays last: its aliases are the broadest
   patterns in the component.
4. Register anything the module owns as a singleton in `index.ts` rather than inside
   `register()` when something else needs the same instance.
5. Write tests next to the source (`module.test.ts`, `bun:test`). Registry behaviour, pure
   parsing/mapping and schema validation are testable without a live engine — use a stub
   connection, never a real OpenCode process.

Registration is fail-fast: a duplicate module id, a duplicate `operationId` and a duplicate
`method + path` each throw at startup.

Set `internal: true` to route an operation without publishing it; set `streaming: "sse"` so
the document and generated SDKs describe it as a stream.

## OpenAPI and docs

| endpoint | returns |
| --- | --- |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 document of every enabled, non-`internal` operation. Deterministic — identical input produces byte-identical JSON, so it can be committed and diffed in CI. |
| `GET /api/v1/docs` | Self-contained HTML reference. No CDN, no external assets. |
| `GET /api/v1/modules` | The enabled module catalogue (`describeModules`), including each operation's effect and required scope. |

The document is built by `openapi.ts` from the same `ApiOperation` objects that produced the
routes, and is cached per registry identity.

## Tests

```sh
bun test src/api                       # the whole component
npx tsc -p tsconfig.json --noEmit      # whole server, including this component
```
