# Two delivery channels

## iPolloWork desktop

The website distributes a branded desktop installer. Run `npm run setup:build`, then `npm run package:desktop:mac:arm64 -- --unsigned --dir` for a local macOS build. The desktop bundles the same `@ipollo/dsh-suite` package and the pinned official DSH runtime. Operating-system identity, the native login window and update packaging belong to this client.

The selected `@ipollo/desktop-host` application bundle mounts the shared suite modules through the official Include plugin. DSH protects the application bundle from disabling and removal; its nested application entries are not editable through the ordinary plugin switches. The public suite bundle is not selected separately in this client. This is application configuration, not protection against editing local files.

## Plugin for a DSH host

Run `npm run package:plugin` to produce `dist/ipollo-dsh-suite-<version>.tgz` and `dist/plugin-release.json`. Install the tarball through the official client's Plugins page or `dsh plugin --profile <profile> add file:/absolute/path/to/ipollo-dsh-suite-<version>.tgz`. Restart the profile after a package update. Hosted Web installations install the bundle on their DSH server; a browser-only page cannot install Host plugins.

The plugin supplies iPolloWork branding inside the application, account and enterprise entry points, curated marketplace, agents, IM and service connections. The host's OS name/icon and native welcome screen remain host-owned. Version 0.1.25 is verified against the official 0.2.2-rc.3 desktop release and the pinned source build. It uses the host's existing authentication: the release's built-in verifier or the source build's scoped authentication provider.

The public plugin displays as **iPolloWork** and remains disableable and removable through the host's official plugin manager. Disabling it retracts its UI and tools without deleting saved project data.

Both channels use the same account service and plugin sources. Downloading the official dependency for development does not put its source into Git or copy the complete source repository into an installer. Changing a delivery channel does not create another Agent engine.
