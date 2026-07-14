# iPolloWork

<p align="center">
  <a href="../README.md">English</a> · 简体中文 · <a href="./README_ZH_hk.md">繁體中文</a> · <a href="./README_JA.md">日本語</a>
</p>

> **让智能体创造，让每一个结果都能继续编辑。**

**Codex 与 Claude Code 的下一代源码开放平替——不只帮你写代码，更直接完成真正的工作。**

iPolloWork 把 AI 智能体变成一个完整的可视化工作区：代码、办公、网站、幻灯片、设计和视频，都能在同一个任务里完成。你只需要描述目标，让智能体先生成，再亲手继续修改——原位改文字、换图片、调颜色和字体、拖动和缩放元素、切换电脑与手机预览，或者在时间线上调整视频画面，像修改 PowerPoint 一样直观。

它不是又一个套着对话框的 AI 工具。iPolloWork 把对话、文件、浏览器、可编辑画布、设计工具、视频工作室、任务记录、权限、Skills、插件和 MCP 真正整合进一个本地优先的桌面工作空间。

## 一个智能体工作区，完成所有类型的工作

- **Code** — 理解代码仓库、规划修改、编写代码、调用工具并检查结果，拥有完整的智能体开发流程。
- **办公** — 调研、撰写文档、处理表格并制作精美幻灯片，不再停留在一段文字回答。
- **设计** — 生成网站、幻灯片和视觉内容，再在画布上直接修改文字、图片、颜色、字体、布局和响应式效果。
- **视频** — 在内置 Studio 中生成和调整视觉画面，直接编辑内容并使用时间线完成剪辑。
- **自由扩展** — 接入不同模型，通过 Skills、插件、MCP 和浏览器自动化扩展智能体能力。
- **本地优先** — 支持 macOS、Windows 和 Linux，直接处理本地文件；可使用桌面端、浏览器 UI 或无界面 Server，需要团队与商业能力时再连接 iPolloCloud。

源码可用仓库只包含 Work 客户端及本地运行能力。账号、组织管理、托管 Worker、支付、管理后台和移动 App 属于独立的 iPolloCloud，不影响 Work 单独使用。

## 安装 iPolloWork

### 下载桌面安装包

正式安装包发布后会出现在 [GitHub Releases](https://github.com/Devin-AXIS/iPolloWork/releases)。当前仓库还没有公开 Release，因此现在请使用下方的源码安装方式。未来下载安装包时，必须同时根据操作系统和 CPU 选择文件：

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
| `package:dir` | 生成免安装目录，速度最快，适合本地验证 |
| `package` | 为当前系统和当前 CPU 生成原生安装包及便携/更新文件 |

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

- 个人、非商业、评估测试和公司内部使用免费。
- 对外提供 SaaS/托管服务、收费交付或部署、转售、白标，或作为对外商业产品的重要组成部分时，必须获得商业授权。
- 第三方代码和历史上已经按 MIT 发布的部分继续保留原许可证和既有权利。

完整条款见 [`LICENSE`](../LICENSE)。该协议属于源码可用协议，不是 OSI 认可的开源协议。完整工程结构和贡献方式请查看[英文主文档](../README.md)。
