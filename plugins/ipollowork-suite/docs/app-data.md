# App data

App data lets plugins, websites, apps and mini programs built in DSH keep records in the signed-in iPolloWork account. The account service stores them in a separate database and accepts only JSON statements; see [the service reference](../../../services/ipollowork/docs/app-data.md) for limits, permissions and the statement format.

## Data page

The sidebar's Data entry lists the account's personal apps and the apps of its organizations, grouped by the workspace that created them. Each app shows its owner, whether any collection is public and its size. Selecting an app shows one tab per collection and a read-only table of its records, fifty at a time. Public apps also show the endpoint and public key that page code uses. Managers can delete an app after confirming. Records cannot be edited on this page.

## Model

The `app_data` tool takes an app name, an optional organization and one statement. The first call with a name creates the app and records the current workspace's title; later calls reopen it. The tool result is the statement result, and `{"info":true}` returns the endpoint and public key. The `app-data` runtime skill tells the model when to use app data, how to set up public collections and how page code and plugins call them. Both are registered only when the account features are enabled; calls fail with `IPW_SIGN_IN_REQUIRED` while signed out. Rejections keep the service's explanation, such as a field type mismatch, so the model can correct the statement.

## Plugins

The suite provides the `ipolloData` native service. A plugin that injects it calls `ctx.ipolloData.open(name, { organization })` and receives an app with `run(statement)` and `collection(name)`, whose `insert`, `get`, `find`, `count`, `update` and `delete` send the matching statements. Plugins hold no token or connection string. Types are in `src/shared/app-data.ts`.
