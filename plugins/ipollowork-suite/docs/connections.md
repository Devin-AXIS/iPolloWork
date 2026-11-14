# Service connections

The suite settings contain one Service connections entry. Plugin configuration pages show status and an action; secret fields appear only inside a native modal. A service with several keys declares them in one group. Saving clears the browser draft. Presence reads return booleans, not stored secrets.

Plugins may use the optional `ipolloConnections` client service without making the suite a runtime dependency. The typed protocol is exported at `@ipollo/dsh-suite/connections` and maintained in [src/shared/connections.ts](../src/shared/connections.ts). Register inside a Cordis `ctx.inject(['ipolloConnections'], ...)` scope and attach the returned disposer to that scope. Stable group ids let two plugins share one service while unloading either registration preserves the other. A standalone plugin supplies its own native dialog when this service is absent.

`ConnectionProvider` declares a localized title, plugin names, field ids and labels, a `load(signal)` callback returning presence/writability, and a `save(values, signal)` callback. The plugin owns authentication, input validation, atomic storage, secret handling and request cancellation. The suite owns dialog focus, field presentation and navigation. Neither the provider definition nor the registry snapshot contains secret values.

Design and Video share the `studio:*` groups and their DSH credential references. Their settings expose only status, API origins, local tool paths and optional references to older credentials. IM binding panels use the same native modal presentation while retaining their channel-specific authorization and storage. DSH account sign-in, OAuth grants and model-provider controls keep their native authorization flows.

When extending the catalog, derive an icon from the package's declared artwork. Run `node scripts/catalog-artwork.mjs --write` after updating bundled archives; `npm run check` verifies that those bytes still match. Packages with no artwork use DSH's default glyph in both market and installed views.

## Verification

`npm run check` passes with 65 tests and six environment-dependent skips. `npm run pack:check` passes and includes only the two current catalog archives. A disposable DSH installation verifies shared single-field and multi-field saves, light/dark rendering and the 390px layout. Manual inspection of the updated preview confirms the global settings entry, the IM credential modal and matching market/installed artwork. Existing provider credentials and user documents are retained; no live provider authorization was submitted.

## Official services and user keys

The optional Host API is exported as types at `@ipollo/dsh-suite/services`. `bind(signal)` fixes the current account and service-source choices for one operation; `official(provider)` reports a selected official route, and `fetch` proxies matching provider URLs using the account's server-side grant. Unknown authenticated provider URLs fail closed. Public asset downloads and explicit own-key operations retain their direct Host transport. Unloading the service or changing accounts interrupts official operations; it never silently changes billing source.

Signed-in service catalogs come from `/api/v1/services`. Administrators configure the upstream and eligible plans in the independent backend. The browser sees display records and source choices, not official keys. Model catalogs use the native pi-ai adapter and retain DSH message/tool serialization. No core loop or existing provider configuration changes.

Existing stored user keys stay the default until an explicit official source is selected. Loading a document, inspecting local assets, or using an explicit user key does not require contacting the account backend. A missing service endpoint on an older backend offers no official connections. An explicitly selected missing official connection remains an error instead of switching payment sources.

The verified local path covers a real native DSH model selection, a streamed fixture reply and a credit change from 100 to 99, plus switching between official and personal-key modes. Backend tests cover repeated request ids, plan checks, refunds, unknown outcomes, model/token restrictions and asynchronous job ownership. Real vendor credentials, commercial prices and live payment channels must be configured by the operator; none were invented or exercised in these checks.

New consumers use `await binding.official(provider, hasOwnKey)` to resolve the source and `await binding.request(provider, path, init)` for an official request. The `fetch` member is only the compatibility transport used by existing editor providers: it proxies their explicit managed-credential marker and otherwise preserves direct transport, including when another official connection uses the same domain. This prevents a user-key request from being charged to a different official connection.
