# iPolloOS organization connector for DSH

English | [中文](README.zh.md)

A native DeepSeek Harness plugin for joining an existing organization hosted by iPolloOS or iPollo Enterprise Server. Company administrators create organizations in OS; employees join through this plugin using the organization URL, join code, and their iPollo Account.

The plugin adds **加入组织 / Join organization** to the native sidebar. It verifies the organization address, signs in through the explicitly displayed account provider, binds the returned organization membership, and shows the member directory and departments with pagination. The account-provider URL is configurable for private deployments; its default is `https://i.ipollo.ai`. Public organization HTTP endpoints are rejected; private-network HTTP endpoints and HTTPS reverse-proxy prefixes are supported. An administrator-supplied legacy HTTP account provider requires explicit confirmation of unencrypted sign-in. The plugin never downgrades a failed HTTPS request automatically.

Organization credentials are kept on the Host through DSH's native credential-record service. Account passwords, account login tokens, and identity tokens are not persisted. Browser responses contain connection metadata only. Expired organization credentials require sign-in again; member status and role changes are checked against the organization before protected operations. **Disconnect this device** removes this plugin's saved connection and leaves organization membership and existing sessions intact.

**Start a session in the organization workspace** creates or reuses a normal local DSH workspace for this organization and member. It does not upload sessions, provide remote execution, or grant colleagues access to native conversation logs. The existing local organization-management prototype, other plugins, DSH settings, and original upstream source files are independent of this package.

## Install

This is a standalone plugin package, not a replacement DSH build. Install a copy at a persistent path outside temporary development worktrees:

```sh
dsh plugin --profile desktop add link:/absolute/path/to/ipollo-organization
```

Enable `@ipollo/dsh-organization-connector` in the profile's `dsh.profile.bundles` if the package manager has not enabled it. Native profile recomposition loads the Host and browser faces through `cordis.patch.yml` and the package's `dsh.client` manifest. No upstream DSH file needs editing. Use the existing browser/profile lifecycle to recompose the profile after installation.

In OS, copy the active organization URL and join code from the organization's member-management settings. In DSH, open **加入组织**, paste that information or enter the fields separately, verify the organization, and sign in with the account provider configured for that organization. The organization endpoint must already be reachable from the employee's device; the desktop-control address and administrator/SSH credentials are not organization connection information.

When a custom sidebar is active, open **Plugins → Installed → Join organization** and use **Open organization connection** to reach the same native panel.

## Verification

```sh
pnpm check
IPOLLO_OS_SOURCE=/absolute/path/to/iPolloOS pnpm check
```

The second command requires OS's `pnpm bundle:organization` output. It exercises the real packaged OS organization handlers, PGlite migrations, signed identity verification, joining an invited member, directories, persisted connector state, live role changes, and suspended-member rejection. Only the test account provider and native credential-provider fixture are substituted; no user account or existing organization data is used.

Set `DSH_NATIVE_PROOF_HOME` to an isolated running DSH profile's home to additionally verify the actual plugin HTTP route, native credential provider, owner-cookie authentication, and native workspace creation. Its `server.log` must contain the authenticated launch URL printed by `dsh --profile organization-join --port 0 --no-open`. This path is for disposable test data, not the user's DSH home.
