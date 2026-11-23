# iPolloWork desktop

English | [中文](README.zh.md)

For a local bulk-plugin maintenance pass, `start-local-hot.ps1 -Restart -NoNativeHmr` temporarily disables the generated native HMR entry. The native Plugin Manager then records package changes as requiring a restart. Run `start-local-hot.ps1 -Restart` afterwards to apply them and restore HMR. This retains the existing profile, accounts and plugin data.

This package owns iPolloWork's Electron shell, email sign-in, branding and distribution. It launches the official DSH profile through [the desktop host](../desktop-host/README.md). The Agent loop, tools, sessions and credentials remain official DSH services. Product account, onboarding, sharing and mandatory-plugin behavior live in [the suite](../../plugins/ipollowork-suite/README.md).

Users see iPolloWork throughout: menus, the About panel, tray, dialogs, the application and tray icons (the black mark on a white tile), copyright, the link-protocol name and Windows shortcuts. While the Host starts, the shell serves DSH's boot page and Web document with iPolloWork's title, mark and name in place of DSH's wordmark. The packaged application, executable, helper processes and Windows installation folder are named iPolloWork (`iPollo.app`, `iPollo.exe`), so macOS also shows iPolloWork in the menu bar and Activity Monitor. Installer and update files keep the `iPollo-<version>-<os>-<arch>` names that the pinned DSH publisher looks up.

DSH dependencies are built from the exact official source revision in [the runtime pin](../runtime/upstream.json), without changes under `packages/` or `apps/`. The npm release with the same version predates the source authentication API; do not mix its packages into the desktop. The official ASAR layout keeps JavaScript and assets under `app.asar/dsh`; only native executables and resources that require physical files are unpacked. The CLI, Host and runtime smoke use that same layout.

For a local unsigned Mac application directory, install dependencies with `node integrations/tooling/setup.mjs --plugins`, then run `node integrations/desktop/run.mjs package-target.ts mac-arm64 --dir --unsigned` from the repository root. Output lives in `.desktop-build/`. Signed distribution also requires the platform signing configuration.

There is no old iPolloWork profile conversion or downgrade layer. Files and account credentials remain owned by the configured DSH home. The original DeepSeek Harness MIT license is retained in `LICENSE`; product changes are maintained here, independently from the official app tree.

On Windows, a staged Jovan development desktop can be started with `powershell -NoProfile -File integrations/desktop/scripts/start-local-hot.ps1`. Keep the staged shell running the first time so the launcher can record its profile. The launcher uses the staged Node.js runtime by default (`-NodeExecutable` can override it). Before reusing a window, it verifies the pinned DSH source and fingerprints the current shell, Host and account composition. Changed sources are built into a new ignored stage, and the previous shell is replaced only after a successful build. This preserves legacy checkout directories, the same DSH home and Electron user data. The linked Work suite builds on startup and after source saves; DSH's native Host and client HMR apply it. `-Restart` also replaces an unchanged shell; otherwise a current watched window is activated. Rerun the launcher after shell or Host source changes.

To build an installer on its native platform, run `node integrations/tooling/setup.mjs --plugins` from the repository root, then run the matching command below. The package command builds and verifies the pinned runtime and product.

| Target | Command | Website asset |
| --- | --- | --- |
| Windows x64 | `npm run package:desktop:win:x64` | `ipollowork-win-x64-<version>.exe` |
| macOS Apple Silicon | `npm run package:desktop:mac:arm64` | `ipollowork-mac-arm64-<version>.dmg` |
| macOS Intel | `npm run package:desktop:mac:x64` | `ipollowork-mac-x64-<version>.dmg` |
| Linux x64 | `npm run package:desktop:linux:x64` | `ipollowork-linux-x86_64-<version>.AppImage` |

The public installer is in the build output's `website-installers/` directory. The Windows command accepts `-- --unsigned` and keeps `-unsigned` in its filename. The macOS commands require notarization. Linux packages use the pinned iPollo runtime and ship as standalone AppImages.

## Product versions

General Settings and About display the Electron package version. The release tag supplies that version for official builds. The bundled DSH runtime tracks `integrations/runtime/upstream.json` independently.

Create a numeric draft such as `v1.0.5` at the intended commit, then run `ipollo-release-packages.yml`. It validates each runtime and attaches one public installer per platform, the macOS update ZIPs, the blockmaps and the Mac build records. Run `ipollo-publish.yml` to verify those files, generate the stable update feeds and checksum list, and publish the draft. Enable its mirror input when mainland storage is configured.

Signed iPollo releases set `DSH_DESKTOP_UPDATE_URL=https://github.com/Devin-AXIS/iPolloWork/releases/latest/download` and `DSH_DESKTOP_UPDATE_CHANNEL=stable`. The packaged updater must never point to the upstream DSH download service. Both Mac architectures share a feed containing their separate ZIP entries.

Design and Video are optional market installs. The suite carries their checked catalog archives for installation on demand. Their source repositories own their builds, and the desktop release does not attach separate plugin archives.

On macOS, run `node integrations/desktop/run.mjs prepare-cua-helper.ts` before packaging. It builds both official Computer Use helper architectures outside the pinned source tree and signs/notarizes them. Packaging rejects missing helpers. At launch, the desktop reuses SHA-256-verified SenseVoice models from the shared `~/.dsh` cache when its isolated cache has no file; existing desktop models remain unchanged.

Windows packaging requires .NET SDK 10 to compile the pinned Computer Use helper; its complete self-contained output is staged in the provider and unpacked beside the app. The release workflow installs the SDK.

## Account service configuration

Account defaults live in [Suite deployment.json](../../plugins/ipollowork-suite/deployment.json). Platform dotenv files and selected release presets accept `DSH_DESKTOP_ACCOUNT_ORIGIN`; `PACKAGE_ACCOUNT_ORIGIN` explicitly overrides it for a single build, including unsigned/Linux builds. The packaging subprocess embeds the selected origin into native application composition and Suite retains it at runtime. Account and updater configuration are independent. See the [configuration guide](../../docs/deployment-configuration.md) for precedence, server database files and the address inventory.
