# iPolloWork

<p align="center">
  English · <a href="./docs/translations/README_ZH.md">简体中文</a> · <a href="./docs/translations/README_ZH_hk.md">繁體中文</a> · <a href="./docs/translations/README_JA.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/Devin-AXIS/iPolloWork/releases/latest"><img src="https://img.shields.io/github/v/release/Devin-AXIS/iPolloWork?display_name=tag&amp;sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/Devin-AXIS/iPolloWork/releases"><img src="https://img.shields.io/github/downloads/Devin-AXIS/iPolloWork/total" alt="GitHub downloads" /></a>
  <a href="https://github.com/Devin-AXIS/iPolloWork/stargazers"><img src="https://img.shields.io/github/stars/Devin-AXIS/iPolloWork?style=flat" alt="GitHub stars" /></a>
  <a href="https://x.com/iPolloWork"><img src="https://img.shields.io/badge/X%20Global-%40iPolloWork%20%C2%B7%207.9K%20followers-000000?logo=x&amp;logoColor=white" alt="Follow iPolloWork on X" /></a>
  <a href="https://x.com/iPolloCN"><img src="https://img.shields.io/badge/X%20%E4%B8%AD%E6%96%87-%40iPolloCN%20%C2%B7%203.4K%20followers-000000?logo=x&amp;logoColor=white" alt="Follow iPolloCN on X" /></a>
  <a href="https://www.bestpractices.dev/projects/14127"><img src="https://www.bestpractices.dev/projects/14127/badge" alt="OpenSSF Best Practices" /></a>
  <a href="https://www.cloudflare.com/startups/"><img src="https://img.shields.io/badge/Cloudflare-for%20Startups-F38020?logo=cloudflare&amp;logoColor=white" alt="Cloudflare for Startups" /></a>
  <a href="https://github.com/opea-project"><img src="https://img.shields.io/badge/OPEA-Open%20Platform%20for%20Enterprise%20AI-ff7a00" alt="OPEA: Open Platform for Enterprise AI" /></a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/88012?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-88012"><img src="https://trendshift.io/api/badge/trendshift/repositories/88012/daily?language=TypeScript" alt="#22 TypeScript Repository Of The Day | Trendshift" width="250" height="55" /></a>
  <a href="https://trendshift.io/repositories/88012?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-88012"><img src="https://trendshift.io/api/badge/trendshift/repositories/88012/weekly?language=TypeScript" alt="#24 TypeScript Repository Of The Week | Trendshift" width="250" height="55" /></a>
</p>

**The enterprise-grade, local-first Agent Workbench for people and agent teams—one workspace for multiple agent engines, one unified system for plugins and Skills, multi-agent projects and tasks, and editable creation across code, documents, presentations, websites, design, and video.**

https://github.com/user-attachments/assets/201b561a-22ec-4c8e-a4e8-f34172cf0aa3

iPolloWork is the unified workspace layer for the next agent-native way of working. It does not split projects or extensions by runtime: teams coordinate agents, tasks, schedules, plugins, Skills, tools, execution, and editable outputs from one control surface. Describe the outcome; agents plan and execute; your team reviews progress, approves actions, and keeps editing the result in the same place.

