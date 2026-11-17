# iPollo Stage for iPolloWork

A thin native DSH plugin for the independent Stage service. Open **Stage** in the sidebar, link an **existing** Stage account, approve the connection in Stage, then refresh the panel. Future opens use a one-use sign-in ticket. Loading this plugin never opens Stage or starts generation.

To use Stage from a conversation, explicitly enable that workspace in the panel. The `ipollo_stage` tool supports:

- `catalog`: paged components, a component's content contract, backgrounds, themes and styles.
- `document`: list/read SceneDocs; save with `projectId`, `doc` and the previously read `expectedRevision` (`updatedAt`). Existing messages, sources and selections are preserved unless explicitly replaced. Concurrent edits are refused.
- `source`: upload an enabled workspace file using `input.path` (PDF, PPTX, text or image, up to 5 MB). Use the returned document ID in generation's `documentIds`. Larger files can be uploaded in Stage.
- `generate`: `message`, optional `projectId`, `tier`, `documentIds`, and Stage's live scene generation options. Discuss and confirm durable deep-film proposals in the Stage editor; its existing workflow and Work billing remain available there. Returns a task; poll it instead of starting another generation after an uncertain response. New or edited scenes use the existing Stage SceneDoc/component/background protocol.
- `export`: `projectId`, optional `resolution` (`720p`/`1080p`), `narration`, `voice`; poll with `task` and `kind: "export"`. A completed task returns an authenticated download path.
- `task`: `taskId`, optional `kind` (`generation`/`export`), `cancel`.
- `download`: save a completed export's `taskId` into this workspace's `stage-exports` directory, with a unique filename that preserves existing files.

Account credentials stay in the Work account service and encrypted Stage server storage. Nothing is stored in browser storage or tool arguments. Account changes revoke workspace consent. Read-only sessions cannot generate, upload, write documents or export. Standalone Stage accounts/projects remain independent.

Only administrator-configured official platform models are supported. Work points are settled from trusted measured input/output tokens, without a balance hold. Receipts are idempotent, prices are snapshotted, and provider cost/revenue remain in Work's existing service ledger. Missing usage remains pending review; network failures retain a durable settlement outbox. One active generation per Work wallet prevents unbounded unpaid concurrent runs. If actual final usage exceeds the remaining points, the exact charge is recorded and another run requires a positive balance.

This Stage adapter is included in the complete desktop installer. The Stage server/editor itself is deployed independently. Other separately distributed plugins keep their existing packaging policy.

## Operator setup

Deploy the Stage connection migration and matching Work service together, backing up PostgreSQL and both authentication/encryption keys first. Keep Stage's private `.ipollowork` encryption key persistent across releases. Configure Stage's `ACCOUNT_PUBLIC_URL` and `IPOLLOWORK_ORIGIN` to the exact HTTPS origins. Work's Stage settings use `enabled`, `origin`, and `rates` (JSON array of `{model,input,output,cacheRead?,inputCostMicros?,outputCostMicros?}`, all rates per million tokens). Model IDs must exactly match Stage's official model IDs; costs are in microcurrency units. Do not invent default commercial prices. Unconfigured integrations fail closed and show the administrator setup message.

`npm run check` runs strict TypeScript, owner/consent/policy tests and the build; `npm run pack:check` reviews the package. The matching DSH/suite packages must be prepared with the root setup command. See [Chinese documentation](README.zh.md).
