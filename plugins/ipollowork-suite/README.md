# iPolloWork DSH suite

English | [中文](README.zh.md)

One installable DSH Bundle supplies the iPolloWork skin, a curated native-plugin market, optional iPollo Account sign-in, reusable project agents, and integrated IM channels. DSH owns execution, installed bundles, configuration layers, credentials, and the application launcher. No alternate agent runtime or installer is included.

Organization Space includes a manager-only analytics tab grouped by department, member or service/model (SKU), over 7, 30 or 90 days. Calls are enterprise-owned service requests, excluding polling and personal services; departments are captured at dispatch. Token coverage is explicit. Project creation and current skill/plugin inventory counts are separate; skill loads and tool calls are reported for linked enterprise projects. `enterpriseUsageReporting` (default true) controls metadata reporting; `enterpriseUsageQueueLimit` (default 200) bounds pending reports. Failed or overflowed reports are not retried and never delay tools, so counts may be incomplete. Arguments, results and credentials are excluded.

In Organization Space → Settings → Websites, managers can add links for all active members or limit them by department and role. The account service rechecks permission when a member opens a link in their browser.

## MCP connections

Settings → MCP lists native configured and plugin-registered connections alongside organization grants. Each row's menu offers the actions its source allows. Disconnect keeps configuration and persists across restarts; reconnect reuses DSH's manager. Only user-added configuration entries may be deleted, after confirmation; inherited and plugin-owned entries retain their original ownership. Edit opens DSH's native configuration document. Organization disconnect choices affect this device and account only, retaining the organization's grant. Organization administrators still manage sharing, distribution and revocation in the organization space. MCP credentials stay in the native credential provider.

## Develop

Organization templates and Skills accept custom version labels up to 64 characters. MCP publications label this as the shared configuration version, separate from protocol/server versions. Labels exclude control characters and `/ \\ ? # %`; duplicate versions are rejected. Plugins require the exact published package version. Skill sharing uploads a UTF-8 `.md`/`.markdown` file up to 32 KB through the existing review and grant flow. Update both Suite and the account service before using custom labels.

Node 24.15 or newer is required. In this repository, run `npm run setup:build` from the product root first, then run `npm ci --ignore-scripts --workspaces=false`, `npm run link:workspace`, `npm run check`, and `npm pack` from this directory. The linking command selects matching DSH packages from the ignored official dependency cache; the registry release with the same version may not include this checkout’s native extensions. The package contains its compiled Host and Client entries, styles, brand asset, and the curated catalog. No build script runs during installation.

`dependencies` lists DSH packages, the shared native pi-ai provider library, and `@matrix-org/olm`, whose WASM file is loaded from disk; the build bundles the remaining third-party libraries into `lib`. DSH maps each package name in an enabled bundle's dependency closure to one directory per process. A library name shared with another bundle, such as `yargs` from `qrcode`, would move to that bundle's copy when the suite is disabled, and DSH would then require a restart instead of disabling the suite immediately.

Install a built local checkout using `dsh plugin --profile <profile> add link:/absolute/path/to/ipollowork-dsh-suite`. Start it with the same `dsh --profile <profile>` launcher. Test in a separate profile before enabling in a working profile. Runtime compatibility is deliberately limited to the tested DSH release family. After rebuilding or moving a linked checkout, or replacing it with a packaged release, restart its DSH profile so the Host implementation and bundled catalog use the installed files; refreshing the browser alone does not clear Host module paths. The account-independent `/info` route reports the installed package version. Normal component and bundle switches apply live without a restart.

## Included project tools

Project Files, Project Board and Notification Center are native parts of this suite. Project Files appears in the right sidebar with inputs, outputs and actual workspace folders. Its **Plugins** details list the parts by their native entry IDs `ipollo-project-files`, `ipollo-collaboration-board` and `ipollo-notification-center`. The Board remains in the project conversation tabs. The notification bell and **Settings → Notifications** use the same notification feeds and preferences.

**Settings → Custom appearance** switches skins and sets the app name, logo, and separate light/dark palettes. The appearance plugin ID is `ipollo-custom-appearance`.

