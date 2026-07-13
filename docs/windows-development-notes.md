# Windows development and packaging notes

This document describes the supported Windows source workflow for iPolloWork,
including development startup, production builds, native packaging, expected
platform differences, and known non-blocking warnings.

Last reviewed: 2026-07-14

## Current support status

| Area | Status | Notes |
| --- | --- | --- |
| Electron development client | Supported | Start through `ipollowork.cmd`; the shared React UI, local server, OpenCode, workspaces, sessions, and MCP endpoints have been exercised on Windows 11. |
| Production build | Supported | `ipollowork.cmd build` compiles the UI, embedded server, Electron shell, and executable sidecars. |
| Unpacked desktop application | Supported | `ipollowork.cmd package:dir` creates `win-unpacked/` for the current Windows architecture. |
| NSIS installer | Supported | `ipollowork.cmd package` creates an `.exe` installer; locally produced installers are unsigned unless Windows signing is configured. |
| Windows x64 and ARM64 sidecars | Covered | The packaging hook has regression coverage for both Windows target triples. |
| Computer Use | Not available | The native helper and composer `@App` integration are currently macOS-only. |
| Rolling alpha updater | Not available | The rolling alpha channel is currently macOS-only. |

## Requirements

Install these tools before running setup or packaging:

| Tool | Supported version | Why it is needed |
| --- | --- | --- |
| Windows | Windows 11 | Current verified desktop environment. |
| Git for Windows | Current stable | Clones the repository and supplies the normal Git workflow. |
| Node.js | 22 or newer | Runs workspace scripts, Electron tooling, and the embedded server build. Node.js 24 is used in CI. |
| pnpm | 11.x | Installs and runs the locked monorepo workspace. Enable it through Corepack. |
| Bun | 1.3.10 or newer | Compiles the native Orchestrator executable for Windows x64 or ARM64. |
| Visual Studio 2022 Build Tools | Current stable | Install **Desktop development with C++** and a Windows SDK for native Node/Electron dependencies. |
| PowerShell or Command Prompt | Current Windows version | Runs the Windows wrapper and packaging commands. |

The first build may also need network access to GitHub Releases so the pinned
OpenCode executable can be downloaded. iPolloWork prepares OpenCode as a
separate sidecar and does not fork or rewrite it.

### Verified Windows environment

The source development flow was exercised with:

- Windows 11
- Node.js 24.16.0
- pnpm 11.x
- Bun 1.3.10
- Git for Windows 2.55.0

In that environment, the Electron development client, embedded server,
OpenCode sidecar, workspaces, sessions, and MCP endpoints started successfully.
The packaging hook is additionally covered for both Windows target triples by
the automated regression tests described below.

## Clean setup

Clone the current default branch. The older `--branch Lunette` command was only
used while validating a pull request and must not be used for normal setup.

```powershell
git clone https://github.com/Devin-AXIS/iPolloWork.git
Set-Location iPolloWork
corepack enable
node --version
pnpm --version
bun --version
.\ipollowork.cmd setup
```

Expected minimum versions:

```text
Node.js 22+
pnpm 11.x
Bun 1.3.10+
```

If `bun` is not installed and PowerShell blocks `npm.ps1`, use the Windows
command shim without changing the machine execution policy:

```powershell
npm.cmd install --global bun@1.3.10
```

Open a new terminal after installing Bun if the current terminal does not see
the updated `PATH`. A standard per-user npm binary directory is commonly:

```text
%APPDATA%\npm
```

## Supported commands

Use the repository wrapper on Windows. It delegates to
`scripts/ipollowork.mjs`, selects `pnpm.cmd`, and sets development environment
variables without POSIX shell syntax.

