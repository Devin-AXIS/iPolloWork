# iPolloWork desktop

English | [中文](README.zh.md)

This package owns iPolloWork's Electron shell, email sign-in, branding and distribution. It launches the official DSH profile through [the desktop host](../desktop-host/README.md). The Agent loop, tools, sessions and credentials remain official DSH services. Product account, onboarding, sharing and mandatory-plugin behavior live in [the suite](../../plugins/ipollowork-suite/README.md).

Users see iPolloWork throughout: menus, the About panel, tray, dialogs, the application and tray icons (the black mark on a white tile), copyright, the link-protocol name and Windows shortcuts. While the Host starts, the shell serves DSH's boot page and Web document with iPolloWork's title, mark and name in place of DSH's wordmark. The packaged application, executable, helper processes and Windows installation folder are named iPolloWork (`iPollo.app`, `iPollo.exe`), so macOS also shows iPolloWork in the menu bar and Activity Monitor. Installer and update files keep the `iPollo-<version>-<os>-<arch>` names that the pinned DSH publisher looks up.

DSH dependencies are built from the exact official source revision in [the runtime pin](../runtime/upstream.json), without changes under `packages/` or `apps/`. The npm release with the same version predates the source authentication API; do not mix its packages into the desktop. The official ASAR layout keeps JavaScript and assets under `app.asar/dsh`; only native executables and resources that require physical files are unpacked. The CLI, Host and runtime smoke use that same layout.

From the repository root, run `npm run setup:build`, then run `node integrations/desktop/run.mjs package-target.ts mac-arm64 --dir --unsigned`. Build output lives in `.desktop-build/`. The package uses the verified official dependency cache; it is not a separate npm installation target. Signed distribution additionally requires the platform signing configuration.

There is no old iPolloWork profile conversion or downgrade layer. Files and account credentials remain owned by the configured DSH home. The original DeepSeek Harness MIT license is retained in `LICENSE`; product changes are maintained here, independently from the official app tree.

## Product versions

The current product release is **iPollo 1.0.1** (`1.0.1` in installer metadata). Product and desktop manifests share this version; the bundled DSH runtime retains the version in `integrations/runtime/upstream.json`. Future patch releases use `1.0.1`, `1.0.2`, and so on; display labels may use `1.0.01`, `1.0.02`. Never put leading zeroes into installer metadata, because the updater requires semantic versions.

Unsigned Windows x64 builds run on GitHub-hosted Windows through `.github/workflows/ipollo-release-packages.yml`. The workflow validates the packaged runtime before attaching the installer to an existing release.

Signed iPollo releases set `DSH_DESKTOP_UPDATE_URL=https://github.com/Devin-AXIS/iPolloWork/releases/latest/download` and `DSH_DESKTOP_UPDATE_CHANNEL=stable`. The packaged updater must never point to the upstream DSH download service. Both Mac architectures share a feed containing their separate ZIP entries.

Design and Video are optional market installs. Desktop packages only the suite and the official runtime closure; it excludes Studio packages, their archive dependencies and bundled installer archives. The dedicated desktop market downloads the pinned Studio releases from GitHub only when the user installs them.
