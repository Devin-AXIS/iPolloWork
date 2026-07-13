# iPolloWork

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

## 从源码启动

要求 Node.js 22+ 和 pnpm 11。

```bash
git clone https://github.com/Devin-AXIS/iPolloWork.git
cd iPolloWork
corepack enable
./ipollowork setup
./ipollowork dev
```

常用命令：

```bash
./ipollowork dev:ui       # 只启动浏览器 UI
./ipollowork check        # 类型检查和桌面端测试
./ipollowork build        # 生产构建
./ipollowork package      # 生成当前系统的安装包
./ipollowork package:dir  # 生成免安装目录
```

安装包输出到 `apps/desktop/dist-electron/`。Windows 也可以使用对应的 `pnpm setup`、`pnpm dev`、`pnpm package` 命令。

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
