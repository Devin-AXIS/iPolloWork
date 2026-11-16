# Official service center

Deploy the account backend with database version 6 before enabling official services. The migration adds service definitions and invocation receipts and leaves prior tables intact. Operators configure service keys, explicit routes, prices and optional plans in the service console; no provider is enabled or charged by default.

The suite adds the optional Host service `ipolloServices`, with a per-operation binding and an authenticated fetch method. Both native editors may use it while enabled; standalone installations continue resolving DSH credentials. Official source choices persist separately from user keys, and changing a source does not copy or delete a credential. Account changes invalidate existing bindings.

Configured chat model catalogs register additional `ipollo-*` routes through DSH's pi-ai adapter. They do not change existing model choices. Signing out or disabling the suite withdraws these routes. Native DSH BYOK model routes remain available. The service center's own-key choice withdraws the corresponding official model routes rather than copying a user key into a model profile.

Service routes may set `jobResultField` to the dotted response field containing a submitted job id, and `jobField` for a polling request's body/query id. Dynamic `:id` paths and declared polling ids are accepted only for jobs recorded under that account and service. Do not enable a provider's polling endpoint without its job ownership configuration. Configure per-request prices explicitly; this version does not infer token, duration or output-count pricing from vendor bills.
