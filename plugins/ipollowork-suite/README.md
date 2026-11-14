# iPolloWork DSH suite

English | [中文](README.zh.md)

One installable DSH Bundle supplies the iPolloWork skin, a curated native-plugin market, optional iPollo Account sign-in, reusable project agents, and integrated IM channels. DSH owns execution, installed bundles, configuration layers, credentials, and the application launcher. No alternate agent runtime or installer is included.

## Develop

Node 24.9 or newer is required. Run `npm ci`, `npm run check`, and `npm pack`. The package contains its compiled Host and Client entries, styles, brand asset, and the curated catalog. No build script runs during installation.

`dependencies` lists DSH packages, the shared native pi-ai provider library, and `@matrix-org/olm`, whose WASM file is loaded from disk; the build bundles the remaining third-party libraries into `lib`. DSH maps each package name in an enabled bundle's dependency closure to one directory per process. A library name shared with another bundle, such as `yargs` from `qrcode`, would move to that bundle's copy when the suite is disabled, and DSH would then require a restart instead of disabling the suite immediately.

Install a built local checkout using `dsh plugin --profile <profile> add link:/absolute/path/to/ipollowork-dsh-suite`. Start it with the same `dsh --profile <profile>` launcher. Test in a separate profile before enabling in a working profile. Runtime compatibility is deliberately limited to the tested DSH release family. After rebuilding a linked checkout, restart its DSH profile so the Host implementation and bundled catalog are updated together; refreshing the browser alone does not reload Host modules.

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

Override the `ipollowork-suite` row's `config` in the profile patch. Fields are `accountOrigin` (default `http://localhost:4785` for the separately started local account service), `catalogPath` (the bundled catalog by default), `requestTimeoutMs` (20000), `maxResponseBytes` (1048576), and `theme`, `market`, `account` (all true). Public account services require an explicit HTTPS origin; HTTP is accepted only for loopback development. Changing the account origin never reuses another origin's saved credential.

Edit `catalog/index.json` to curate the market. It keeps DSH format 1. Design (including PPT) and Video appear first in the default catalog under Creative. Their current tarballs ship in `catalog/packages/`; `catalog/bundled-releases.json` pins their versions and SHA-256 hashes. For this default catalog only, the Host verifies those files, copies them atomically into a retained content-addressed cache under DSH home, and supplies local `file:` specs to DSH's existing installer. The saved install source therefore survives suite upgrades or removal. No unpublished npm version is needed, and showing a card does not install or enable its plugin. Replace the tarballs and their checksum records together when updating a release. Custom `catalogPath` indexes retain their declared native npm/Git sources.

Installed state always comes from DSH. The market opens DSH's existing install dialog and installed-bundle detail page. It never downloads or executes packages itself. The Enterprise tab reports that no enterprise catalog is connected.

The skin presents native composer references as the original iPolloWork selection chips: a compact rounded label with a persistent close button, light and dark palettes, and ellipsis for long labels. Styling is scoped to the enabled suite; DSH still owns reference data, keyboard editing, removal, and context serialization.

The market uses compact rows. Installed and DSH-provided entries open DSH's existing detail page directly. Uninstalled entries use one `PluginDetailPage` template in `market.tsx`: one back button, a 48px package icon, package summary, components, and release information below. The suite hides the native list header only while its own catalog detail is open, using DSH's data attributes. Search and category selection remain when returning from catalog details. Layouts support light and dark themes and narrow screens. All visual rules live in `suite.module.css`; native and catalog details share icon/title dimension variables. DSH does not currently export a common page component for installed and uninstalled entries, so this suite does not import or copy its private page implementations.

## Account behavior

Local work and browsing the public catalog require no iPollo login. The account page supports inline registration with a name, email and a password of at least 10 characters. Registration uses `/api/auth/sign-up/email` and signs in with the returned session. Email/password login uses the existing Better Auth `/api/auth/sign-in/email` and `/api/auth/get-session` endpoints. Tokens persist only in DSH's credential provider. Passwords are discarded after each request. `/api/v1/me/summary` supplies optional points; an unavailable balance is displayed as unavailable, never zero. Disconnect removes this suite's local token; it neither deletes the account nor changes DSH's other model-provider credentials.

The bundle replaces the built-in DeepSeek account UI and its notification UI through two ordinary profile overrides; the DeepSeek account service and other model-provider credentials remain intact. Disabling the bundle removes these overrides. With `account: false`, the suite presents no account UI.

## Limits

The agent module registers discovery, native delegation, and project-memory tools. Account secrets and market administration are not injected into a conversation. A native pre-execution policy refuses direct `plugin_manager` mutations of this suite while preserving reads and management of other plugins. This is not tamper protection: shell/file access can bypass that tool, and DSH's built-in protected-package list does not automatically protect arbitrary third-party bundles. An administrator-managed installation still requires a generic management-authorization extension plus operating-system isolation if agents or third-party Host plugins can write the installation. Do not use hiding UI or this package's presence as an enterprise security boundary.

