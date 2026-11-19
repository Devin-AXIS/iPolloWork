# DSH 兼容记录

[English](compatibility.md) | 中文

DSH 基准由[运行时固定记录](upstream.json)指定。本次盘点基于 `dsh-v0.2.2-rc.3`（源码 `39163dd30f70`）、Jovan 的 `5104d080ba` 及 2026-11-16 工作区。以 `4c696c2b33` 拆分 DSH 源码的提交为历史分界。较早的迁移见[已有升级指南](../../docs/upgrade-guide)。

## 升级前复核的功能

Suite `0.1.39` 携带 Design `1.0.0-beta.36`，使用原生 `ctx.skills.register`、`ctx.tools.register`、必需的 `systemPrompt.context`、工作区归属和沙箱策略处理模板生成。随包的 `ipollowork-design` Skill 和带 revision 的 `design_edit_text` 只替换文字，保留其余 HTML。模板清单作为有界来源数据处理；文档切换与工具写入共用插件生命周期队列。原编辑器在像素属性控件展示前解析 CSS 单位和主题变量，浮动元素操作直接打开“元素”页。企业 VI 模板保留默认几何并接入主题变量，固定原生幻灯片隐藏无效的全局几何控件；PDF 后台导出有计时兜底。升级时复测 Skill 发现/加载、必需模型上下文、过期版本/只读/跨工作区拒绝、HTML 卡片与链接、本地媒体、元素属性、主题持久化、38 页可编辑 PPTX/PDF、明暗主题和 390px。详见[验收记录](../../docs/design-template-fidelity-2026-11-19.md)。Agent 和 DSH 源码保持不变。

新增 [MCP 连接入口](../../plugins/ipollowork-suite/src/host/mcp-connections.ts) 使用原生 `mcpManager.list/restart`，并在 web-app 的 `mcp-manager` 命名空间中通过带 revision 的 `settings.mutate` 修改单个服务器的 `enabled` 字段或移除仅用户层存在的条目，保留同级配置和凭据引用。继承配置与插件注册条目不可删除，编辑仍打开原生配置文件。组织 MCP 的断开选择通过原生凭据提供方仅保存在本机，按已验证账号身份和服务来源隔离。没有历史选择时仍只请求授权目录；读取已保存选择时每个账号代次增加一次身份查询，不依赖积分接口。升级时复测工具撤回、连接、刷新和重启保持状态、切换账号、版本冲突、保存失败、删除确认及明暗主题和窄设置页，确认原生配置编辑和插件生命周期仍正常；不修改 DSH 源码。