To move an earlier development profile from the standalone bundles, remove `@ipollo/dsh-collaboration-board` and `@ipollo/dsh-notification-center` through the native plugin manager before updating the suite. Keep the existing profile. If its `cordis.patch.yml` has a `name` assertion matching one of these old packages on the corresponding entry ID, remove just that assertion and retain the ID and other fields, including the notification preferences. The same entry IDs and storage domains load the existing boards, schedules, and settings.

## Modules

| Module | Owns |
| --- | --- |
| `cordis.patch.yml` | The single native Bundle entry |
| `src/host/index.ts` | Owner-authenticated routes, assets, and service lifetime |
| `src/host/market.ts` | DSH format-1 validation and live installation inventory |
| `src/host/account.ts` | iPollo login and DSH credential records |
| `src/client/theme.tsx` | Reversible palette and native brand slots |
| `src/client/suite.module.css` | All suite visual rules, including shared native/catalog detail dimensions |
| `src/client/market.tsx` | The native Plugins page's additional market tab |
| `src/client/account.tsx` | Account settings, launcher, and shared account state |
| `src/host/agents.ts` | Agent definitions, native presets, and delegation |
| `src/host/agent-runtime.ts` | Preset instructions, selected Skills, and project memory |
| `src/client/agents.tsx` | Agent library, configuration, and project memory editor |

## Configuration

Override the `ipollowork-suite` row's `config` in the profile patch. Fields are `accountOrigin` (defaults to iPolloWork Cloud), `catalogPath` (the bundled catalog by default), `requestTimeoutMs` (20000), `maxResponseBytes` (1048576), and `theme`, `market`, `account` (all true). Account services require HTTPS; HTTP is accepted only for loopback development. Changing the account origin never reuses another origin's saved credential.

Edit `catalog/index.json` to curate the DSH format-1 market. Design (including PPT) and Video appear first in the default catalog under Creative. `catalog/bundled-releases.json` pins their bundled archives and the exact GitHub Release that supplies each archive when the file is absent. Custom `catalogPath` indexes retain their declared native npm/Git sources.

The default market also reads `ipollowork-plugin-releases.json` from the `plugin-market` release in the iPolloWork GitHub repository. It offers the newest compatible release of each bundled plugin. When the feed is unavailable, the bundled catalog stays usable. Installing or updating a remote release downloads its exact archive on demand. The Host verifies its SHA-256 and stores it in the retained DSH home cache before passing a local `file:` target to DSH.

The market compares versions against DSH's installed inventory. For an older archive installation, **Update** confirms both versions and invokes DSH's installer with the expected name and version. The existing enable selection carries over. Git installs pinned to the same repository directory use DSH's native Git update dialog. Registry installs are managed in the installed plugin's native details. The Enterprise tab reports whether an enterprise catalog is connected.

To publish a plugin release independently of the desktop, start with the current `ipollowork-plugin-releases.json` in your output directory and run `node scripts/prepare-market-release.mjs <asset-release-tag> <output-directory> <plugin.tgz>` from the Suite. The script reads the package's version and DSH range, adds the checked archive and retains the other pinned versions. Upload the archive to its exact release tag before replacing the manifest asset on the `plugin-market` release. Once a version is listed, publish changed contents under a new version.

With `theme` enabled, the skin gives DSH iPolloWork's title, icons, boot mark, sidebar mark and home wordmark. The reversible palette supplies black and white actions and neutral selection, focus and surface colors in both themes. The sidebar, conversation, native settings, organization space and bundled Design and Video workbenches use the same palette. Set `theme: false` on the Suite configuration row to use the native DSH theme with the Suite still enabled. Project and agent creation, account and organization settings, connections and the market reuse the [shared form components](../_shared/ui/controls.tsx). Warnings use DSH's semantic warning colors. Studio document previews have their own styles.

The skin presents native composer references as the original iPolloWork selection chips: a compact rounded label with a persistent close button, light and dark palettes, and ellipsis for long labels. Styling is scoped to the enabled suite; DSH still owns reference data, keyboard editing, removal, and context serialization.

The market uses compact rows. Installed and DSH-provided entries open DSH's existing detail page directly. Uninstalled entries use one `PluginDetailPage` template in `market.tsx`: one back button, a 48px package icon, package summary, components, and release information below. The suite hides the native list header only while its own catalog detail is open, using DSH's data attributes. Search and category selection remain when returning from catalog details. Layouts support light and dark themes and narrow screens. All visual rules live in `suite.module.css`; native and catalog details share icon/title dimension variables. DSH does not currently export a common page component for installed and uninstalled entries, so this suite does not import or copy its private page implementations.

