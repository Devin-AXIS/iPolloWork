# iPolloWork

iPolloWork 是一个源码可用、本地优先的 AI 智能体桌面工作区，支持 macOS、Windows 和 Linux。它可以直接处理本地文件，并将 OpenCode 保持为可独立升级的运行时。

## Work 版本包含什么

- 本地与远程智能体会话
- Design 和 Video 工作区
- Skills、插件和 MCP 集成
- 流式任务、权限、计划和产物
- 桌面端、浏览器 UI 和无界面 Server 模式
- 可选连接自建或官方 iPolloCloud

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
