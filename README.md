# iPolloWork

iPolloWork is an open-source, local-first desktop workspace for AI agents. It runs on macOS, Windows, and Linux, works directly with your files, and keeps OpenCode as an independently upgradeable runtime.

## What is included

- Local and remote agent sessions
- Design and video workspaces
- Skills, plugins, and MCP integrations
- Streaming tasks, permissions, plans, and artifacts
- Desktop, browser UI, and headless server modes
- Optional connection to an iPolloCloud deployment

The open-source repository contains the Work client and its local runtime integration. Accounts, organization administration, hosted worker management, payments, and mobile Apps are separate iPolloCloud capabilities and are not required for local use.

## Requirements

- Node.js 22 or newer
- pnpm 11 (`corepack enable`)
- Platform build tools: Xcode Command Line Tools on macOS, Visual Studio Build Tools on Windows, or the standard Electron build toolchain on Linux

OpenCode is prepared by the desktop build and remains a separate upstream dependency. iPolloWork does not fork or rewrite OpenCode.

## Start from source

```bash
git clone https://github.com/Devin-AXIS/iPolloWork.git
cd iPolloWork
./ipollowork setup
./ipollowork dev
```

Windows users can run the same commands through pnpm:

```powershell
corepack enable
pnpm setup
pnpm dev
```

Useful development commands:

```bash
./ipollowork dev:ui       # browser UI only
./ipollowork check        # type checks and desktop tests
./ipollowork build        # production application build
```

Development mode uses isolated iPolloWork/OpenCode state and does not overwrite the user's normal OpenCode configuration.

## Build and package

```bash
./ipollowork build
./ipollowork package
```

Native installers are written to `apps/desktop/dist-electron/`. For a faster unpacked application build:

```bash
./ipollowork package:dir
```

The package command uses Electron Builder and creates the native targets configured for the current operating system.

## Connect to iPolloCloud

Start your local iPolloCloud control plane first, then run:

```bash
./ipollowork dev:cloud http://localhost:3100
```

This command creates an isolated development profile, points authentication and Cloud APIs at the supplied URL, and requires Cloud sign-in. It does not change the normal local iPolloWork profile. A remote or self-hosted Cloud URL works the same way:

```bash
./ipollowork dev:cloud https://cloud.example.com
```

## Architecture boundary

```text
iPolloWork desktop/UI ── local API ──> iPolloWork server ──> OpenCode
          │
          └── optional account/control requests ──> iPolloCloud
```

- Agent execution and streaming stay on the Work/Worker path.
- iPolloCloud handles identity, organizations, entitlements, hosted worker lifecycle, administration, and commercial Apps.
- The Cloud connection is optional. Local iPolloWork works without an account or commercial service.
- OpenCode remains its own component and can continue to be upgraded independently.

## Repository layout

- `apps/app` — shared React user interface
- `apps/desktop` — Electron desktop shell and packaging
- `apps/server` — iPolloWork server API
- `apps/orchestrator` — headless runtime orchestration
- `packages` — shared types, components, docs, and integrations

## Contributing

Read `AGENTS.md`, `VISION.md`, `PRINCIPLES.md`, `PRODUCT.md`, and `ARCHITECTURE.md` before making product changes. Run the narrow relevant test first, followed by:

```bash
./ipollowork check
git diff --check
```

See `CODE_OF_CONDUCT.md` and `SECURITY.md` for community and security policies.

## License

iPolloWork is licensed under the MIT License. See `LICENSE`.
