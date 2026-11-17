# DSH 兼容记录

[English](compatibility.md) | 中文

DSH 基准由[运行时固定记录](upstream.json)指定。本次盘点基于 `dsh-v0.2.2-rc.3`（源码 `39163dd30f70`）、Jovan 的 `5104d080ba` 及 2026-11-16 工作区。以 `4c696c2b33` 拆分 DSH 源码的提交为历史分界。较早的迁移见[已有升级指南](../../docs/upgrade-guide)。

## 升级前复核的功能

| 功能与产品代码 | DSH 依赖 | 验证 |
| --- | --- | --- |
| [插件后台安装](../../plugins/ipollowork-suite/src/client/market-installation.ts)与[原生添加插件入口](../../plugins/ipollowork-suite/src/client/add-plugin.ts) | DSH Plugin Manager 的安装请求 ID、`plugin-manager/install-state`、`plugin-manager/changed`、连接重置、`shell.overlay`、`plugins.tab`。原生工具栏的 DOM 是额外依赖，涉及 `data-plugin-toolbar`、菜单角色和本地化标签。 | 分别从工具栏主按钮、下拉菜单和市场开始安装。关闭弹窗并切换页面，确认安装继续、重新打开可见进度、安装结束按钮自动刷新。上游提供可替换的安装入口后移除 DOM 拦截。 |
| [会话删除](../../plugins/ipollowork-suite/src/client/session-delete.tsx) | `session` 和 `sessionHeader` 菜单、`workspace/archiveSession` 操作权限、`archiveSession` 的 `stopActivity` 选项及工作区快照的归档 ID。会话仍可通过 DSH 的归档界面恢复。 | 用空闲和运行中的会话验证确认、从列表移除和恢复。无权限会话需隐藏操作。 |
| [对话错误提示](../../plugins/ipollowork-suite/src/client/chat-errors.tsx)、[官方模型选择](../../plugins/ipollowork-suite/src/host/service-models.ts)与[输出续写](../../plugins/ipollowork-suite/src/host/output-continuation.ts) | `conversation.chat.node` 的 `turn-error`、DSH 错误码和旧错误文本、`agent/pre-step`、LLM provider/adapter 注册、`session/event`、`agent/turn-stopping` 和 inbox 生命周期。 | 分别验证未选模型、适配器缺失、服务不可用和切换到自有密钥。失败后换到可用模型发新消息，应执行新任务。仅当前轮正常截断时续写，停止或结束本轮后清理待续写消息。 |
| [组织 MCP](../../plugins/ipollowork-suite/src/host/enterprise-mcp.ts)与[企业服务](../../services/ipollowork/src/enterprise-mcp.ts) | Host 的 `mcpManager.register` 返回清理函数，使用 `streamable-http` 和本地 Web 路由。组织项目删除和 MCP 列表管理走企业服务自己的 API。PostgreSQL 迁移 `014` 兼容先前独立部署的 MCP 版 `013` 和主分支的组织通知版 `013`。 | 验证组织列表、授权成员工具发现、撤销和退出登录后的注销、无权限状态。空列表、旧服务缺路由和无权限应有独立状态。 |
| [品牌和 Windows 标题栏](../../plugins/ipollowork-suite/src/client/brand.css) | 使用套件 theme、原生 slot 及部分 DSH DOM 和 CSS token。工作区顶部的额外 Windows 标志通过移除 `body::before` 覆盖处理。 | 检查标题栏、折叠侧栏、全屏、浅色和暗色。品牌标志和原生窗口控制应各自正确显示。 |
| [macOS 窗口拖拽](../../plugins/ipollowork-suite/src/client/suite.module.css) | DSH `dsh-v0.2.2-rc.3` 用 `data-global-panel` 标记主内容列，用 `data-window-drag` 标记原生拖拽栏，用 `data-shortcut-modal="settings"` 标记挂在页面根节点外的设置面板。套件按 `--dsh-frame-top-clearance` 设置顶部拖拽区，保留原生窗口控件。 | 在 macOS Electron 中从首页、会话、插件、组织空间、数据、机器人和设置顶部拖动窗口。收起侧栏和缩窄窗口后重试，检查滚动、按钮、弹窗和全屏。 |
| [登录、profile 和桌面集成](../desktop-host)、[官方启动器接入](../tooling/start.mjs) | `profile-boot`、`app-boot`、Connection 与认证导出，以及 DSH profile 配置和桌面桥接。源码构建和公开 npm 包需要分别核对导出，即使版本号一致。 | 在隔离 home 中启动真实 Electron，打开已有 profile 的测试副本，验证登录注册、模型和 agent 模式、工作区与会话、浏览器和文件操作。 |
| [通用设置版本行](../../plugins/ipollowork-suite/src/client/desktop-version.tsx)与[桌面 preload](../desktop/src/preload-app.ts) | DSH `dsh-v0.2.2-rc.3` 提供 `settings.general.item` 插槽、`current-version` 条目和 `general.currentVersion` 翻译。产品用 Electron 包版本覆盖该条目。 | 使用版本号与 DSH 固定版本不同的安装包，核对通用设置和关于界面。检查浏览器仍显示 DSH 版本，使用旧 preload 的桌面客户端仍能通过 IPC 取得版本。 |
| [发行打包](../../.github/workflows/ipollo-release-packages.yml)与[公开更新清单](../tooling/release-publication.mjs) | 打包入口执行 DSH `build:official` 并校验固定版本构建记录。DSH 打包文件名用于本地处理。公开的 Windows 安装包和 blockmap 使用同一文件名主干。 | 仅安装依赖后从干净检出开始打包。发布草稿前检查打包运行时、两个 macOS 更新 ZIP、Windows 安装包和 blockmap，以及四种官网安装包。 |
| [插件组合](../../plugins/ipollowork-suite/cordis.patch.yml)、[Studio 市场](../../plugins/ipollowork-suite/catalog/index.json)与[桌面资源打包](../desktop/scripts/prepare-dsh.ts) | Cordis 插入项和依赖、原生插件加载器、DSH ASAR 布局、Host/CLI 启动入口和电脑操作资源路径。官网安装包和 Office 回退在产品打包层。 | 用各平台打包客户端验证启动、市场按需安装、打开已有 Design/Video 项目、Office 打开和电脑操作辅助程序。 |
| [Design 模板生成和结果打开](https://github.com/Devin-AXIS/deepseek-design) | 基于 `dsh-v0.2.2-rc.3`，Design 使用会话范围的 `resources.source`、`uiWorkspace.openSession`、右侧栏文件关联、`conversation.chat.turnTail`、原生 `present` 工具和交付卡片。 | 套用模板并给出与示例主题明显不同的提示词。保存期间切换会话，再返回检查预览。点击对话结果中的文件，核对是否在同一个工作区打开最终 HTML。用原生幻灯片重复，并核对页数。 |
| [桌面更新频道](../desktop/src/update-channel.ts) | iPolloWork 正式发布源提供稳定版更新清单。桌面预加载对该来源省略可选的 `dshDesktop.updates.channels` 接口，DSH 通用设置不会显示开发版频道选项。 | 用保存过开发版偏好的设置启动正式安装包，确认它使用稳定版且仍可手动检查更新。换用其他更新源，确认频道选择仍可用。 |
| [Stage 桌面插件](../../plugins/stage) | `main`、`sidebar.panellist`、`plugins.bundle.config`、Host 连接准入、`workspaceRegistry`、`tools` 和 `sandboxPolicy`。桌面组合包含 Stage Bundle。 | 验证手动打开、关联与解除关联、每个工作区授权及只读限制。换账号后重新授权工作区。 |

Design `1.0.0-beta.31` 已在固定的 DSH 版本上通过 Windows 隔离测试。客户端从 Design 的 8 类模板各选一个，由测试模型保存，再从对话文件卡片打开。另测了关闭预览期间保存新版，再从同一张卡片打开。

## 更新和验证

1. 修改涉及 DSH 的功能时，同步更新本记录的中英文版本。记录产品入口、使用的 DSH 接口或选择器、验证方式，以及已验证的 DSH 版本。上游实现接替本地适配后，记录移除原因和首次验证的版本。
2. 在新工作树评估候选 DSH。同步更新固定记录、依赖清单和锁文件，使用候选版本自己的源码和产物。优先使用上游公开的扩展点与类型。可选能力通过宿主能力检测接入；遇到缺失的必要接口时，在采用新 pin 前完成适配和验证。
3. 在仓库根目录运行 `npm run setup:build`、`npm test`、`npm run check:upstream` 和 `npm run check:docs`。执行受影响套件的构建、类型检查和测试。插件 RPC 和会话归档类型由 DSH 提供，DOM、运行时事件和打包资源仍需实际验证。
4. 按[桌面验证说明](../desktop/tests/README.zh.md)用隔离 profile 跑上表受影响的流程，记录候选源码提交、平台、测试结果和未覆盖项。当前 pin 的测试通过只证明当前版本。

## 最近验证

2026-11-17，Windows Electron 开发版使用当前 pin 和已有登录会话，成功打开组织 MCP 列表及共享表单。迁移和授权回归使用隔离 PostgreSQL，覆盖从业务 schema `11` 升到 `13`、原组织与登录会话保留、管理员共享及撤销。桌面端共 19 项相关回归通过。真实第三方 MCP 的连接和调用需要配置服务后验证。