| 功能与产品代码 | DSH 依赖 | 验证 |
| --- | --- | --- |
| [插件后台安装](../../plugins/ipollowork-suite/src/client/market-installation.ts)与[原生添加插件入口](../../plugins/ipollowork-suite/src/client/add-plugin.ts) | DSH Plugin Manager 的安装请求 ID、`plugin-manager/install-state`、`plugin-manager/changed`、连接重置、`shell.overlay`、`plugins.tab`。原生工具栏的 DOM 是额外依赖，涉及 `data-plugin-toolbar`、菜单角色和本地化标签。 | 分别从工具栏主按钮、下拉菜单和市场开始安装。关闭弹窗并切换页面，确认安装继续、重新打开可见进度、安装结束按钮自动刷新。上游提供可替换的安装入口后移除 DOM 拦截。 |
| 原生会话归档与工作区移除 | 会话菜单、归档确认、已归档筛选、取消归档和工作区移除均由 DSH 负责。产品回收站、额外删除入口、移除工作区后的归档监听和归档文件 IPC 已在 `dsh-v0.2.2-rc.3` 上移除。已有归档数据继续由 DSH 管理。 | 确认侧栏没有产品回收站，会话菜单没有额外删除入口。通过 DSH 归档和取消归档，再移除可丢弃的测试工作区，核对原生行为。 |
| [组织资源共享](../../services/ipollowork/src/organization-publications.ts) | Work 保存审核过的插件包名和固定版本，DSH 插件管理器负责检查、确认及安装。已发布且授权的 Skill 进入 DSH 技能注册表。成员打开组织或资源页时刷新授权，Host 也在后台定期刷新。 | 成员保持登录时发布版本。打开资源页，在新会话用原生斜杠菜单选择 Skill。验证撤回授权会移除对应 Skill，插件由原生管理器检查且初始禁用。 |
| [Windows 开发版热更新](../desktop/scripts/start-local-hot.ps1) | 启动器构建已链接的 Work 套件，分别由 DSH 的 `hmr` 和 `client-hmr` 接管重载。套件先发布 CSS，再替换 `client.js`，由官方监听器通告完整版本。 | 用同一开发 profile 启动，保存套件源码，确认原生 `/plugins/events` 发布了新版本，且 Electron 进程和会话保持。通过本机服务接口验证 Host 代码也已更新。 |
| 总助手选择 | `conversation.hero.agentPreset` 和 `conversation.input.model` 由原生预设与模型选择器负责。总助手仍是可选的 Host 预设。 | 在新会话中选择总助手后切换到其他预设，再在总助手会话的输入区切换两个模型。 |
| [删除已保存的智能体](../../plugins/ipollowork-suite/src/host/agents.ts) | 调用 DSH 预设注册返回的清理函数，从新任务的可选项中移除该预设。已有的运行范围与会话历史由原生 DSH 管理。 | 删除一个已保存的智能体，验证不能用它发起新任务，再打开删除前创建的会话。 |
| [对话错误提示](../../plugins/ipollowork-suite/src/client/chat-errors.tsx)、[官方模型选择](../../plugins/ipollowork-suite/src/host/service-models.ts)与[输出续写](../../plugins/ipollowork-suite/src/host/output-continuation.ts) | `conversation.chat.node` 的 `turn-error`、DSH 错误码和旧错误文本、`agent/pre-step`、LLM provider/adapter 注册、`session/event`、`agent/turn-stopping` 和 inbox 生命周期。 | 分别验证未选模型、适配器缺失、服务不可用和切换到自有密钥。失败后换到可用模型发新消息，应执行新任务。仅当前轮正常截断时续写，停止或结束本轮后清理待续写消息。 |
| [组织 MCP](../../plugins/ipollowork-suite/src/host/enterprise-mcp.ts)与[企业服务](../../services/ipollowork/src/enterprise-mcp.ts) | Host 的 `mcpManager.register` 返回清理函数，使用 `streamable-http` 和本地 Web 路由。组织项目删除和 MCP 列表管理走企业服务自己的 API。PostgreSQL 迁移 `014` 兼容先前独立部署的 MCP 版 `013` 和主分支的组织通知版 `013`。 | 验证组织列表、授权成员工具发现、撤销和退出登录后的注销、无权限状态。空列表、旧服务缺路由和无权限应有独立状态。 |
| [统一的组织空间](../../plugins/ipollowork-suite/docs/enterprise-assets.md) | 邀请、资源审核与设置沿用 Work 账号凭据及组织 ID。成员、资源、项目和会话分享通知使用原生插槽、`shell.overlay` 提示及原生 Button、Tooltip 和 Modal。 | 检查 CSV 异常、邀请、工号和标志。双账号审核并定向下发资源，确认弹出提醒后接收者仍有未读角标，且能打开通知对应记录。全部标为已读后，确认当前账号的角标清除。 |
| [组织会话副本](../../plugins/ipollowork-suite/src/host/session-copies.ts) | 对话标题区分享仅将 `sessionQuery.readSurface` 中的可见文字发给指定有效成员。接收端通过 `Session.create`、`SessionPersistence.create` 和 `Workspace.attachSession` 写入新会话，随后刷新原生会话列表，通过 `uiWorkspace.openSession` 打开。原工作区和工具记录不进入副本。 | 分享给两名同事中的一人，关闭分享者客户端，核对接收者可在软件内复制并续聊、再次打开复用现有副本，且新消息不改变原会话。 |
| [IM 手动接入弹窗](../../plugins/ipollowork-suite/vendor/dsh-im/plugin-src/client/credential-binding.js) | 原生 `Modal` 挂载在页面顶层；表单、指引和操作区样式跟随弹窗内容。 | 在明暗主题和窄屏分别打开令牌、ID 加密钥、Slack、Matrix 和邮件表单，检查焦点与退出。 |
| [组织资源审核和下发](../../plugins/ipollowork-suite/src/client/organization-publications.tsx) | 模板、插件、Skill 和 MCP 共用带版本的提交流程。PostgreSQL 迁移 `018` 把 MCP 纳入审核。已下发的 MCP 与审核记录使用相同的 ID 和授权范围，DSH Host 通过原有代理加载当前成员获授权的工具。 | 以普通成员提交，以管理员审核并指定接收者，分别检查已授权和未授权成员。下架后确认运行时撤销工具访问。 |
| [品牌和 Windows 标题栏](../../plugins/ipollowork-suite/src/client/brand.css) | 使用套件 theme、原生 slot 及部分 DSH DOM 和 CSS token。工作区顶部的额外 Windows 标志通过移除 `body::before` 覆盖处理。 | 检查标题栏、折叠侧栏、全屏、浅色和暗色。品牌标志和原生窗口控制应各自正确显示。 |
| [macOS 窗口拖拽](../../plugins/ipollowork-suite/src/client/suite.module.css) | DSH `dsh-v0.2.2-rc.3` 用 `data-global-panel` 标记主内容列，用 `data-window-drag` 标记原生拖拽栏，用 `data-shortcut-modal="settings"` 标记挂在页面根节点外的设置面板。套件按 `--dsh-frame-top-clearance` 设置顶部拖拽区，保留原生窗口控件。 | 在 macOS Electron 中从首页、会话、插件、组织空间、数据、机器人和设置顶部拖动窗口。收起侧栏和缩窄窗口后重试，检查滚动、按钮、弹窗和全屏。 |
| [登录、profile 和桌面集成](../desktop-host)、[官方启动器接入](../tooling/start.mjs) | `profile-boot`、`app-boot`、Connection 与认证导出，以及 DSH profile 配置和桌面桥接。源码构建和公开 npm 包需要分别核对导出，即使版本号一致。 | 在隔离 home 中启动真实 Electron，打开已有 profile 的测试副本，验证登录注册、模型和 agent 模式、工作区与会话、浏览器和文件操作。 |
| [桌面首页账号表单](../desktop/src/client/WelcomePage.tsx) | 桌面使用经过认证的本地 Host 账号路由，原生 preload 向表单传递明确允许的登录和注册错误。 | 验证错误密码、邮箱已注册，检查登录页没有忘记密码控件，确认成功登录后进入工作区。 |
| [桌面会话分享](../desktop/src/web-document.ts)与[中继](../../services/ipollowork/src/liveshare.ts) | LiveShare 在 `ownerLoginStart` 和 `ownerLoginRedeem` 校验 Web 来源，桌面转发已认证的宿主 HTTP 来源。DSH v1 中继在修改权限时用原 ID 重新注册；服务端核对所有者、来源会话、运行实例和网关令牌后更新分享。 | 用另一账号打开分享，再由所有者修改权限和部门范围。确认原链接保持在线，移除的成员和作废链接仍不能访问。 |
| [桌面项目文件下载](../desktop/src/file-actions.ts) | 现有 `dshDesktop.fileActions.save` 桥接接受套件同源的项目制品和记忆版本下载地址。桌面将鉴权后的 Host 响应流式写入磁盘；签名 HTTPS 对象单独下载，不转发 Host 凭据。 | 普通成员提交文件，管理员接纳后下载该版本，核对文件名和字节，并分别验证两种存储模式。 |
| [通用设置版本行](../../plugins/ipollowork-suite/src/client/desktop-version.tsx)与[桌面 preload](../desktop/src/preload-app.ts) | DSH `dsh-v0.2.2-rc.3` 提供 `settings.general.item` 插槽、`current-version` 条目和 `general.currentVersion` 翻译。产品用 Electron 包版本覆盖该条目。 | 使用版本号与 DSH 固定版本不同的安装包，核对通用设置和关于界面。检查浏览器仍显示 DSH 版本，使用旧 preload 的桌面客户端仍能通过 IPC 取得版本。 |
| [发行打包](../../.github/workflows/ipollo-release-packages.yml)与[公开更新清单](../tooling/release-publication.mjs) | 打包入口执行 DSH `build:official` 并校验固定版本构建记录。Intel macOS 用 pnpm 单工作进程批量打包同一组 DSH 包，随后执行上游的归档内容和清单校验。公开的 Windows 安装包和 blockmap 使用同一文件名主干。 | 分别用全新和已恢复的依赖缓存检查 Intel 归档清单和打包运行时。发布草稿前检查两个 macOS 更新 ZIP、Windows 安装包和 blockmap，以及四种官网安装包。 |
| [插件组合](../../plugins/ipollowork-suite/cordis.patch.yml)、[Studio 市场](../../plugins/ipollowork-suite/catalog/index.json)与[桌面资源打包](../desktop/scripts/prepare-dsh.ts) | Cordis 插入项和依赖、原生插件加载器、DSH ASAR 布局、Host/CLI 启动入口和电脑操作资源路径。官网安装包和 Office 回退在产品打包层。 | 用各平台打包客户端验证启动、市场按需安装、打开已有 Design/Video 项目、Office 打开和电脑操作辅助程序。 |
| [Design 模板生成和结果打开](https://github.com/Devin-AXIS/deepseek-design) | 基于 `dsh-v0.2.2-rc.3`，Design 使用会话范围的 `resources.source`、右侧栏文件关联、`conversation.chat.turnTail`、原生 `present` 工具和交付卡片。`design-actions.tsx` 打开编辑器，`surface.tsx` 向输入框插入文件引用时保持编辑器打开。 | 套用模板并给出与示例主题明显不同的提示词。保存期间切换会话，再返回检查预览。关闭预览后，从对话结果打开最终 HTML。用原生幻灯片模板发出做 PPT 的请求，点击「在 Design 中编辑」修改一页，核对修改已保存到同一份 HTML 且页数一致。 |
| [桌面更新频道](../desktop/src/update-channel.ts) | iPolloWork 正式发布源提供稳定版更新清单。桌面预加载对该来源省略可选的 `dshDesktop.updates.channels` 接口，DSH 通用设置不会显示开发版频道选项。 | 用保存过开发版偏好的设置启动正式安装包，确认它使用稳定版且仍可手动检查更新。换用其他更新源，确认频道选择仍可用。 |
| [Stage 桌面插件](../../plugins/stage) | `main`、`sidebar.panellist`、`plugins.bundle.config`、Host 连接准入、`workspaceRegistry`、`tools` 和 `sandboxPolicy`。桌面组合包含 Stage Bundle。 | 验证手动打开、关联与解除关联、每个工作区授权及只读限制。换账号后重新授权工作区。 |

Design `1.0.0-beta.31` 已在固定的 DSH 版本上通过 Windows 隔离测试。客户端从 Design 的 8 类模板各选一个，由测试模型保存，再从对话文件卡片打开。另测了关闭预览期间保存新版，再从同一张卡片打开。

Design `1.0.0-beta.32` 在同一版本的 DSH 上使用测试模型验证了 38 页幻灯片。收起侧栏后，对话卡片可以重新打开 HTML。点击「在 Design 中编辑」修改标题后，原文件成功保存，仍为 38 页。

Design `1.0.0-beta.33` 将模板身份保存到原生 HTML 绑定，通过 `systemPrompt.context` 给模板会话补充上下文，并用 `tools/pre-execute` 阻止该会话调用 `present` 交付 Office 幻灯片或 PDF。桌面实测从 38 页模板发送「做个 PPT」，写回 HTML 后由对话卡片重新打开 Design。

Design `1.0.0-beta.34` 将 HTML 交付约束应用于所有已激活的 Design 文档，包括直接从导航打开的文档。`surface.tsx` 等待鉴权后的 `/document` 继续编辑操作完成，再打开原生对话与右侧面板。会话级动态 `systemPrompt.section` 和必需的 `systemPrompt.context` 在关闭可选上下文时仍保留当前文件；`tools/pre-execute` 先恢复持久化绑定，再检查 `present`。升级时分别验证直接打开和使用模板，覆盖编辑器首次加载、已创建的 Agent 和插件重启。两条链路均先尝试返回 PPTX，再交付 HTML，由原生文件卡片重新打开并将编辑保存到同一个 HTML 文件。独立插件仓库的 CI 在 macOS 和 Windows 上运行该已安装归档的浏览器回归。

2026 年 11 月 19 日，同一份 beta.34 归档（`a17735f6e7f7e86680e0bacdecc6113baa19dacf41928691831ba50d8c6485fc`）在 Windows 和 [macOS](https://github.com/Devin-AXIS/deepseek-design/actions/runs/44454238252) 上通过了两种对话入口的回归。测试模型先尝试返回 PPTX，再写入并交付 HTML；原生文件卡片能重新打开 Design，手动编辑保存到同一个文件，模板保留全部 38 页。Windows 还通过了 Design/Video 同时安装的验证，现有开发配置已通过原生管理器更新并启用。macOS 验证使用原生 DSH Host 和浏览器，未操作用户已有的 Electron 安装版；该安装版仍需更新插件。两端的构建、类型检查和全部 129 项源码测试均通过。较大范围的 Linux Video 安装冒烟遇到了外部 GPU 依赖下载失败。

## 更新和验证

组织 MCP 同步直接调用已鉴权的授权目录，不再依赖额外的会话及积分查询。保留账号服务的安全错误码，以区分连接超时、登录失效与目录同步失败。验证已登录时仅请求目录、退出时不发出网络请求，以及目录故障时撤回连接。

组织 MCP 代理保留上游 4xx 状态和 `mcp-method`、`mcp-name` 协议头。当前 pin 的 MCP SDK 会先发送 `server/discover`；2025 协议服务器拒绝探测时，客户端需要依据原始 4xx 回退到 `initialize`，不能将其改写成 503。认证失败、权限不足和限流使用脱敏的独立错误码，上游错误正文不外发。升级 pin 时验证原生协议探测、旧版握手、工具列表、会话失效，以及 401/403/429 和上游正文脱敏。

Suite `0.1.36` 与 Design `1.0.0-beta.35` 通过可选客户端服务 `ipolloDesignTemplates` 注册组织模板来源。Cordis 注入与释放控制组织空间的模板页，账号凭证变化时清理旧账号来源。元数据来自已鉴权的账号目录；使用模板先重新校验指定版本的权限，再通过 `/document` 和带版本校验的 `/file` 创建新的 Design 文档。验证停用/启用 Design、不同授权的成员、撤权、切换账号，以及生成 HTML 后继续编辑。组织凭证不传递给 Design。

组织 MCP 使用原生公开的 `mcpManager.list`、`register`、`restart`。原生设置页只读取不含凭证的状态，重新连接前刷新授权。云运行凭证仅开放成员目录和连接传输所需方法，服务端仍逐次校验成员和资源权限。验证本地与云运行时的工具发现、原生 Agent 实际调用、撤权和退出登录。模型/工具弹窗通过原生 Modal 的 `contentClassName` 与 `footer` 保持接口路径可滚动、操作按钮可见；表单样式只匹配直接的原始输入框，保留添加插件的原生 Input 外层。以 390px 和两种主题检查，并验证提交资源能区分缺少元数据、非法版本和版本冲突。

1. 修改涉及 DSH 的功能时，同步更新本记录的中英文版本。记录产品入口、使用的 DSH 接口或选择器、验证方式，以及已验证的 DSH 版本。上游实现接替本地适配后，记录移除原因和首次验证的版本。
2. 在新工作树评估候选 DSH。同步更新固定记录、依赖清单和锁文件，使用候选版本自己的源码和产物。优先使用上游公开的扩展点与类型。可选能力通过宿主能力检测接入；遇到缺失的必要接口时，在采用新 pin 前完成适配和验证。
3. 在仓库根目录运行 `npm run setup:build`、`npm test`、`npm run check:upstream` 和 `npm run check:docs`。执行受影响套件的构建、类型检查和测试。插件 RPC 和会话归档类型由 DSH 提供，DOM、运行时事件和打包资源仍需实际验证。
4. 按[桌面验证说明](../desktop/tests/README.zh.md)用隔离 profile 跑上表受影响的流程，记录候选源码提交、平台、测试结果和未覆盖项。当前 pin 的测试通过只证明当前版本。

## 最近验证

组织空间可见标签以“部门、成员、项目”开头，其后标签维持原顺序。既有标签 ID、角色／Design 可用性过滤及已选标签保持原有行为。需同时核对源码及正在运行的开发客户端，并验证三个页面切换；不能仅凭构建成功判断客户端已刷新。

按用户要求移除项目页上方的本地工作区状态及协作说明区域，页面不再轮询 `/local-workspaces`，对应闲置文案和 CSS 一并删除。保留下方工作区关联折叠入口及项目刷新行为。Host 元数据接口为兼容已安装客户端继续保留。下文记录的该状态区域及缺失路由提示现已退役。

组织项目更新后，另行检查用户现有 Windows 开发进程：云端项目内容返回 200，新增的仅 Host 本地工作区接口仍返回 404。源码构建完成和客户端 HMR 事件不能证明该进程的 Host 已替换。沿用原配置重启开发版后，接口恢复为 200，返回一个关联工作区及三个会话。项目状态对缺失 Host 路由提供明确的重启／更新提示，保留鉴权失败反馈，失败时隐藏旧本地元数据。`watch-local-suite.mjs` 日志明确要求核验变动的 Host 接口；后续开发交付必须同时检查正在使用的进程和独立归档安装。

组织项目的手动刷新、窗口聚焦及可见页面定时刷新，向项目内容、概览、输出／容量列表及本地工作区状态传递同一版本。本地状态依赖 `workspaceRegistry.list()` 的 ID、标题、会话 ID 及既有 `.ipollo/project.json` 关联文件。Host 复核云端权限和账号代次后才返回本地元数据；该读取不上传会话正文或本地文件。保存成员权限时，将旧范围展开为当前成员的有效个人授权；创建项目也只提供逐成员授权。

统一文件选择控件使用原生 `Button`（转发 ref）和 `IconUploadOutlineRegular`，在可访问按钮后保留原生输入、`FormData` 和必填验证。覆盖项目上传／提交、成员 CSV、组织 Logo、共享 Skill 和 HTML 模板。可撤销的 `body[data-ipw-suite] input[type="file"]::file-selector-button` 兜底样式处理其他可见 Host 输入，不接管原生附件的数据所有权。下次升级应复测取消、替换／移除、拖放、必填反馈、禁用、长文件名及 390px 明暗主题。独立 iframe 插件仍使用自己的样式。

2026 年 11 月 19 日，独立 Windows DSH 管理员／成员配置安装实际 Suite 归档，验证项目创建、本机关联及计数、个人权限保存、管理员上传后成员可见、成员提交知识、维护者接纳、记忆及概览贡献／版本更新。文件选择覆盖明暗主题和 390px，检查中文及空格文件名、移除和上传禁用状态。最终 Suite 全量 202 项以四个测试文件并发运行，191 项通过、11 项跳过，包含原生云端启动；最初不限并发运行的启动超时也已独立重跑通过。根目录测试、上游／文档校验、类型检查、构建、目录资源和打包检查通过。本次桌面改动不需要部署账号服务或制作安装包。

2026-11-19，Suite `0.1.38` 累计 186 项不同测试通过（11 项可选跳过）；完整测试中的原生启动超时在并行构建结束后的独立重试通过。服务端 95 项测试全部通过，根目录检查、打包检查与构建通过。两个隔离 Windows 配置安装实际归档，验证 Skill 文件校验、中文及空格版本的审核发布、Design 指定版本模板读取、版本提示、明暗主题与 390px 窗口。现有 Windows 开发版保留账号和会话列表，共享 Skill 表单已显示文件上传入口。开发配置中残留的 DSH 自带依赖旧副本移至可恢复的本地备份，由固定运行时提供对应依赖；未修改上游源码。账号服务 `0.1.14`、提交 `b8e5572db4ba1db0f474d008f8e368bc8baef549` 已部署至 `cloud.ipollo.net`，上线前备份 PostgreSQL 和配置，保留 schema 19，就绪检查通过且容器重启数为零。本次未构建或测试桌面安装包。

Suite `0.1.38` 从 UTF-8 Markdown 文件上传共享 Skill 内容（限制 32 KB），沿用已鉴权的发布、审核与授权接口。模板、Skill 和 MCP 共享配置可自定义版本标识；Host 转发将版本编码为单个 URL 路径段，覆盖中文和空格。插件保留准确的包 SemVer。原生 Skill 注册和 MCP 传输保持原有协议；下次升级时复验文件替换及读取异常、上传/审核/成员注册、自定义版本模板读取与现有授权校验。账户服务 `0.1.14` 提供对应版本校验，无需数据库迁移。

Suite `0.1.37` 沿用原生组织页头插槽和 Modal 通知列表。打开铃铛后读取当前账号的通知，通过现有接口自动标记全部未读并刷新角标；没有 `unreadCount` 的旧服务仅标记本次返回的未读 ID。切换账号会使未完成的通知读取失效。网络、超时、过载、数据库和数据格式异常显示本地化原因及有长度限制的错误码，不显示上游原始诊断。升级 DSH 时复验打开铃铛、已读提交失败及重试、切换账号，以及组织和共享会话错误提示，覆盖原生明暗主题和窄窗口。

在 Windows 固定 DSH 上验证：Suite 183 项测试通过（11 项可选跳过），打包检查通过，根目录 11 项测试、上游验证和文档检查通过。隔离配置实际安装归档后，打开铃铛将 103 条未读清零；模拟已读提交失败时保留角标，重试成功后清除。真实客户端覆盖组织与共享会话的错误和恢复、明暗主题及 390px 窗口。现有开发版沿用账号重启，组织和共享会话实际读取返回 200；最终客户端在窄窗口的刷新按钮保持 64×28px 且文字不换行。这些修改为 Windows/macOS 共用，本次没有实测 Mac 安装包。

2026-11-19，账号服务 `0.1.13`、提交 `4f720e4c65842a1824c897865148e4f4fc6b1eb5` 已部署到 `cloud.ipollo.net`。94 项服务端测试和 120 账号的模拟 HTTP 压测通过。上线前备份了 PostgreSQL、认证密钥和配置，保留 schema 19 与认证密钥，并核对公网就绪检查和候选镜像。现有 Windows 桌面账号仍保持登录，组织模板和 MCP 连接接口返回 200。Work 容器限制 2 GiB、V8 老生代堆限制 1 GiB，并限制进程数、轮转日志。ECS 保持 4 vCPU/8 GiB；可选 2 vCPU/4 GiB 配置尚未在目标硬件完成容量认证。容量文档中的异机备份、外部监控及真实供应商额度仍需运维准备。

账号服务的内测容量控制保持原生 LiveShare v1 协议。`services/ipollowork/src/liveshare.ts` 限制连接中的分享方（默认 200）、每个分享方等待中的 RPC（32）及待发送数据（8 MiB），空闲权限刷新改为每 5 秒；写操作和每次 RPC 仍重新鉴权。升级 DSH 时验证重连、并发查看方请求、过载拒绝、撤权和退出。模型/MCP 的并发名额保留到流读取结束或取消；完成的上传及能力 JSON 返回后立即释放。HTTP 压测使用 120 个合成账号与模拟上游，不代表真实供应商或已安装客户端的负载验证。

Design beta.35 的 [CI](https://github.com/Devin-AXIS/deepseek-design/actions/runs/44461150839) 在 Windows、macOS 上通过构建、类型检查、全部 131 项源码测试、打包检查和已安装原生插件的对话回归。独立的 Linux Video 冒烟因外部 CUDA 依赖下载失败。该验证未覆盖用户已有 Mac 安装包内的组织 Suite 界面，该客户端仍需更新 Suite 和 Design。

2026-11-19，Suite `0.1.36` 通过 176 项测试（11 项可选跳过），账号服务通过 89 项，根目录工具通过 11 项测试及上游、文档检查。两个隔离 Windows 原生配置实际安装 Suite 与 Design beta.35 归档，使用合成管理员/成员账号，验证具体版本异常、名称/说明必填、模板授权过滤、Design 开关、新建 HTML 后手动编辑保存、MCP 设置状态及 Agent 的 `ping`/`pong` 调用。撤权后原生 MCP 工具被移除，模板读取和 MCP 重连均被拒绝。模型/工具弹窗在 390px、1280px 和原生明暗主题下，内容可滚动且底部按钮始终位于 600px 高的窗口内。MCP 测试仅替换合成服务的传输目的地，真实业务授权仍然执行。Windows 开发版沿用原配置重启，Design beta.35 通过原生管理器更新。根目录初始化拒绝覆盖已有的真实 `apps` 目录，该目录保持原样。

2026-11-17，Windows Electron 开发版使用当前 pin 和已有登录会话，成功打开组织 MCP 列表及共享表单。迁移和授权回归使用隔离 PostgreSQL，覆盖从业务 schema `11` 升到 `13`、原组织与登录会话保留、管理员共享及撤销。桌面端共 19 项相关回归通过。真实第三方 MCP 的连接和调用需要配置服务后验证。
