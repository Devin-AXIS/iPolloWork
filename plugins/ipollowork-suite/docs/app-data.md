# App data

App data lets plugins, websites, apps and mini programs built in DSH keep records in the signed-in iPolloWork account. The account service stores them in a separate database and accepts only JSON statements; see [the service reference](../../../services/ipollowork/docs/app-data.md) for limits, permissions and the statement format.

## Data page

The sidebar's Data entry opens one tab for personal apps and one per organization the account belongs to, including organizations without apps. Filters show all apps, plugins or public apps by the kind each app declared when it was created. Each card shows the app's type, the workspace it was created in, its table and record counts and its last change. Opening a card shows the app's tables beside a read-only table of the selected one, fifty records at a time. Public apps also show the endpoint and public key that page code uses. Managers can delete an app after confirming. Records cannot be edited on this page.

## Model

The `app_data` tool takes an app name, its kind (`plugin` or `site`), an optional organization and one statement. The first call with a name creates the app with that kind and records the current workspace's title; later calls reopen it. The tool result is the statement result, and `{"info":true}` lists collections, fields, the endpoint and the public key. A signed-out account fails with an instruction to ask the user to sign in. Rejections keep the service's explanation, which names the existing collections and fields, so the model can correct the statement.

The `app-data` runtime skill is the complete contract for the model: when to use app data, how page code calls it with a public key, and how a plugin's Host half and Client module call `ipolloData`. Cordis inspection catalogs only DSH's own services, so the skill, not inspection, is how the model discovers this service. The tool and skill are registered only when the account features are enabled.

## Plugins

The suite provides `ipolloData` on the Host and in the browser with one contract, `IpolloData` in `src/shared/app-data.ts`. A Host plugin injects it; a Client module lists `@ipollo/dsh-suite` in `dsh.client.inject` and injects it. `ctx.ipolloData.open(name, { organization })` creates or reopens the plugin app and returns `run(statement)` and `collection(name)`, whose `insert`, `get`, `find`, `count`, `update`, `upsert` and `delete` send the matching statements. Both services build the handle with `createDataApp`. The browser service calls the suite's same-origin routes and rejects with `AppDataError`, whose `code` is stable and whose message carries the service's explanation. Plugins hold no token or connection string.
