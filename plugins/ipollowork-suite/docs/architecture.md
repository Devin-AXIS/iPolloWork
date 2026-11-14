# Suite architecture

The distribution unit is `@ipollo/dsh-suite`, declared by `dsh.bundle.patch`. Host and browser code remain separate. The Host owns account network traffic and credentials; the browser receives only display records. Browser contributions use `plugins.tab`, `settings.section`, `settings.launcher`, and the two sidebar brand slots. Plugin installation is delegated to the `plugins.tab` owner's callback.

DSH's plugin inventory is the sole installation authority. The repository's format-1 catalog is the sole curated source. The credential provider owns one versioned, origin-bound session-token record. Token records are not mirrored into local storage, Session logs, or frontend configuration. The agent module uses DSH's native storage domain for reusable definitions, credential references, and project memory; it introduces no separate database server.

`ipolloConnections` is an optional client service for plugin-owned connection groups. The suite's Service connections settings entry and global dialog share its registry. Plugins register field descriptions, presence reads and save callbacks, with a disposer; the registry retains no credential values. Equal group ids share one entry while either contributing plugin remains active. Plugin pages show status and open this editor. Standalone plugins retain their own native dialog when the suite is absent. IM's existing binding flows also use the native modal; their credential storage and connection operations remain owned by IM. See [the integration protocol](connections.md).

Market artwork uses live package metadata when available and the native default glyph when absent. Bundled catalog icons are generated from each package's declared `icon.svg`; `scripts/catalog-artwork.mjs` rejects drift between an archive and its catalog entry. Installation state never selects a separate custom avatar implementation.

Disposal aborts in-flight requests, removes stylesheet and palette contributions, and unwinds native slot registrations. Sign-out supersedes pending sign-in. Failed login never changes the saved credential. A failed points request preserves a valid identity and displays an unavailable value. Catalog failures are visible and do not fall back to a different market.

Future enterprise authorization belongs at the native operation's executor: plugin toggles/removal/update, config edits, and installation writes. The existing DSH protected-list behavior is a starting point, not a third-party authorization API. Any upstream addition must be generic and default to unchanged DSH behavior; company policy remains in a separate suite module.

## Project agents

The same suite bundle now includes `ipollowork-agents`. Its client page uses the existing request transport, locale selection, native sidebar slots and `suite.module.css`. There is still one installable suite. Unloading it removes both the original surfaces and the agent surfaces.

Reusable definitions compile into DSH agent presets. A parent Session retains one preset; native spawn delegation selects a different preset for each child. The module adds discovery and configures the native delegation tool; it does not replace the agent loop, provider, inbox or task-tree manager. Standard, Creator, PTC and Minimal remain unchanged.

The built-in `ipollo-coordinator` preset composes Standard with scoped coordination instructions and a native spawn tool fixed to Standard for temporary workers. Saved specialist IDs alone appear in `ipollo_delegate`; an omitted specialist choice resolves to its configured first specialist rather than inheriting the coordinator. The coordinator itself never appears in that list. Temporary workers are native child Sessions, not entries in the saved agent catalog.

The web entry is mounted by the suite's `shell.overlay` contribution into an owned node immediately after the native `[data-sidebar-workspace-header]` element. The suite removes that node and its observer on disposal; it does not replace the workspace browser. The native header attribute is a client compatibility dependency. The entry opens the latest eligible native Session from a dedicated Workspace, or creates one with the coordinator preset. No second session index is stored. Coordinator conversations replace the native preset picker with a fixed label; other conversations retain the native picker.

The `ipollo_agents` native storage domain owns definitions and memory. A memory key combines Workspace identity with agent identity; a child uses its tree root's original Workspace. The service picker reads the native MCP manager's configured fleet; new definitions retain service names, not duplicate transports or tokens. Native scoped tool restrictions track the live global registry. Legacy definitions without service selections preserve their prior inherited tools and dedicated connections. Shared services and Skills do not share project memory. These namespaces prevent automatic context mixing and are not filesystem sandboxes.

Definition and memory changes require the current revision. Failed storage writes do not publish replacement state. A definition is saved before native activation; a failed MCP startup is reported as an unusable definition that can be corrected. Disabled definitions keep memory and existing live compositions but cannot start new tasks; restoring them after a restart requires enabling them again.

The client keeps bot cards, a focused creation modal, and project-scoped start/memory dialogs separate. Creating an assistant needs no project or account step. Optional skill and service pickers stay collapsed, and the existing native modal owns focus, Escape and backdrop dismissal.

Avatar and model fields are optional additions to version-one definitions. Avatars are validated raster data URLs and are omitted from preset runtime configuration. A preset-scoped `agent/created` listener applies an explicit model only to fresh instances through `agent.model.select`; resume preserves recorded model selection. Omitted model choices keep the native creation defaults and never write the global model preference.

## Messaging

`ipollowork-im` is a component of the existing suite bundle, not another installation unit. A pinned vendor source tree supplies the adapters; the build emits one Host entry and includes its client page in the suite's client module. The Host refuses startup when the standalone IM bundle is also enabled. Channel settings continue to use their existing storage and credential providers; they are not connected to iPollo Account sign-in.

Inbound transport remains owned by each adapter. Shared ingress stages the original, obtains a native DSH file receipt, and optionally resolves speech through the configured native service. The prompt carries native attachment parts and a safe media manifest. No new Session event or persistent Session type is introduced. The existing DSH prompt controller owns receipt validation, durable attachment references, and model-visible logging. Transcription failure preserves media; cancellation stops dependent work. Vision-incompatible models receive an explicit file fallback.

The suite has no standalone updater or alternate DSH launcher. Disabling its bundle unwinds channel controllers, tool contributions, subscriptions and client slots while retaining stored settings. Compatibility is bounded by the package's declared DSH version range and checked against the installed native Host; future DSH API changes require validation.

Menu setup uses each platform's existing native command or menu API. The application menu stores fixed action keys and dispatches them through the same access-checked command path as typed commands. First-chat guides record an attempt in channel-local state before sending; concurrent callbacks share the pending attempt. Unknown delivery outcomes are retained as attempts to avoid duplicate messages. Existing administrator menus are never overwritten.

The suite sets an effective entry preset on every channel's workspace store. This runtime option overrides saved per-bot defaults for new Sessions without changing stored choices or existing Sessions. Native IM catalogs expose only that entry preset; the general DSH catalog remains complete. The same-process completion hook joins the coordinator's native task tree after its first turn, reads the final root turn, and preserves later failure and cancellation results. Ordinary Sessions retain their existing completion behavior. No Session event, persisted field or storage version changes in this release.
