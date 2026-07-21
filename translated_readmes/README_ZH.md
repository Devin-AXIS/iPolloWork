# iPolloWork

<p align="center">
  <a href="../README.md">English</a> · 简体中文 · <a href="./README_ZH_hk.md">繁體中文</a> · <a href="./README_JA.md">日本語</a>
</p>

**一个本地优先的可视化 AI 工作台：从一个目标出发，直接产出可继续编辑的代码、文档、演示稿、网站、设计和视频，也是 Codex 与 Claude Code 的源码可用替代方案。**

https://github.com/user-attachments/assets/201b561a-22ec-4c8e-a4e8-f34172cf0aa3

iPolloWork 让 AI 智能体在一个工作空间里处理代码仓库、本地文件、浏览器任务、文档、演示稿、网站、设计和视频。你描述目标，智能体负责规划和执行；你可以检查过程、批准操作，并在同一个地方继续编辑结果。

Codex 式编码只是起点。当结果变成演示稿、网页、视觉设计或视频时，iPolloWork 仍然让它保持可编辑，而不是只交付一个成品文件或一段聊天记录。

## 它真正解决的三件事

- **智能体执行** — 规划工作、调用工具、读写文件、运行命令，并从当前状态继续推进。
- **结果可编辑** — 从代码延伸到文档、网站、演示稿、设计和视频；生成之后，文字、图片、布局和画面仍能继续修改。
- **本地可控** — 在自己的设备上运行，接入自己的模型或服务商，逐项批准权限，并通过 Skills、插件、MCP 服务和浏览器自动化扩展能力。

## 一句话理解

iPolloWork 是一个围绕 Codex 式智能体构建的可视化、本地优先工作空间。它不是只会聊天的包装层，本地使用也不要求 iPolloCloud 账号。

源码可用仓库只包含 Work 客户端及本地运行能力。账号、组织管理、托管 Worker、支付、管理后台和移动 App 属于独立的 iPolloCloud，不影响 Work 单独使用。

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
iPolloWork 桌面/UI ──> iPolloWork Server ──> OpenCode
        │
        └── 可选账号与控制请求 ──> iPolloCloud
```

- 智能体执行和流式数据保持在 Work/Worker 路径。
- Cloud 负责账号、组织、权益、托管 Worker 生命周期、管理后台和商业 App。
- 不连接 Cloud 时，iPolloWork 仍可完整本地运行。
- iPolloWork 不修改 OpenCode，OpenCode 可以继续独立升级。

## 使用许可

- 仅个人自己使用免费；少于 3 名总用户的小规模内部使用免费。
- 3 名及以上用户的任何形式使用，不管个人、企业、内部、外部、商业或非商业，都必须先获得书面授权。
- 任何售卖、转售、收费服务、SaaS、托管、白标、市场分发或面向客户的使用，不管由个人还是企业提供，都必须先获得书面授权。
- 前台用户界面中必须保留 iPolloWork 名称、Logo 和产品归属展示，除非书面授权明确允许更换品牌。
- 第三方代码和历史上已经按 MIT 发布的部分继续保留原许可证和既有权利。

完整条款见 [`LICENSE`](../LICENSE)。该协议属于源码可用协议，不是 OSI 认可的开源协议。完整工程结构和贡献方式请查看[英文主文档](../README.md)。