| Command | Result |
| --- | --- |
| `.\ipollowork.cmd setup` | Installs locked workspace dependencies. |
| `.\ipollowork.cmd dev` | Prepares native sidecars, starts Vite and the local server, and opens Electron. |
| `.\ipollowork.cmd dev:ui` | Starts only the browser UI. |
| `.\ipollowork.cmd dev:cloud http://localhost:3100` | Starts an isolated desktop profile connected to iPolloCloud. |
| `.\ipollowork.cmd check` | Runs App type checking, Electron type checking, and desktop tests. |
| `.\ipollowork.cmd build` | Builds production assets without creating an installer. |
| `.\ipollowork.cmd package:dir` | Creates the fastest unpacked Windows application for local validation. |
| `.\ipollowork.cmd package` | Creates the Windows NSIS installer. |

Do not use the root `pnpm dev` command directly from Windows `cmd.exe`. That
script still contains POSIX inline environment-variable syntax and can fail
before Electron starts.

## Development startup

```powershell
.\ipollowork.cmd dev
```

A healthy startup prepares the OpenCode and Orchestrator executables, builds
the embedded iPolloWork server, starts Vite, and launches Electron. Development
mode uses isolated iPolloWork/OpenCode state and does not overwrite the normal
user configuration.

After startup, verify:

1. The Electron window opens without a fatal startup screen.
2. A local workspace can be created or opened.
3. A session can be created and a message can be sent.
4. The local server and MCP endpoints initialize.
5. Settings and workspace state survive an application restart.

## Build and package

Run the checks first, then create an unpacked application before producing the
installer:

```powershell
.\ipollowork.cmd check
.\ipollowork.cmd package:dir
.\ipollowork.cmd package
```

All Electron outputs are written to:

```text
apps\desktop\dist-electron\
```

Expected Windows outputs include:

```text
apps\desktop\dist-electron\win-unpacked\
apps\desktop\dist-electron\ipollowork-win-x64-<version>.exe
```

An ARM64 Windows machine produces the corresponding `win-arm64` installer
name. Local packaging targets the current operating system and CPU. Use the
GitHub release workflow when a complete release matrix or signed artifacts are
required.

For repository-level validation, manually run the **Build Electron Desktop**
GitHub Actions workflow. Its matrix builds unpacked artifacts on Windows x64
and Windows ARM64 runners in addition to macOS and Linux. A native Windows
runner or that workflow should be used for final `.exe` installer validation;
do not treat a package created for another operating system as Windows proof.

### Packaging flow

The Windows packaging path performs these steps:

1. Download or reuse the pinned OpenCode executable for the current target.
2. Compile the Orchestrator executable with Bun for Windows x64 or ARM64.
3. Build the embedded server and React application.
4. Copy the Electron main process, preload, renderer, docs, plugins, and native dependencies.
5. Normalize the two executable sidecars to canonical runtime names.
6. Produce `win-unpacked/` or the NSIS `.exe` installer.

The packaged application intentionally contains executable sidecars only for:

- `opencode.exe`
- `ipollowork-orchestrator.exe`

It also keeps the architecture-specific copies and `versions.json` metadata.
For Windows x64, the sidecar directory contains this contract:

```text
opencode.exe
opencode-x86_64-pc-windows-msvc.exe
ipollowork-orchestrator.exe
ipollowork-orchestrator-x86_64-pc-windows-msvc.exe
versions.json
versions.json-x86_64-pc-windows-msvc.exe
```

Windows ARM64 uses the same layout with the
`aarch64-pc-windows-msvc.exe` suffix.

There is no `ipollowork-server.exe`: the server now runs in-process inside
Electron. There is also no `chrome-devtools-mcp.exe`: Chrome DevTools support
is provided through the OpenCode plugin/runtime integration rather than a
packaged executable.

## Resolved packaging issue: obsolete sidecar requirements

Before commit `9a78a681`, the Electron `afterPack` hook still required
architecture-specific executables for `ipollowork-server` and
`chrome-devtools-mcp`. Neither executable was produced by the current build,
so Electron Builder could stop with an error similar to:

