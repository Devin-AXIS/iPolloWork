# App data

App data lets plugins, websites, apps and mini programs built in DSH keep records in the signed-in iPolloWork account. The account service stores them in a separate database and accepts only JSON statements; see [the service reference](../../../services/ipollowork/docs/app-data.md) for limits, permissions and the statement format.

## Data page

The sidebar's Data entry opens one tab for personal apps and one per organization the account belongs to, including organizations without apps. Filters show all apps, plugins or public apps by the kind each app declared when it was created. Each app is one compact row: its mark, name, record count, creation date and kind; the row's tooltip names the workspace it was created in. Opening an app shows its records first: one tab per table over a read-only table, fifty records at a time. Column headings sort by that field, and a row opens to show every value in full with the record id, version and update time. The endpoint and public key of a public app stay behind the Connect control, and deletion, for managers, behind the More menu. Records cannot be edited on this page.

## Model

The `app_data` tool takes an app name, its kind (`plugin` or `site`), an optional organization and one statement. The first write with a name creates the app with that kind and records the current workspace's title; later calls reopen it, matching the name without regard to letter case. A read of an unknown app creates nothing and fails with `DATA_APP_NOT_FOUND`, listing the owner's apps and their kinds. Reads may run concurrently; writes run in call order and fail with `IPW_DATA_READ_ONLY` in a session whose sandbox policy is read-only. Stopping the call cancels its account request, although a write the service already received may have committed. The tool result is the statement result, and `{"info":true}` lists collections, fields, the endpoint and the public key. A signed-out account fails with an instruction to ask the user to sign in. Rejections keep the service's explanation, which names the existing collections and fields, so the model can correct the statement.

The `app-data` runtime skill is the complete contract for the model: when to use app data, how page code calls it with a public key, and how a plugin's Host half and Client module call `ipolloData`. Cordis inspection catalogs only DSH's own services, so the skill, not inspection, is how the model discovers this service. The tool and skill are registered only when the account features are enabled.

## Plugins

The suite provides `ipolloData` on the Host and in the browser with one contract, `IpolloData` in `src/shared/app-data.ts`. A Host plugin injects it; a Client module lists `@ipollo/dsh-suite` in `dsh.client.inject` and injects it. `ctx.ipolloData.open(name, { organization })` creates or reopens the plugin app and returns `run(statement)` and `collection(name)`, whose `insert`, `get`, `find`, `count`, `update`, `upsert` and `delete` send the matching statements. Both services build the handle with `createDataApp`. The browser service calls the suite's same-origin routes and rejects with `AppDataError`, whose `code` is stable and whose message carries the service's explanation. Plugins hold no token or connection string.