## Official integration

The suite uses native profile patches to replace account onboarding, which persists through DSH settings. The official plugin-manager provider stays mounted during installation, activation and deactivation, retaining its generated Remote definitions. Users can disable or remove this third-party bundle through the official manager. Sharing contributes its own header dialog and audience slot while all share operations use the official `liveshareShares` Remote. These are product UI and policy extensions; no official source edits or separate Agent loop are required.

For the activation regression, set `IPOLLO_LIFECYCLE_OWNER_FILE` to a private JSON file containing `origin` and `cookie` for a disposable official Web profile with the built suite installed, then run `node --test tests/bundle-lifecycle.test.mjs`. The test disables and enables the suite twice and leaves it enabled. Version 0.1.22 removes the previous manager replacement; after installing it over 0.1.21, restart the Host to restore the official manager and its Remote definitions.

The official 0.2.2-rc.3 desktop release owns authentication inside Connection; the pinned source build exposes a separate authentication service. The suite mounts under that service when present and otherwise delegates to the release's existing Connection. It creates no verifier and changes no admission policy. Both runtimes require authenticated requests.

## Account behavior

Account-channel defaults use the official model catalog, credential metadata and `agentDefaultModel.saveSelection()` services. A configured personal API key or an existing account-channel selection is retained. The suite does not extend `SessionController.initializeDefaultModel()`.

Local work and browsing the public catalog require no iPollo login. The account page registers with an email and a password of at least 10 characters; the initial display name comes from the email’s local part. Account connection status does not imply that official services are configured; service availability is shown in Service connections. An empty service catalog is not a sign-in failure. Registration uses `/api/auth/sign-up/email` and signs in with the returned session. Email/password login uses the existing Better Auth `/api/auth/sign-in/email` and `/api/auth/get-session` endpoints. Tokens persist only in DSH's credential provider. Passwords are discarded after each request. `/api/v1/me/summary` supplies optional points; an unavailable balance is displayed as unavailable, never zero. Disconnect removes this suite's local token; it neither deletes the account nor changes DSH's other model-provider credentials.

The bundle replaces the built-in DeepSeek account UI and its notification UI through two ordinary profile overrides; the DeepSeek account service and other model-provider credentials remain intact. Disabling the bundle removes these overrides. With `account: false`, the suite presents no account UI.

The account page shows identity, available credits and membership, daily and weekly consumption, and seven days of usage in one column of setting rows, like DSH's own settings pages; plans open in a dialog. Account data, orders and payments belong to this standalone service. Checkout is offered only for configured payment channels and enabled plans.

The suite uses provider model capacities without a separate product output limit. A committed truncated account-model response with no pending tool calls or queued human input continues through the native agent inbox. Continuation text is recorded as `ipollowork-output-continuation`; the client suppresses the protocol warning row. Unloading removes listeners and unclaimed continuation messages, while preserving user messages and recorded output.

## Limits

The agent module registers discovery, native delegation, and project-memory tools. Account secrets and market administration are not injected into a conversation. In the dedicated desktop, a native pre-execution policy refuses direct `plugin_manager` mutations of the built-in components while preserving reads and management of other plugins. The public plugin adds no such restriction. This is not tamper protection: shell/file access can bypass that tool, and DSH's built-in protected-package list does not automatically protect arbitrary third-party bundles. An administrator-managed installation still requires a generic management-authorization extension plus operating-system isolation if agents or third-party Host plugins can write the installation. Do not use hiding UI or this package's presence as an enterprise security boundary.

Existing theme plugins can override the same tokens. Use one product skin at a time. Removing the suite retracts its slots, stylesheet, and palette without deleting account or session data. Account sign-in is implemented against the checked-in iPollo service protocol; production login requires a real account and live-service validation. Native installer branding, enterprise catalog distribution, payment processing, and importing old iPolloWork package formats are outside this version.

The existing iPolloWork logo is included as the product brand asset. Third-party plugins retain their own authorship and licenses.

## Reusable project agents

