# iPolloWork

<p align="center">
  <a href="../../README.md">English</a> · 简体中文 · <a href="./README_ZH_hk.md">繁體中文</a> · <a href="./README_JA.md">日本語</a>
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

**面向人与智能体团队的企业级、本地优先 Agent Workbench：在一个工作空间内统一多引擎、统一插件与 Skills，管理多智能体项目和任务，并持续编辑代码、文档、演示稿、网站、设计和视频。**

https://github.com/user-attachments/assets/201b561a-22ec-4c8e-a4e8-f34172cf0aa3

iPolloWork 是面向下一代 Agent 原生工作方式的统一工作台层。它不会按运行时割裂项目和扩展，而是把智能体、任务、日程、插件、Skills、工具、执行过程和可编辑成果放进同一个控制界面。你描述目标，智能体负责规划和执行；团队可以检查进度、批准操作，并在同一个地方继续编辑结果。

iPolloWork 不再把自己定义成某一个编程智能体的“平替”。它通过明确的兼容边界连接 [Codex](https://github.com/openai/codex)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、OpenCode 和未来智能体运行时，同时保留各个生态自身的原生优势。编程只是起点：当结果变成演示稿、网页、视觉设计或视频时，它仍然可以继续编辑，而不是只留下一个成品文件或一段聊天记录。

<div align="center">
  <h3>加入 iPolloWork 官方微信群</h3>
  <p>使用微信扫描下方二维码，加入官方社区，获取产品动态并交流使用经验。</p>
  <img src="../assets/ipollowork-official-wechat-group.jpg" alt="iPolloWork 官方微信群二维码" width="220" />
</div>

## 它真正解决的核心问题

- **多引擎，一个工作台** — 兼容 Codex、DeepSeek Harness、OpenCode 和未来运行时，不需要围绕每个引擎重新搭建项目体验。
- **统一的全局扩展系统** — 插件、Skills、智能体、命令、服务和授权只需安装、启用、更新或卸载一次；可选的引擎原生绑定仍归同一生命周期管理。
- **项目原生的人机协作** — 人与智能体围绕同一个项目查看职责、任务、日程、执行健康和成果，不再把工作拆散在彼此孤立的对话里。
- **一体化可编辑生产** — 从代码延伸到文档、网站、演示稿、设计和视频；生成之后，文字、图片、布局、时间线和画面仍能继续修改。
- **本地与企业可控** — 可以完全在本地运行、自选模型或服务商、逐项审核权限和执行；团队真正需要时再连接组织服务。

## 智能体运行时兼容

OpenCode 是目前默认的本地执行运行时。[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 已作为可选同级运行时和子代理委派目标接入；[Codex](https://github.com/openai/codex) 则通过 [`ipollowork-ui-mcp`](https://www.npmjs.com/package/ipollowork-ui-mcp) 控制界面接入。MCP 是这条接入路径使用的协议，不是与 Codex、DSH、OpenCode 并列的另一个智能体引擎。它们共享同一个工作台，但不会假装所有运行时都拥有完全相同的原生能力。

协作方式保持简单：iPolloWork 是项目工作台；需要时，一个任务可以把边界明确的工作交给 DSH 子代理，再把结构化进度和结果带回同一个项目。各运行时继续保留自己的智能体、Skills、插件和执行机制。

### 在 DeepSeek Harness 中直接启动 iPolloWork 创作插件

DeepSeek Harness 用户可以把 iPolloWork 的 Design、PPT 和 Video 原生视图安装到 DSH Web 界面，并从任意项目目录启动：

<p>
  <a href="https://www.npmjs.com/package/deepseek-idesign"><img src="https://img.shields.io/npm/v/deepseek-idesign?label=DeepSeek%20Design&amp;logo=npm&amp;color=CB3837" alt="deepseek-idesign npm 版本" /></a>
  <a href="https://www.npmjs.com/package/deepseek-ivideo"><img src="https://img.shields.io/npm/v/deepseek-ivideo?label=DeepSeek%20Video&amp;logo=npm&amp;color=CB3837" alt="deepseek-ivideo npm 版本" /></a>
</p>

```bash
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign deepseek-ippt deepseek-ivideo
npx @deepseek-ai/dsh web
```

打开 [http://127.0.0.1:3080](http://127.0.0.1:3080)，新建对话后选择 **Design**、**PPT** 或 **Video**。如果已经安装 `dsh` 命令，可以把 `npx @deepseek-ai/dsh` 直接替换成 `dsh`。DeepSeek Harness 目前仍处于开发者预览阶段，插件兼容性会跟随其活跃版本线。

## 安装 iPolloWork

### 下载桌面应用

正式安装包发布在 [GitHub Releases](https://github.com/Devin-AXIS/iPolloWork/releases)。如果希望手动下载，请同时根据操作系统和 CPU 选择文件：

| 系统 | CPU | 选择的安装包 |
| --- | --- | --- |
| macOS | Apple 芯片（M 系列） | `ipollowork-mac-arm64-<version>.dmg` |
| macOS | Intel | `ipollowork-mac-x64-<version>.dmg` |
| Windows | Intel/AMD 64 位 | `ipollowork-win-x64-<version>.exe` |
| Windows | ARM64 | `ipollowork-win-arm64-<version>.exe` |
| Linux | Intel/AMD 64 位 | `ipollowork-linux-x64-<version>.AppImage` |
| Linux | ARM64 | `ipollowork-linux-arm64-<version>.AppImage` |

macOS 的 `.zip` 和 Linux 的 `.tar.gz` 主要用于便携运行或更新；普通用户优先选择 `.dmg`、`.exe` 或 `.AppImage`。如果 Releases 暂时没有对应安装包，请按下方步骤从源码运行或自行打包。

- **macOS：**打开 `.dmg`，把 **iPolloWork** 拖入“应用程序”。
- **Windows：**运行 `.exe`。本地自行构建且未签名的安装包可能触发 Microsoft Defender SmartScreen。
- **Linux：**先运行 `chmod +x ipollowork-*.AppImage`，再打开 AppImage；也可以解压 `.tar.gz` 后直接运行。

### 源码开发和打包要求

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download) 22 或更高版本
- pnpm 11，运行 `corepack enable` 启用
- [Bun](https://bun.sh/docs/installation) 1.3.10 或更高版本，用于构建本地 Orchestrator sidecar
- macOS：Xcode Command Line Tools（运行 `xcode-select --install`）
- Windows：[Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，安装 **Desktop development with C++** 和 Windows SDK；使用 PowerShell 或命令提示符
- Linux：标准 Electron 构建环境，包括 C/C++ 工具链、Python 3、`pkg-config` 和 Electron 所需桌面库；正式发布使用 Ubuntu 22.04

桌面端第一次构建时会下载并准备独立的 OpenCode sidecar。iPolloWork 不会 fork 或修改 OpenCode，OpenCode 可以继续独立升级。

## 从源码启动

### macOS 和 Linux

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

`setup` 会安装锁定版本的依赖；`dev` 会准备 OpenCode 和 Orchestrator sidecar、启动 UI 并打开 Electron 客户端。开发模式使用隔离的 iPolloWork/OpenCode 数据，不会覆盖用户平时使用的 OpenCode 配置。

### 常用开发命令

| 用途 | macOS / Linux | Windows |
| --- | --- | --- |
| 启动桌面客户端 | `./ipollowork dev` | `.\ipollowork.cmd dev` |
| 只启动浏览器 UI | `./ipollowork dev:ui` | `.\ipollowork.cmd dev:ui` |
| 连接本地 Cloud | `./ipollowork dev:cloud http://localhost:3100` | `.\ipollowork.cmd dev:cloud http://localhost:3100` |
| 类型检查和桌面测试 | `./ipollowork check` | `.\ipollowork.cmd check` |
| 生产构建 | `./ipollowork build` | `.\ipollowork.cmd build` |

## 构建和打包

三个命令的作用不同：

| 命令 | 产物 |
| --- | --- |
| `build` | 编译生产 UI、Server、Electron 和 sidecar，但不生成安装包 |
| `package:dir` | 生成免安装目录，速度最快，适合本地验证；不会修改正式版本号 |
| `package` | 先执行检查、递增客户端版本号，再为当前系统和当前 CPU 生成原生安装包及便携/更新文件；不会发布 |

### macOS 和 Linux

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

所有产物输出到 `apps/desktop/dist-electron/`：

`package` 是本地正式打包命令。它会同步 App、Desktop、Orchestrator 和 Server 的版本，并按 `0.1.0` 到 `0.99.0`、再到 `1.0.0` 的顺序递增（源码开发基线为未发行的 `0.0.0`）。可使用 `./ipollowork package --dry-run` 查看下一个版本；仅在检查已经通过时才使用 `--skip-check`。本地打包不会自动提交、打 tag、推送或发布。

- **macOS：**`.dmg`、`.zip` 和免安装 `.app`
- **Windows：**NSIS `.exe` 和 `win-unpacked/`
- **Linux：**`.AppImage`、`.tar.gz` 和 `linux-unpacked/`

本地打包默认只针对当前操作系统和当前 CPU 架构。完整发布应使用 GitHub Release 工作流，分别生成 macOS ARM64/x64、Windows ARM64/x64 和 Linux ARM64/x64，并完成相应签名或公证。本地没有提供 Apple/Windows 签名凭据时产物不会签名，只适合开发测试，不应作为正式发行版。

## 连接 iPolloCloud

先启动本地 iPolloCloud，然后运行：

```bash
./ipollowork dev:cloud http://localhost:3100
```

该命令会使用隔离的开发配置连接 Cloud 登录和控制接口，不会覆盖用户正常的本地 iPolloWork/OpenCode 配置。远程或自建 Cloud 只需替换 URL。

## 架构边界

```text
Codex / MCP 客户端 ── ipollowork-ui-mcp ──> iPolloWork 桌面/UI
                                                 │
                                                 ├── 本地 API ──> Engine Protocol ──> OpenCode（默认）
                                                 │                                  └──> DeepSeek Harness（可选）
                                                 └── 可选账号与控制请求 ──> iPolloCloud
```

- 智能体执行、任务状态和流式数据在统一引擎边界规范化，引擎原生行为仍留在各自适配器中。
- 可移植的 Skills、插件、MCP 服务和项目能力使用同一生命周期，引擎专属增强保持可选。
- Codex 当前通过 MCP 控制界面兼容接入，不会被误写成已经存在的 Codex 原生引擎适配器。
- Cloud 负责账号、组织、权益、托管 Worker 生命周期、管理后台和商业 App。
- 不连接 Cloud 时，iPolloWork 仍可完整本地运行。
- iPolloWork 不会 fork OpenCode 或 DeepSeek Harness，两者都可以继续独立演进。

## Star 增长趋势

<p align="center">
  <a href="https://www.star-history.com/?repos=Devin-AXIS%2FiPolloWork&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-light.svg" />
      <img alt="iPolloWork Star 增长趋势" src="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-light.svg" width="900" />
    </picture>
  </a>
</p>

## 使用许可

- 仅个人自己使用免费；少于 3 名总用户的小规模内部使用免费。
- 3 名及以上用户的任何形式使用，不管个人、企业、内部、外部、商业或非商业，都必须先获得书面授权。
- 任何售卖、转售、收费服务、SaaS、托管、白标、市场分发或面向客户的使用，不管由个人还是企业提供，都必须先获得书面授权。
- 前台用户界面中必须保留 iPolloWork 名称、Logo 和产品归属展示，除非书面授权明确允许更换品牌。
- 第三方代码和历史上已经按 MIT 发布的部分继续保留原许可证和既有权利。

完整条款见 [`LICENSE`](../../LICENSE)。该协议属于源码可用协议，不是 OSI 认可的开源协议。完整工程结构和贡献方式请查看[英文主文档](../../README.md)。
