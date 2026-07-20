# iPolloWork

<p align="center">
  <img src="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/main/apps/app/public/ipollowork-logo-square.svg" alt="iPolloWork" width="88">
</p>

<p align="center">
  English · <a href="./translated_readmes/README_ZH.md">简体中文</a> · <a href="./translated_readmes/README_ZH_hk.md">繁體中文</a> · <a href="./translated_readmes/README_JA.md">日本語</a>
</p>

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/Devin-AXIS/iPolloWork@b85fc51cf9f36ebf3bcbffad199905d07527bbf4/docs/assets/ipollowork-demo.mp4">
    <img src="https://cdn.jsdelivr.net/gh/Devin-AXIS/iPolloWork@7037c3b5/docs/assets/ipollowork-demo-poster.jpg" alt="Watch the iPolloWork demo" width="900">
  </a>
</p>

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/Devin-AXIS/iPolloWork@b85fc51cf9f36ebf3bcbffad199905d07527bbf4/docs/assets/ipollowork-demo.mp4">▶ Watch the iPolloWork demo</a>
</p>

> **An AI workbench that builds, runs, and keeps results editable.**

**The source-available, local-first alternative to Codex and Claude Code for work beyond the terminal.**

iPolloWork gives agents one workspace for repositories, local files, browser tasks, documents, presentations, websites, design, and video. Describe the outcome; the agent plans and executes; you inspect the work, approve actions, and keep editing the result in the same place.

Codex-style coding is only the starting point. When the output is a deck, web page, visual design, or video, iPolloWork keeps it editable instead of handing you a finished file or a chat transcript.

## What makes it different

- **Agent-first execution** — plan work, use tools, read and modify files, run commands, and continue from the current state.
- **Editable results** — move from code to documents, websites, presentations, design, and video; keep changing text, images, layout, and scenes after generation.
- **Local control** — run on your machine, bring your own model or provider, approve permissions, and extend the workspace with Skills, plugins, MCP servers, and browser automation.

## The short version

iPolloWork is for people who want a Codex-like agent with a visual, local-first workspace around it. It is not a chat-only wrapper and it does not require iPolloCloud for local use.

This source-available repository contains the Work client and its local runtime integration. Accounts, organization administration, hosted worker management, payments, and mobile Apps are separate iPolloCloud capabilities and are not required for local use.

## Install iPolloWork

### Download the desktop app

