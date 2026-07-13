# iPolloWork

> **Build with agents. Edit everything.**

**The next-generation, source-available alternative to Codex and Claude Code — built not only for coding, but for getting real work finished.**

iPolloWork turns AI agents into a complete visual workspace for code, office work, websites, presentations, design, and video. Describe the outcome, let the agent build it, then keep editing the result yourself: rewrite text in place, replace images, change colors and typography, move and resize elements, switch between desktop and mobile views, or refine video scenes on a timeline — as naturally as editing a slide in PowerPoint.

This is not another chat wrapper. iPolloWork brings conversation, files, browser, editable canvas, design tools, video studio, task history, permissions, Skills, plugins, and MCP into one local-first desktop experience.

## One agent workspace. Every kind of work.

- **Code** — understand repositories, plan changes, write code, run tools, and review the result with a full agent workflow.
- **Office** — research, draft documents, work with spreadsheets, and turn ideas into polished presentations instead of stopping at a text response.
- **Design** — generate websites, slides, and visual assets, then directly edit text, images, colors, typography, layout, and responsive states on the canvas.
- **Video** — create and refine visual scenes in an integrated studio with editable content and timeline controls.
- **Extensible agents** — connect any model and expand the workspace with Skills, plugins, MCP servers, and browser automation.
- **Local-first by default** — work directly with your files on macOS, Windows, or Linux; use the desktop app, browser UI, or headless server, and connect iPolloCloud only when you need team and commercial capabilities.

This source-available repository contains the Work client and its local runtime integration. Accounts, organization administration, hosted worker management, payments, and mobile Apps are separate iPolloCloud capabilities and are not required for local use.

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

See `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` for contribution, community, and security policies.

## License

iPolloWork uses the **iPolloWork Source Available License 1.0**:

- Free for personal, non-commercial, evaluation, and company-internal use.
- A commercial license is required for customer-facing SaaS or hosting, paid delivery or deployment, resale, white-label distribution, or use as a material part of an external commercial product or service.
- Separately licensed third-party components and code previously released under MIT retain their original licenses and existing rights.

See `LICENSE` for the controlling terms and `LICENSES/MIT-legacy.txt` for the historical MIT notice. This is a source-available license, not an OSI-approved open-source license.
