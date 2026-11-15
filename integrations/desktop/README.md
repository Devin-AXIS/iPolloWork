# iPolloWork desktop

English | [中文](README.zh.md)

This package owns iPolloWork's Electron shell, email sign-in, branding and distribution. It launches the official DSH profile through [the desktop host](../desktop-host/README.md). The Agent loop, tools, sessions and credentials remain official DSH services. Product account, onboarding, sharing and mandatory-plugin behavior live in [the suite](../../plugins/ipollowork-suite/README.md).

Users see iPolloWork throughout: menus, the About panel, tray, dialogs, the application and tray icons (the black mark on a white tile), copyright, the link-protocol name and Windows shortcuts. While the Host starts, the shell serves DSH's boot page and Web document with iPolloWork's title, mark and name in place of DSH's wordmark. The packaged application, executable, helper processes and Windows installation folder are named iPolloWork (`iPolloWork.app`, `iPolloWork.exe`), so macOS also shows iPolloWork in the menu bar and Activity Monitor. Installer and update files keep the `deepseek-harness-<version>-<os>-<arch>` names that the pinned DSH publisher looks up.

DSH dependencies are built from the exact official source revision in [the runtime pin](../runtime/upstream.json), without changes under `packages/` or `apps/`. The npm release with the same version predates the source authentication API; do not mix its packages into the desktop. `Resources/dsh` contains ordinary physical Node dependencies, so DSH needs no product-specific module loader changes.

From the repository root, run `npm run setup:build`, then run `node integrations/desktop/run.mjs package-target.ts mac-arm64 --dir --unsigned`. Build output lives in `.desktop-build/`. The package uses the verified official dependency cache; it is not a separate npm installation target. Signed distribution additionally requires the platform signing configuration.

There is no old iPolloWork profile conversion or downgrade layer. Files and account credentials remain owned by the configured DSH home. The original DeepSeek Harness MIT license is retained in `LICENSE`; product changes are maintained here, independently from the official app tree.

## Product versions

The current product release is **iPolloWork 1.0** (`1.0.0` in installer metadata). Product and desktop manifests share this version; the bundled DSH runtime retains the version in `integrations/runtime/upstream.json`. Future patch releases use `1.0.1`, `1.0.2`, and so on; display labels may use `1.0.01`, `1.0.02`. Never put leading zeroes into installer metadata, because the updater requires semantic versions.