```text
Missing packaged sidecar for target: ipollowork-server-x86_64-pc-windows-msvc.exe
```

The hook now normalizes only the native executables that the build actually
creates: OpenCode and Orchestrator. Regression tests exercise this contract for
both Windows x64 and Windows ARM64, intentionally omitting the obsolete files.

Relevant implementation and regression coverage:

- `apps/desktop/scripts/electron-after-pack.cjs`
- `apps/desktop/scripts/prepare-sidecar.mjs`
- `apps/desktop/electron/sidecar-packaging.test.mjs`

If an older checkout still reports the missing `ipollowork-server` sidecar,
update `main`, remove only the generated package output, and package again:

```powershell
git pull --ff-only origin main
Remove-Item -Recurse -Force apps\desktop\dist-electron -ErrorAction SilentlyContinue
.\ipollowork.cmd package:dir
```

## Troubleshooting

### `'IPOLLOWORK_DEV_MODE' is not recognized`

Cause: `pnpm dev` was run directly and Windows attempted to interpret POSIX
inline environment-variable syntax.

Use:

```powershell
.\ipollowork.cmd dev
```

### `'bun' is not recognized`

Cause: Bun is missing or the current terminal has not reloaded `PATH`.

Verify in a new terminal:

```powershell
bun --version
```

Bun is a blocking requirement for development, build, and package commands
because it compiles the Orchestrator executable.

### PowerShell blocks `npm.ps1`

Use the Windows command shim:

```powershell
npm.cmd install --global bun@1.3.10
```

This does not require changing the system PowerShell execution policy.

### OpenCode download or extraction fails

The first build downloads the version pinned in `constants.json`. Confirm that
the machine can access GitHub Releases and that a corporate proxy or antivirus
is not blocking the archive or extracted executable. Retry the wrapper command
after connectivity is restored.

### Development startup logs a release HTTP 404

```text
[architecture] failed to resolve latest download URL Error: HTTP 404
```

This lookup checks for a public installer matching the machine architecture.
It is currently non-blocking when the Electron window, local server, sessions,
MCP, and OpenCode start successfully. It should not be treated as a package
failure.

### `desktop-bootstrap.json` is missing

```text
[desktop-bootstrap] falling back to defaults
```

This is expected on a first local launch. The file is needed only when a
deployment supplies custom Cloud, organization, or branding bootstrap values.

### Computer Use is skipped

```json
{
  "ok": true,
  "skipped": true,
  "reason": "computer-use-helper-is-macos-only"
}
```

This is expected on Windows and does not block normal sessions, MCP, skills,
plugins, or packaging.

### Microsoft Defender SmartScreen warns about the installer

A locally built installer is unsigned unless Windows signing credentials are
configured. SmartScreen may therefore warn when the `.exe` is opened. Use an
official signed release for distribution; use unsigned builds only for local
development and controlled testing.

## Expected platform differences

Even at the same commit, macOS and Windows do not have identical native chrome
or feature availability:

- macOS uses native inset title-bar and vibrancy options.
- Native menus and shortcut labels differ (`Command` versus `Control`).
- Finder and Explorer actions use platform-specific labels and implementations.
- Computer Use and the rolling alpha update channel are currently macOS-only.

The shared React workspace, sessions, settings, MCP, skills, plugins, and
ordinary agent UI should otherwise remain consistent when both machines use
the same commit, startup mode, account, Cloud endpoint, and local configuration.

## Maintainer follow-up

1. Decide whether the root `pnpm dev` script should become cross-platform or remain unsupported on Windows in favor of `ipollowork.cmd`.
2. Replace the non-blocking missing-release HTTP 404 stack with a clearer development message when no public Windows installer exists.
3. Keep Bun 1.3.10+, Visual Studio Build Tools, the Windows wrapper, and the sidecar packaging contract visible in source-development documentation.
4. Keep Windows x64 and ARM64 packaging checks in CI so the executable sidecar contract cannot regress.