Existing theme plugins can override the same tokens. Use one product skin at a time. Removing the suite retracts its slots, stylesheet, and palette without deleting account or session data. Account sign-in is implemented against the checked-in iPollo service protocol; production login requires a real account and live-service validation. Native installer branding, enterprise catalog distribution, payment processing, and importing old iPolloWork package formats are outside this version.

The existing iPolloWork logo is included as the product brand asset. Third-party plugins retain their own authorship and licenses.

## Reusable project agents

The suite's **Agents / 智能体** navigation shows reusable assistants with a direct **Start chat** action. Creation asks for a name and work instructions; Skills and existing DSH services are optional, collapsed choices. An optional avatar accepts PNG, JPEG or WebP up to 5 MB; the browser center-crops and reduces it to a 256-pixel square before saving. Only the compact raster is retained in native storage. Existing assistants without an image keep their text avatar, and images never enter model inputs. Pick a project when starting a conversation or opening project memory, not when creating the assistant. The same definition can be used by several projects; conversations and memory remain separate. Selected Skills retain their resource references; the Standard composition's existing Skills remain available.

`ipollo_list_agents` discovers enabled agents and `ipollo_delegate` delegates through the native spawn backend. Each child gets its selected preset, so one main Agent can coordinate different specialists without switching its own preset. The existing four presets are not edited. The service picker reads DSH's existing MCP manager and reuses its connections and credentials; it does not create another server or account record. Service selection restricts inherited MCP tools for that assistant and follows live tool registration changes. This is tool visibility, not filesystem or tenant isolation. Older saved dedicated MCP connections remain usable, but new connections are configured in DSH's service settings. The suite's account sign-in is independent of assistant creation.

The model selector defaults to the current native model: a new top-level conversation uses DSH’s global default, and a delegated assistant inherits its parent’s model. An explicit choice applies to newly created instances of that assistant, including delegated children, using native durable model selection. It does not update DSH’s global default or overwrite a model already selected in an existing conversation. Choices come from the native model catalog and use existing provider credentials.

The optional `ipollowork-agents` component has configurable agent and memory limits and an MCP startup timeout. Turning off the suite removes its UI and new-task capabilities while retaining saved data. The feature lives in this existing package; there is no second suite or standalone application.

Run `npm run check` for unit checks. For a native run, launch a disposable DSH profile with this bundle and `tests/native.patch.yml` (compile the test fixture to JavaScript for a packaged launcher), then set `IPOLLO_QA_URL` to its owner URL when running `npx tsx --test tests/native.test.ts`. This keyless test verifies real model-request inputs, different child presets, project memory separation and authenticated MCP startup.

## Integrated messaging

The **Main assistant / 总助手** entry stays above the native conversation list. Clicking it continues the newest web main-assistant conversation; its plus button starts another, always using `ipollo-coordinator`. The Agents page contains saved specialists only. The web entry uses a dedicated native Workspace, configurable through `ipollowork-agents.config.coordinatorWorkspace` (default `$DSH_HOME/ipollowork/assistant`). Its history stays separate from IM connections.

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

Create a personal or enterprise project in the native directory form. Enterprise projects can be shared with a member or a department as View or Participate; project Access also supports Maintain. Department grants use current membership on every request. Project maintainers control access and accept changes. Files remain in the selected local directory until a member explicitly selects files to submit.

Projects have Files, Project memory, and Changes. Participants submit selected file versions or distilled knowledge. These are immutable submissions, not comments or published reports. Maintainers accept file changes against the recorded file versions and edit the complete next memory version before accepting knowledge. Conflicts retain the draft and leave the main project untouched. The account service stores accepted file references, memory and submissions; it does not execute agents or require Git.

Connect a native workspace from the project's local-workspace section. The link contains only the service origin and project ID. Before each DSH model step, the suite checks project access and loads the current accepted project memory through the native system-prompt context. The `ipollo_project_memory` tool reads memory or submits distilled knowledge for acceptance. It cannot overwrite accepted memory. Revoked access stops the next linked step instead of reusing cached memory. Local files are not automatically synchronized; project files can be downloaded and selected files submitted.

Conversation sharing uses DSH’s existing share dialog. The suite contributes one recipient selector: anyone with the link, a team, selected departments, or selected members. The native session permissions, fork switch and link management remain unchanged. Team access follows current membership; removing the suite removes only its recipient selector. The independent account service validates the selected audience and relays native sessions; it does not copy transcripts. Public links allow anonymous visitors, so choose the native session permissions before sharing. The sharing computer must remain online.

The conversation header and menu always retain the share entry. Signed-out users open account sign-in; signed-in users see the share dialog, including catalog loading and retry states.

The legacy snapshot and result records remain readable for retention, but new snapshot, comment and legacy result writes return HTTP 410. Upgrade the account service to database version 5 before this suite. See [upgrade notes](docs/upgrades/2026-11-14-project-spaces.md).


The relay integration can be verified against a disposable seeded service and the native fixture profile with `IPOLLO_QA_URL`, `IPOLLO_RELAY_ORIGIN`, and `IPOLLO_RELAY_TEST_PASSWORD` set, then `node --import tsx --test tests/liveshare-native.test.ts`. It creates a test project, exercises a real native continuation/fork/stream, revokes the test project grant, and stops the created shares. Never point this fixture at a working profile.