iPolloWork is not positioned as a replacement for a single coding agent. It connects [Codex](https://github.com/openai/codex), [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), OpenCode, and future agent runtimes through explicit compatibility boundaries while preserving the native strengths of each ecosystem. Coding is only the starting point: when the output is a deck, web page, visual design, or video, it remains editable instead of becoming a finished file or a chat transcript.

<div align="center">
  <h3>Join the official iPolloWork WeChat community</h3>
  <p>Scan with WeChat to join the official group for product updates and community discussions.</p>
  <img src="./docs/assets/ipollowork-official-wechat-group.jpg" alt="QR code for the official iPolloWork WeChat community" width="220" />
</div>

## What makes it different

- **One workbench across agent engines** — use Codex, DeepSeek Harness, OpenCode, and future runtimes without rebuilding the project experience around each engine.
- **One global extension system** — install, enable, update, and uninstall portable plugins, Skills, agents, commands, services, and authorization once; optional engine-native bindings stay behind the same lifecycle.
- **Project-native human-agent collaboration** — give people and agents one shared project view for responsibilities, tasks, schedules, execution health, and results instead of scattering work across isolated chats.
- **One editable production loop** — move from code to documents, websites, presentations, design, and video while keeping text, images, layouts, timelines, and scenes editable after generation.
- **Local and enterprise control** — run locally, bring your own model or provider, review permissions and execution, and connect organization services only when a team needs them.

## Agent runtime compatibility

OpenCode is the default local execution runtime today. [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) is integrated as an optional peer runtime and subagent delegation target, while [Codex](https://github.com/openai/codex) connects through the [`ipollowork-ui-mcp`](https://www.npmjs.com/package/ipollowork-ui-mcp) control surface. MCP is the integration protocol for that path, not another agent engine alongside Codex, DSH, and OpenCode. These paths share the workbench without pretending that every runtime has the same native capabilities.

The collaboration model keeps iPolloWork as the project workspace: a task can delegate bounded work to DSH subagents when useful, then bring structured progress and results back into the same project. Each runtime retains its own agents, Skills, plugins, and execution model.

### Run iPolloWork creative plugins directly in DeepSeek Harness

DeepSeek Harness users can install iPolloWork's native Design, PPT, and Video views into the DSH Web UI and start them from any project directory:

<p>
  <a href="https://www.npmjs.com/package/deepseek-idesign"><img src="https://img.shields.io/npm/v/deepseek-idesign?label=DeepSeek%20Design&amp;logo=npm&amp;color=CB3837" alt="deepseek-idesign npm version" /></a>
  <a href="https://www.npmjs.com/package/deepseek-ivideo"><img src="https://img.shields.io/npm/v/deepseek-ivideo?label=DeepSeek%20Video&amp;logo=npm&amp;color=CB3837" alt="deepseek-ivideo npm version" /></a>
</p>

```bash
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign deepseek-ippt deepseek-ivideo
npx @deepseek-ai/dsh web
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080), start a conversation, and choose **Design**, **PPT**, or **Video**. If the `dsh` command is already installed, replace `npx @deepseek-ai/dsh` with `dsh`. DeepSeek Harness is currently a developer preview, so plugin compatibility follows its active release line.

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
Codex / MCP clients ── ipollowork-ui-mcp ──> iPolloWork desktop/UI
                                                   │
                                                   ├── local API ──> Engine Protocol ──> OpenCode (default)
                                                   │                               └──> DeepSeek Harness (optional)
                                                   └── optional account/control requests ──> iPolloCloud
```

- Agent execution, task state, and streaming are normalized at the shared engine boundary while engine-native behavior remains inside its adapter.
- Portable Skills, plugins, MCP servers, and project capabilities use one lifecycle; engine-specific enhancements stay optional.
- Codex compatibility currently uses the MCP control surface rather than claiming a native Codex engine adapter.
- iPolloCloud handles identity, organizations, entitlements, hosted worker lifecycle, administration, and commercial Apps.
- The Cloud connection is optional. Local iPolloWork works without an account or commercial service.
- OpenCode and DeepSeek Harness remain independent components and can continue to evolve without turning iPolloWork into a fork of either runtime.

## Repository layout

- `apps/app` — shared React user interface
- `apps/desktop` — Electron desktop shell and packaging
- `apps/server` — iPolloWork server API
- `apps/orchestrator` — headless runtime orchestration
- `packages` — shared types, components, docs, and integrations
- `docs` — maintained engineering notes, platform guides, and generated reports
- `evals` — executable product flows and validation tooling
- `examples` — complete example plugin packages
- `external-plugins` — independently released plugins for external agent hosts
- `packaging` — release and installer metadata
- `scripts` — development, build, audit, and release automation
- `specs` — product and architecture specifications
- `vendor` — pinned third-party source that is built as part of iPolloWork

## Contributing

Read `AGENTS.md`, `docs/governance.md`, `CONTRIBUTING.md`, `SECURITY.md`, and
`apps/app/src/react-app/ARCHITECTURE.md` before making product changes. Run
the narrow relevant test first, followed by:

```bash
./ipollowork check
git diff --check
```

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` for contribution, community, and security policies.

## Star History

<p align="center">
  <a href="https://www.star-history.com/?repos=Devin-AXIS%2FiPolloWork&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-light.svg" />
      <img alt="iPolloWork Star History" src="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-light.svg" width="900" />
    </picture>
  </a>
</p>

## License

iPolloWork uses the **iPolloWork Source Available License 1.0**:

- Free only for individual personal self-use and for small internal use by fewer than three total users.
- Prior written authorization is required for any use by three or more users, regardless of whether the use is personal, internal, commercial, non-commercial, individual, or organizational.
- Prior written authorization is required for any sale, resale, paid service, SaaS, hosting, white-label distribution, marketplace use, or customer-facing use, regardless of whether it is done by an individual or a company.
- The iPolloWork name, logo, and product attribution must remain visible in user-facing frontend displays unless prior written authorization expressly permits different branding.
- Separately licensed third-party components and code previously released under MIT retain their original licenses and existing rights.

See `LICENSE` for the controlling terms and `LICENSES/MIT.txt` for the historical MIT notice. This is a source-available license, not an OSI-approved open-source license.
