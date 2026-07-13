# Windows development setup notes

This document records the issues observed while starting iPolloWork from source on Windows, the verified workarounds, and the items that may still need maintainer attention.

## Verified environment

- Windows 11
- Node.js 24.16.0 (the project requires Node.js 22 or newer)
- pnpm 11.x
- Bun 1.3.10
- Git for Windows 2.55.0

The Electron development client, local server, OpenCode sidecar, workspaces, sessions, and MCP endpoints started successfully after the Windows-specific setup below.

## Recommended Windows setup and startup

Use the repository's Windows wrapper instead of running the root `pnpm dev` script directly:

```powershell
git clone --branch Lunette --single-branch https://github.com/Devin-AXIS/iPolloWork.git
Set-Location iPolloWork
corepack enable
.\ipollowork.cmd setup
.\ipollowork.cmd dev
```

The wrapper delegates to `scripts/ipollowork.mjs`, which sets development environment variables in a cross-platform way.

## Observed issues

### 1. Running `pnpm dev` directly fails on Windows

Observed error:

```text
'IPOLLOWORK_DEV_MODE' is not recognized as an internal or external command
```

Cause: the root `dev` script uses POSIX inline environment-variable syntax:

```text
IPOLLOWORK_DEV_MODE=1 ... pnpm --filter @ipollowork/desktop dev
```

Windows `cmd.exe` does not support that syntax.

Current supported solution:

```powershell
.\ipollowork.cmd dev
```

Maintainer consideration: either keep documenting the `.cmd` wrapper as the only supported Windows entry point, or make the root `pnpm dev` script itself cross-platform to reduce accidental misuse.

### 2. Bun is required for desktop development

Without Bun, desktop startup fails while building the local server and plugins:

```text
'bun' is not recognized as an internal or external command
```

The current README now correctly lists Bun 1.3.10 or newer as a source-development requirement. After installing Bun 1.3.10, the build step completed successfully.

### 3. PowerShell may block `npm.ps1`

On machines with a restrictive PowerShell execution policy, this command may fail:

```powershell
npm install --global bun@1.3.10
```

PowerShell can resolve `npm` to `npm.ps1` and reject the script. A non-invasive workaround is to invoke the Windows command shim explicitly:

```powershell
npm.cmd install --global bun@1.3.10
```

This avoids changing the machine's PowerShell execution policy.

### 4. A newly installed Bun command may not appear immediately

After a global installation, the current terminal may not yet resolve `bun`. Open a new terminal and verify:

```powershell
bun --version
```

If necessary, confirm that the npm global binary directory is present in `PATH`. On a standard per-user npm installation, it is commonly:

```text
%APPDATA%\npm
```

### 5. Development startup may log a Windows release HTTP 404

The development client started successfully but logged an architecture/download lookup error:

```text
[architecture] failed to resolve latest download URL Error: HTTP 404
```

This did not prevent the Electron client, local API, sessions, MCP, or OpenCode from running. The README currently states that the repository does not have a public release, so the missing download may be expected. Maintainers may want to suppress this lookup when no public release exists, or return a clearer informational message instead of an error stack.

### 6. Missing `desktop-bootstrap.json` falls back to defaults

A first development launch may log an `ENOENT` warning for `desktop-bootstrap.json`, followed by:

```text
[desktop-bootstrap] falling back to defaults
```

This is non-blocking for local development. The file is relevant when a deployment needs custom Cloud, organization, or branding bootstrap configuration.

### 7. Computer Use is skipped on Windows by design

Windows startup reports:

```json
{
  "ok": true,
  "skipped": true,
  "reason": "computer-use-helper-is-macos-only"
}
```

This is expected. The native Computer Use helper, macOS Accessibility and Screen Recording permissions, and composer `@App` integration are currently macOS-only.

## Expected platform differences

Even with the same commit, macOS and Windows will not have identical desktop chrome or feature availability:

- macOS uses native inset title-bar and vibrancy options.
- Native menus and keyboard shortcut labels differ (`Command` versus `Control`).
- Finder and Explorer actions use platform-specific labels and implementations.
- Computer Use and the rolling alpha update channel are currently macOS-only.

The shared React workspace, sessions, settings, MCP, skills, plugins, and ordinary agent UI should otherwise remain broadly consistent when both machines use the same commit, startup mode, account, Cloud endpoint, and local configuration.

## Maintainer follow-up summary

1. Decide whether root `pnpm dev` should become cross-platform or remain explicitly unsupported on Windows in favor of `ipollowork.cmd`.
2. Consider handling the missing public Windows release lookup without an error stack during development.
3. Keep Bun and the Windows wrapper prominent in source-development documentation.
