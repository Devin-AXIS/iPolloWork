# iPolloWork Notification Center

English | [中文](README.zh.md)

Install the iPolloWork DSH suite and open **Notifications** using the bell next to the account avatar in the DSH sidebar. The center combines the available feeds, shows an unread badge, and lets you open or mark an item as read. It supports the native sidebar rail.

Organization Space notices use this same inbox, including membership changes, resource reviews and deliveries, project updates, and shared conversations. The organization page hides its separate bell while the center is available and restores it when the center is disabled. Opening a notice keeps its existing authorized destination and read state. The panel keeps its heading and filters visible while the list scrolls, and wraps long titles and messages.

In **Settings → Notifications**, switch individual sources on or off. Sources are enabled by default. DSH saves the switches in its profile settings. Turning a source off hides its items and unread count in the center. Turning it back on shows its current notifications with their original read state.

The first feeds are native unread conversation updates and Project Board task notifications. The suite ships both sources. The board source requires Project Board 0.4.9 or later in a standalone development profile. It uses the existing organization inbox and read state. Native conversation items come from DSH's session reading state, disappear when acknowledged, and have the lifetime of the running DSH Host. The center does not create a separate history or change the underlying read state format.

## Source contract

Use the optional client service `ipolloNotificationCenter` and the suite's type-only export `@ipollo/dsh-suite/notifications`. The standalone development package also exposes `@ipollo/dsh-notification-center/contract`.

```ts
ctx.inject(['ipolloNotificationCenter'], scope => scope.effect(() =>
  scope.ipolloNotificationCenter.registerSource('ipollo.example', {
    label: () => strings().example,
    getSnapshot: feed.getSnapshot,
    subscribe: feed.subscribe,
    markRead: id => feed.markRead(id),
    open: id => feed.open(id),
  }),
))
```

1. Use a unique, stable, lowercase source name made of letters, digits, dots or hyphens, beginning with a letter. Supply stable item IDs scoped to that source and recipient. Updates to an existing event keep its ID. Use a new ID for a new event that needs independent acknowledgement.
2. Supply plain text, a UTC Unix timestamp in milliseconds, the authoritative read state, and an optional tone of `info`, `action`, `success` or `error`. Use facts the source can verify. For example, dispatching a scheduled instruction is not proof that the work finished successfully.
3. Publish a synchronous, newest-first snapshot with at most 200 authorized notices per feed. Emit changes after the initial read, a committed read-state update, incoming events, localization or account and permission changes. Fetch asynchronously in the source. Clear old account data and abort stale deliveries on identity or permission changes.
4. Keep persistence, retention, delivery, read-state mutations and authorization in the source. Use its normal authenticated APIs. The center aggregates data in memory and never writes it to browser storage. Send no tokens, private prompts, output bodies or other secrets in notification payloads.
5. Use a typed `open(id)` callback to navigate to the real destination or detail view using the source's current permissions. Resolve the ID against the current source state. Avoid arbitrary URLs or HTML. When opening acknowledges an item, do so only after its content opens successfully.
6. Register under the plugin lifecycle and return the disposer. Keep the standalone entry available if the center is absent. Use this center for inbox-worthy items such as assignments, decisions, results and actionable failures. Keep temporary form feedback with the action that produced it.

## Build and verify

Prepare the pinned DSH types with `npm run setup:build` from the repository root. In this directory, run `npm ci --workspaces=false`, `npm run check`, `npm run pack:check`, and `npm pack`. Use the standalone archive for development. Install the suite archive for both features together.

On each DSH pin, install in a disposable profile and verify the bell alignment beside the avatar and the dialog in both themes and at narrow width. With the board and account bridge installed, verify an assignment appears for the recipient, opens the actual task, and persists its read state through a reload. Verify a native unread conversation opens the correct session and native read acknowledgement clears its count. Check account switches and the standalone board entry when the center is absent.