The suite's **Agents / 智能体** navigation shows reusable assistants with a direct **Start chat** action. Creation asks for a name and work instructions; Skills and existing DSH services are optional, collapsed choices. An optional avatar accepts PNG, JPEG or WebP up to 5 MB; the browser center-crops and reduces it to a 256-pixel square before saving. Only the compact raster is retained in native storage. Existing assistants without an image keep their text avatar, and images never enter model inputs. Pick a project when starting a conversation or opening project memory, not when creating the assistant. The same definition can be used by several projects; conversations and memory remain separate. Selected Skills retain their resource references; the Standard composition's existing Skills remain available.

`ipollo_list_agents` discovers enabled agents and `ipollo_delegate` delegates through the native spawn backend. Each child gets its selected preset, so one main Agent can coordinate different specialists without switching its own preset. The existing four presets are not edited. The service picker reads DSH's existing MCP manager and reuses its connections and credentials; it does not create another server or account record. Service selection restricts inherited MCP tools for that assistant and follows live tool registration changes. This is tool visibility, not filesystem or tenant isolation. Older saved dedicated MCP connections remain usable, but new connections are configured in DSH's service settings. The suite's account sign-in is independent of assistant creation.

The model selector defaults to the current native model: a new top-level conversation uses DSH’s global default, and a delegated assistant inherits its parent’s model. An explicit choice applies to newly created instances of that assistant, including delegated children, using native durable model selection. It does not update DSH’s global default or overwrite a model already selected in an existing conversation. Choices come from the native model catalog and use existing provider credentials.

The optional `ipollowork-agents` component has configurable agent and memory limits and an MCP startup timeout. Turning off the suite removes its UI and new-task capabilities while retaining saved data. The feature lives in this existing package; there is no second suite or standalone application.

Run `npm run check` for unit checks. For a native run, launch a disposable DSH profile with this bundle and `tests/native.patch.yml` (compile the test fixture to JavaScript for a packaged launcher), then set `IPOLLO_QA_URL` to its owner URL when running `npx tsx --test tests/native.test.ts`. This keyless test verifies real model-request inputs, different child presets, project memory separation and authenticated MCP startup.

## Integrated messaging

The sidebar workspace navigation uses the native workspace and conversation list without a separate Main assistant shortcut. Existing main-assistant conversations retain their preset and history; messaging connections continue to use `ipollo-coordinator`.

Every new messaging connection starts native `ipollo-coordinator` sessions, including QR and automatic connections. It can work directly, use saved specialists through `ipollo_delegate`, or create task-specific temporary workers through `ipollo_dispatch`. Temporary workers use the native Standard preset and inherit the main assistant's model; saved specialists retain their own instructions, Skills, selected services and optional model. The IM request waits for the native task tree and returns the main assistant's collected answer.

Each platform connection is authorized once; specialists need no separate QR codes. Separate chats retain separate native Sessions, and selected project/workspace settings remain authoritative. The global coordinator definition is shared, not its chat history. The suite does not add access to undisclosed group messages or merge histories across channels.

Existing bound conversations retain their preset and history. Send `/new` to start with the main assistant after upgrading. The IM preset selector now describes this fixed entry point; manage specialists in **Agents**. Saved older per-bot preset choices remain on disk and are not overwritten. See [the upgrade notes](docs/upgrades/main-assistant.md).

The `ipollowork-im` component embeds the MIT-licensed DSH IM adapters inside this suite. Its settings and optional sidebar page are part of iPolloWork; the curated market no longer offers a duplicate standalone IM install. Source and local changes are documented in [vendor/dsh-im/README.md](vendor/dsh-im/README.md).

Before switching from `@xmanrui/dsh-im`, disable that bundle in DSH's native plugin manager, then enable this suite. Existing channel settings and native credential references are reused. Keeping both enabled is rejected to prevent duplicate bot replies. Disabling the suite removes its channel controllers and UI through their native plugin lifetimes; saved configuration is retained. Refresh the page if native hot reload leaves the previous client visible after a bundle switch. No DSH core package or original preset is modified.

Images enter the normal native image pipeline. A model without vision receives the retained image as a file and an explicit limitation, not a claim that it saw the picture. Received files and audio become native conversation attachments. DingTalk's recognition text and WeCom's voice transcription are retained. Feishu and WeCom application recordings can use an already-configured native speech provider; format conversion requires `ffmpeg` unless the input is already canonical 16 kHz mono PCM WAV. Missing or failed transcription retains the recording and its status. WeCom intelligent-bot callbacks normally provide text only; an original recording can be saved only when the platform supplies a download reference.

