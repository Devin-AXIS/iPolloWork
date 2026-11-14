# Capability HTTP API

English | [中文](capabilities.zh.md)

The account service exposes model capabilities over HTTP. Native iPolloWork tools and external applications use the same authorization, provider routing, actual-usage billing and request receipts. Provider keys stay in server settings; external access keys never grant account administration or file access.

## Discover and describe

Create an access key from **Service center → API access**. The plaintext appears once. Send it as `Authorization: Bearer <key>` or `X-API-Key: <key>`. Existing account session tokens continue to work. Query `GET /api/v1/capabilities` for concise entries; `?kind=image` filters by kind. Supported kinds are `chat`, `image`, `video`, `speech`, `transcription`, `embedding` and `rerank`. Only enabled, authorized, priced services with a supported protocol and a configured invocation route appear. A kind supported by the API is not evidence that the deployment has an available model of that kind.

`GET /api/v1/capabilities/:id` returns the input JSON Schema, model IDs, limits and invocation address. Model lists have 25 entries per page by default; use `offset`, `limit` (at most 100) and the returned `nextOffset`. Use `?model=<id>` for one model. Inputs name the task rather than vendor endpoints: image and video use `prompt`, speech uses `text` and `voice`, transcription uses `audio`, embeddings use `texts`, and reranking uses `query` and `documents`. The description owns the complete current schema.

For a service with several creation routes, each model must have `invocationPath` or a reviewed provider preset mapping. The path must match one of the service's configured POST routes. New unknown models are not routed by guessing their name. The model's optional `inputModalities` describes declared input types; native chat forwards images only when the model metadata or the maintained provider catalog declares image input. Audio understanding and speech transcription are distinct capabilities.

## Invoke and read results

Submit `POST /api/v1/capabilities/:id/invoke` with JSON `{ "requestId": "<UUID>", "model": "<model ID>", "input": { ... } }`. Omitting `model` selects the first recommended available model, otherwise the first available model. Keep the same `requestId` for a repeated identical request. A changed body with that ID is rejected. The server constructs the provider request; callers cannot supply a provider URL, authorization header or arbitrary HTTP path.

~~~sh
curl "$IPOLLOWORK_ORIGIN/api/v1/capabilities" \
  -H "Authorization: Bearer $IPOLLOWORK_ACCESS_KEY"
~~~

The result contains `requestId`, `kind`, `state` and `result`. `result` preserves the provider's JSON, including output URLs and usage. Binary responses contain a MIME type and Base64 data. `pending` responses include a `task` address. Poll `GET /api/v1/capability-tasks/:requestId`; the server checks receipt ownership and refreshes the provider task, without submitting another generation request. Completed stored results are reused. The existing execution receipt retention applies; an expired synchronous result returns HTTP 410. A result marked `unknown` must be checked or reconciled, not blindly resubmitted under another ID.

Calls keep existing plan permissions and actual-usage settlement: positive credit is required for paid metered work, settlement can leave debt, and the next paid call then requires replenishment. Fixed-price services retain their original charging behavior. This API adds no per-account concurrency limit. Model limits and explicit operator restrictions still apply.

## Access keys and native tools

`GET`, `POST` and `DELETE /api/v1/access-keys[/<id>]` list, create and revoke the signed-in user's keys. Creation accepts `name` and optional `expiresIn` seconds. Key management requires an ordinary account session; an access key cannot mint other keys. Better Auth owns key hashing, expiry, ownership and its `apikey` table. Startup applies the plugin's additive authentication migration through the existing migration runner. Back up PostgreSQL and the authentication secret before deployment. Business `service_schema` and existing receipts are unchanged; no parallel task or billing table is created.

The native tools are `ipollo_capabilities`, `ipollo_capability_describe`, `ipollo_capability_invoke` and `ipollo_capability_task`. Their descriptions expose discovery first; detailed model schemas are loaded on demand. Invocation derives a stable receipt ID from the native Session and tool-call identities, forwards cancellation and refuses read-only sessions. Each registration belongs to the suite's lifetime. Independent calls may overlap. Missing account configuration is reported rather than falling back to an unconfigured provider.
