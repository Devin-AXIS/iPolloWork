# DSH 兼容记录

[English](compatibility.md) | 中文

DSH 基准由[运行时固定记录](upstream.json)指定。本次盘点基于 `dsh-v0.2.2-rc.3`（源码 `39163dd30f70`）、Jovan 的 `5104d080ba` 及 2026-11-16 工作区。以 `4c696c2b33` 拆分 DSH 源码的提交为历史分界。较早的迁移见[已有升级指南](../../docs/upgrade-guide)。

## 升级前复核的功能

| 功能与产品代码 | DSH 依赖 | 验证 |
| --- | --- | --- |
| [插件后台安装](../../plugins/ipollowork-suite/src/client/market-installation.ts)与[原生添加插件入口](../../plugins/ipollowork-suite/src/client/add-plugin.ts) | DSH Plugin Manager 的安装请求 ID、`plugin-manager/install-state`、`plugin-manager/changed`、连接重置、`shell.overlay`、`plugins.tab`。原生工具栏的 DOM 是额外依赖，涉及 `data-plugin-toolbar`、菜单角色和本地化标签。 | 分别从工具栏主按钮、下拉菜单和市场开始安装。关闭弹窗并切换页面，确认安装继续、重新打开可见进度、安装结束按钮自动刷新。上游提供可替换的安装入口后移除 DOM 拦截。 |
| [会话删除](../../plugins/ipollowork-suite/src/client/session-delete.tsx) | `session` 和 `sessionHeader` 菜单、`workspace/archiveSession` 操作权限、`archiveSession` 的 `stopActivity` 选项及工作区快照的归档 ID。会话仍可通过 DSH 的归档界面恢复。 | 用空闲和运行中的会话验证确认、从列表移除和恢复。无权限会话需隐藏操作。 |
| [对话错误提示](../../plugins/ipollowork-suite/src/client/chat-errors.tsx)、[官方模型选择](../../plugins/ipollowork-suite/src/host/service-models.ts)与[输出续写](../../plugins/ipollowork-suite/src/host/output-continuation.ts) | `conversation.chat.node` 的 `turn-error`、DSH 错误码和旧错误文本、`agent/pre-step`、LLM provider/adapter 注册、`session/event`、`agent/turn-stopping` 和 inbox 生命周期。 | 分别验证未选模型、适配器缺失、服务不可用和切换到自有密钥。失败后换到可用模型发新消息，应执行新任务。仅当前轮正常截断时续写，停止或结束本轮后清理待续写消息。 |
| [组织 MCP](../../plugins/ipollowork-suite/src/host/enterprise-mcp.ts)与[企业服务](../../services/ipollowork/src/enterprise-mcp.ts) | Host 的 `mcpManager.register` 返回清理函数，使用 `streamable-http` 和本地 Web 路由。组织项目删除和 MCP 列表管理走企业服务自己的 API。MCP 存储需要 PostgreSQL 迁移 `013`。 | 验证组织列表、授权成员工具发现、撤销和退出登录后的注销、无权限状态。空列表、旧服务缺路由和无权限应有独立状态。 |
| [品牌和 Windows 标题栏](../../plugins/ipollowork-suite/src/client/brand.css) | 使用套件 theme、原生 slot 及部分 DSH DOM 和 CSS token。工作区顶部的额外 Windows 标志通过移除 `body::before` 覆盖处理。 | 检查标题栏、折叠侧栏、全屏、浅色和暗色。品牌标志和原生窗口控制应各自正确显示。 |
| [登录、profile 和桌面集成](../desktop-host)、[官方启动器接入](../tooling/start.mjs) | `profile-boot`、`app-boot`、Connection 与认证导出，以及 DSH profile 配置和桌面桥接。源码构建和公开 npm 包需要分别核对导出，即使版本号一致。 | 在隔离 home 中启动真实 Electron，打开已有 profile 的测试副本，验证登录注册、模型和 agent 模式、工作区与会话、浏览器和文件操作。 |
| [插件组合](../../plugins/ipollowork-suite/cordis.patch.yml)、[Studio 市场](../../plugins/ipollowork-suite/catalog/index.json)与[桌面资源打包](../desktop/scripts/prepare-dsh.ts) | Cordis 插入项和依赖、原生插件加载器、DSH ASAR 布局、Host/CLI 启动入口和电脑操作资源路径。官网安装包和 Office 回退在产品打包层。 | 用各平台打包客户端验证启动、市场按需安装、打开已有 Design/Video 项目、Office 打开和电脑操作辅助程序。 |

## 更新和验证

1. 修改涉及 DSH 的功能时，同步更新本记录的中英文版本。记录产品入口、使用的 DSH 接口或选择器、验证方式，以及已验证的 DSH 版本。上游实现接替本地适配后，记录移除原因和首次验证的版本。
2. 在新工作树评估候选 DSH。同步更新固定记录、依赖清单和锁文件，使用候选版本自己的源码和产物。优先使用上游公开的扩展点与类型。可选能力通过宿主能力检测接入；遇到缺失的必要接口时，在采用新 pin 前完成适配和验证。
3. 在仓库根目录运行 `npm run setup:build`、`npm test`、`npm run check:upstream` 和 `npm run check:docs`。执行受影响套件的构建、类型检查和测试。插件 RPC 和会话归档类型由 DSH 提供，DOM、运行时事件和打包资源仍需实际验证。
4. 按[桌面验证说明](../desktop/tests/README.zh.md)用隔离 profile 跑上表受影响的流程，记录候选源码提交、平台、测试结果和未覆盖项。当前 pin 的测试通过只证明当前版本。

## 最近验证

2026-11-17，Windows Electron 开发版使用当前 pin 和已有登录会话，成功打开组织 MCP 列表及共享表单。迁移和授权回归使用隔离 PostgreSQL，覆盖从业务 schema `11` 升到 `13`、原组织与登录会话保留、管理员共享及撤销。桌面端共 19 项相关回归通过。真实第三方 MCP 的连接和调用需要配置服务后验证。