Result media continues through the existing `dsh_im_return_file` channel delivery tool. Plain Markdown containing a local file path is not a media upload. The inherited adapters choose a supported image or file message and report delivery failures; platform-specific native voice bubbles remain subject to each adapter's support.

Run `npm run check`, `npm run test:im-upstream`, and `npm run pack:check`. For the keyless native media replay, compile `tests/im-native-fixture.mjs` with esbuild into a disposable fixture (copy `tests/fixtures/avatar.png` alongside it), point `tests/im-native.patch.yml` at that file, launch with the native `dsh web` profile, and set `IPOLLO_IM_QA_URL` when running `node --import tsx --test tests/im-native.test.mjs`. It uses local channel responses and a mock model, never live bot credentials.

### Menus after connecting a bot

Feishu and Telegram keep their native command-menu registration. If Feishu's panel is unavailable, the first authorized private message opens its existing menu card. DingTalk and QQ show their existing interactive menu on the first authorized private message; WeCom intelligent bots show a compact welcome card on the first chat-entry event, or on the first private message if the entry event was absent. WeChat uses a text guide. The original message is still processed, and group chats receive no unsolicited introduction.

WeCom self-built applications automatically create a native bottom menu with Chat, Agents, and Actions. Click events map to the existing commands and keep their access checks. Existing administrator-owned menus are preserved; if registration is unavailable, the application shows the text guide on first entry or first authorized message instead.

An optional `menuIntroductions` field in each channel's version-one state records attempted introductions per conversation before sending. It survives restarts; an uncertain or failed delivery is not automatically retried, and explicit `/menu` or `/help` remains available. This adds no DSH Session event or persistence type. Platform menus and card layout still require acceptance on real mobile clients; automated checks use authenticated callback samples and mocked platform APIs.

## Enterprise projects

The enterprise page also manages departments, shared file packages, skills and enterprise models. Their member and department audiences are described in [Enterprise assets](docs/enterprise-assets.md). These features require the PostgreSQL account service; see [service setup](../../services/ipollowork/README.md).

Create a personal or enterprise project in the native directory form. Enterprise projects can be shared with a member or a department as View or Participate; project Access also supports Maintain. Department grants use current membership on every request. Project maintainers control access and accept changes. Native work stays in the selected local directory. Generated files remain local by default; participants choose which outputs to upload.

Projects have Overview, Files, Project memory, and Changes. Participants submit selected file versions or distilled knowledge. These are immutable submissions, not comments or published reports. Maintainers accept file changes against the recorded file versions and edit the complete next memory version before accepting knowledge. Conflicts retain the draft and leave the main project untouched. The account service stores accepted file references, memory and submissions; it does not execute agents or require Git.

Connect a native workspace from the project's local-workspace section. The link contains only the service origin and project ID. Before each DSH model step, the suite checks project access and loads the current accepted project memory through the native system-prompt context. The `ipollo_project_memory` tool reads memory, submits distilled knowledge, or merges a named contribution with an explicit version check and maintainer authorization. Accepted summaries are limited to 8,000 characters and two heading levels. Revoked access stops the next linked step instead of reusing cached memory. Native `present` does not upload files by default. Inputs and complete local Sessions are not uploaded. The Files page lists output versions, author and capacity and uploads files explicitly selected by a participant. Maintainers control upload permission. Native local files remain after cloud expiry. See [storage rules](../../services/ipollowork/docs/storage.md).

Conversation sharing uses DSH’s existing share dialog. Opening it connects the current account through the native PKCE flow; an already verified owner is reused. No second account login or sharing-server field is required. The suite contributes one recipient selector: anyone with the link or an organization. Organization sharing targets the entire organization or selected departments; individual recipients receive the link directly. The selector remains visible for existing links, and the native Save action applies recipient changes. The native session permissions, fork switch and link management remain unchanged. Team access follows current membership; removing the suite removes its recipient selector and account-preparation hook. The independent account service validates the selected audience and relays native sessions; it does not copy transcripts. Public links allow anonymous visitors, so choose the native session permissions before sharing. The sharing computer must remain online.