Official installers are published on [GitHub Releases](https://github.com/Devin-AXIS/iPolloWork/releases). If you prefer a manual download, choose the file that matches both your operating system and CPU:

| System | CPU | Installer to use |
| --- | --- | --- |
| macOS | Apple Silicon (M-series) | `ipollowork-mac-arm64-<version>.dmg` |
| macOS | Intel | `ipollowork-mac-x64-<version>.dmg` |
| Windows | Intel/AMD 64-bit | `ipollowork-win-x64-<version>.exe` |
| Windows | ARM64 | `ipollowork-win-arm64-<version>.exe` |
| Linux | Intel/AMD 64-bit | `ipollowork-linux-x64-<version>.AppImage` |
| Linux | ARM64 | `ipollowork-linux-arm64-<version>.AppImage` |

The macOS `.zip` and Linux `.tar.gz` files are portable/update artifacts; most users should choose `.dmg`, `.exe`, or `.AppImage`. If the Releases page does not yet contain an installer for your system, run or package the app from source below.

Installation after downloading:

- **macOS:** open the `.dmg`, then drag **iPolloWork** into Applications.
- **Windows:** run the `.exe` installer. A locally built, unsigned installer may trigger Microsoft Defender SmartScreen.
- **Linux:** make the AppImage executable with `chmod +x ipollowork-*.AppImage`, then run it. The `.tar.gz` package can be extracted and run without installation.

### Requirements for source development and packaging

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download) 22 or newer
- pnpm 11, enabled through Corepack with `corepack enable`
- [Bun](https://bun.sh/docs/installation) 1.3.10 or newer, used to build the local Orchestrator sidecar
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** and the Windows SDK; use PowerShell or Command Prompt
- Linux: a standard Electron build environment with a C/C++ toolchain, Python 3, `pkg-config`, and the desktop libraries required by Electron; the release build uses Ubuntu 22.04

OpenCode is downloaded and prepared as a separate sidecar during the first desktop build. iPolloWork does not fork or rewrite OpenCode, and OpenCode can continue to be upgraded independently.

## Start from source

### macOS and Linux

```bash
git clone https://github.com/Devin-AXIS/iPolloWork.git
cd iPolloWork
corepack enable
./ipollowork setup
./ipollowork dev
```

### Windows PowerShell

```powershell
git clone https://github.com/Devin-AXIS/iPolloWork.git
Set-Location iPolloWork
corepack enable
.\ipollowork.cmd setup
.\ipollowork.cmd dev
```

The setup command installs the locked workspace dependencies. The dev command prepares the OpenCode and Orchestrator sidecars, starts the UI, and opens the Electron desktop client. Development mode uses isolated iPolloWork/OpenCode state and does not overwrite the user's normal OpenCode configuration.

### Development commands

| Purpose | macOS / Linux | Windows |
| --- | --- | --- |
| Start desktop app | `./ipollowork dev` | `.\ipollowork.cmd dev` |
| Start browser UI only | `./ipollowork dev:ui` | `.\ipollowork.cmd dev:ui` |
| Connect local Cloud | `./ipollowork dev:cloud http://localhost:3100` | `.\ipollowork.cmd dev:cloud http://localhost:3100` |
| Type checks and desktop tests | `./ipollowork check` | `.\ipollowork.cmd check` |
| Production build | `./ipollowork build` | `.\ipollowork.cmd build` |

Windows development builds do not register the production `ipollowork://`
handler automatically. When testing Cloud sign-in through an external browser,
use the repository's protocol switcher and restore the production handler when
you finish. See [Windows protocol switching](docs/windows-protocol-switcher.md).

## Build and package

There are three different build levels:

| Command | Result |
| --- | --- |
| `build` | Compiles the production UI, server, Electron shell, and sidecars; does not create an installer |
| `package:dir` | Creates the fastest unpacked desktop app for local verification; does not change the release version |
| `package` | Runs checks, advances the client version, then creates native installer and portable/update artifacts for the current system and CPU without publishing them |

### macOS and Linux

```bash
./ipollowork check
./ipollowork package:dir
./ipollowork package
```

### Windows PowerShell

```powershell
.\ipollowork.cmd check
.\ipollowork.cmd package:dir
.\ipollowork.cmd package
```

All outputs are written to `apps/desktop/dist-electron/`:

`package` is the local release command. It keeps the App, Desktop, Orchestrator, and Server versions in sync, and uses the sequence `0.1.0` through `0.99.0`, then `1.0.0` (the source checkout starts at the unshipped baseline `0.0.0`). Use `./ipollowork package --dry-run` to inspect the next version, or `--skip-check` only when the checks have already passed. Local packaging never commits, tags, pushes, or publishes a release.

- **macOS:** `.dmg`, `.zip`, and an unpacked `.app`
- **Windows:** NSIS `.exe` and `win-unpacked/`
- **Linux:** `.AppImage`, `.tar.gz`, and `linux-unpacked/`

Local packaging targets the machine's current operating system and CPU architecture. Use the GitHub release workflow to produce the complete signed/notarized matrix for macOS ARM64/x64, Windows ARM64/x64, and Linux ARM64/x64. Local packages are unsigned unless the appropriate Apple or Windows signing credentials are supplied; they are suitable for development testing but should not be presented as official releases.

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

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` for contribution, community, and security policies.

## License

iPolloWork uses the **iPolloWork Source Available License 1.0**:

- Free only for individual personal self-use and for small internal use by fewer than three total users.
- Prior written authorization is required for any use by three or more users, regardless of whether the use is personal, internal, commercial, non-commercial, individual, or organizational.
- Prior written authorization is required for any sale, resale, paid service, SaaS, hosting, white-label distribution, marketplace use, or customer-facing use, regardless of whether it is done by an individual or a company.
- The iPolloWork name, logo, and product attribution must remain visible in user-facing frontend displays unless prior written authorization expressly permits different branding.
- Separately licensed third-party components and code previously released under MIT retain their original licenses and existing rights.

See `LICENSE` for the controlling terms and `LICENSES/MIT-legacy.txt` for the historical MIT notice. This is a source-available license, not an OSI-approved open-source license.