The conversation header and menu always retain the share entry. Signed-out users open account sign-in; signed-in users see the share dialog, including catalog loading and retry states.

The legacy snapshot and result records remain readable for retention, but new snapshot, comment and legacy result writes return HTTP 410. Upgrade the account service before this suite. See [upgrade notes](docs/upgrades/2026-11-14-project-spaces.md).


The relay integration can be verified against a disposable seeded service and the native fixture profile with `IPOLLO_QA_URL`, `IPOLLO_RELAY_ORIGIN`, and `IPOLLO_RELAY_TEST_PASSWORD` set, then `node --import tsx --test tests/liveshare-native.test.ts`. It creates a test project, exercises a real native continuation/fork/stream, revokes the test project grant, and stops the created shares. Never point this fixture at a working profile.

Project links accept the official account-domain migration between `https://work.ipollo.net` and `https://cloud.ipollo.net`. Requests still use the configured service and its current project permissions; other deployments remain isolated. This compatibility does not grant access to missing or forbidden cloud projects.

Output uploads use `uploadTimeoutMs` (300,000) and `maxArtifactBytes` (536,870,912). The deployment-only `automaticOutputArchive` defaults to false. Enabling it streams completed native presentations for linked projects with upload permission; `archiveHistoryLimit` (500) bounds its receipts. The in-memory archive queue retains no full Session objects. When the queue is full, the Host reports that the local file must be uploaded from the project page. Completed receipt history is bounded; backend request IDs prevent a replay from creating a duplicate version.

The optional Host service also publishes file sets selected in Design. It streams files under the current account, associates an existing linked project when present, and opens the complete publication on the service's separate browsing origin. Standalone Design installations retain their own storage provider settings. Storage credentials and account tokens never enter the generated page.

For the keyless output-archive smoke, point the isolated profile at a disposable PostgreSQL service, compile `tests/native-fixture.ts` and load `tests/native.patch.yml`, then run `IPOLLO_ARCHIVE_QA_URL=<private-owner-url> node --import tsx --test tests/project-archive-native.test.ts`. It verifies that native presentation stays local, explicit output upload, an authorized download over 24 MiB and input exclusion. The expected result stays under `tests/expected`.

Organization-space project creation is fixed to the selected organization; personal creation remains in the global directory flow. Organization administration has no shared-conversation tab or list of unassigned personal projects. Native conversation sharing remains on each conversation.

Service records carry a stable `category` (`language`, `image`, `video`, `audio`, `embedding`, `tool`) and `vendor`; model entries retain their own category. Only language models with token limits register in the native chat selector. Organization service lists and department grants use these categories, including tool services. Non-chat organization connections require explicit allowed API routes; existing connections keep their routes and classification when edited.

Official media calls select a service by its allowed route and the requested model. This lets image generation and speech share a provider endpoint and key without selecting the wrong category. Regional provider origins remain owned by the account service. Disabling the suite or choosing native personal credentials removes official routing.

The `dedicatedDesktop` deployment option reuses the native welcome, credit, purpose and process pages with the iPolloWork account. The native account page provides email/password sign-in and registration with a display name and a password of at least 10 characters. API-key setup remains available. The desktop distribution embeds this bundle and its QR-code dependency; it does not require an npm installation at first launch.

Suite 0.1.10 requires DSH 0.2.2-rc.3 or later in the 0.2.2 release line. Its HTTP routes use the native Connection admission service, including the Host/Origin checks and credential verification.

Registered account model channels display their backend names under iPolloWork. Login selects an available account channel when no personal provider key is configured; an existing selected account channel is retained. Users can add and choose personal API-key providers through the native Models settings. Account inference uses a private local gateway token, and insufficient points produce an account-quota failure rather than a key error.

The embedded IM runtime uses Cordis’s public root-context symbol. Bundled Design and Video are imported byte-for-byte from their checked native source builds. Run `node scripts/prepare-studio-releases.mjs <archive-directory> <version>` to update both archives and the catalog together; each bundle declares its own rc.3 authentication dependency.

Account balances refresh when the application regains focus or becomes visible. Compatible DeepSeek and Bailian chat models inherit the installed provider catalog’s reasoning levels and request dialect; unknown models remain selectable without invented reasoning levels.

Account and payment layouts contain their box sizing within the native settings panel. The suite resolves DSH services from the host through peer dependencies; installing it does not replace the host runtime packages.

## HTTP capabilities

The native `ipollo_capabilities`, `ipollo_capability_describe`, `ipollo_capability_invoke` and `ipollo_capability_task` tools discover and call the [capability HTTP API](../../services/ipollowork/docs/capabilities.md). Detailed inputs load on demand; requests reuse native call identities for idempotency, preserve cancellation and respect read-only sessions. These tools do not expose account or provider keys.

## App data

The Data page, the `app_data` model tool and the `ipolloData` plugin service give plugins, sites and apps a record store in the account service without a database of their own. See [App data](docs/app-data.md).

Design publication uses a stable workspace-and-file identity. Repeated publishing updates the same public URL, while uploads remain private until the complete revision is ready. The account service must provide schema 8 and the publication-site lookup endpoint.

## Sandbox plugins

Alibaba Agent Sandbox ships as an optional, disabled-by-default plugin component. It uses the official DSH tool and lifecycle APIs. See [configuration, persistence requirements and verification limits](docs/sandbox-plugins.md).

Cloud projects: [setup, lifecycle and validation limits](docs/cloud-projects.md).



Office onboarding and skipping setup retain the full agent preset list. Compact chat changes transcript and usage presentation without disabling coding view. Existing installations can enable coding view in Settings to restore PTC and Minimal modes.

Official vision model channels resolve DSH’s durable attachment service at request time for both user images and tool-result screenshots. They preserve the native attachment and filesystem mapping rather than creating a separate image store.

Source and desktop profile setup permits the pinned esbuild and sharp builds used by Studio, while skipping ONNX postinstall downloads: Studio uses the CPU provider already included in the package. Existing operator build policies are retained. First installation still needs npm dependencies; subsequent installs reuse the package-manager cache.

Organization model connections support `shared` (default) and `member` credential modes. In member mode each authorized member saves their own key from **My API key**; it is encrypted in the account service, never returned by list APIs, and requires a project belonging to the organization at execution. Changing the endpoint or credential mode clears member keys. Removing a member or service clears its corresponding keys. Signing out disconnects the local account but preserves server-side member keys; other devices are not modified.

## Curated market administration

The existing market shows **Add plugin** only after `/api/v1/market/manage` confirms the signed-in account has the platform `admin` role. Enterprise owner/admin roles do not grant permission to publish to the public market. Every write is checked again by the account service. Paste a public GitHub repository URL, npm package name or npm package page into the form. The unmodified official DSH reference generator reads names, localized descriptions, icons, release versions and compatibility without executing plugin code. Choose a plugin when a repository contains several, preview its compatible pinned release, then confirm. Advanced settings contain optional display text, category and npm registry overrides. It does not copy, install, execute or audit third-party code. Duplicate package names are refused; existing bundled entries keep precedence.

New references are stored centrally in the account service's existing encrypted settings, with serialized writes and transactional audit records; no new database table is needed. `/api/market/catalog` exposes only the bounded public references. The suite merges these with the shipped catalog. If the service is unavailable or has not been upgraded, shipped plugins remain browsable and the add button stays hidden. Deploy both packages to enable administration; no deployment is performed by a local build.

Public-source discovery runs in a bounded child process from the pinned official generator bundled at build time; it is not a second Agent runtime. A custom HTTPS npm installation registry may be supplied in advanced settings. Mainland/overseas automatic routing and artifact mirroring are a separate deployment step: mirror only reviewed versions and permitted artifacts, verify content digests, then route to equivalent sources. No public proxy, automatic mirror or geographic detection is enabled by this form. Existing user pages and installation dialogs are unchanged.

## Distribution account origin

`deployment.json` owns the default public account origin and ships in this package. Explicit profile configuration remains authoritative. Dedicated desktop mode retains its account origin instead of replacing it with the official cloud address; explicit legacy official origins are retained as well. HTTPS and origin validation remain required, with loopback HTTP permitted for development. Stored tokens remain scoped to their exact origin. Desktop release files accept `DSH_DESKTOP_ACCOUNT_ORIGIN`; an explicit `PACKAGE_ACCOUNT_ORIGIN` overrides that file for one build. Rebuild/package after changing distribution defaults.
