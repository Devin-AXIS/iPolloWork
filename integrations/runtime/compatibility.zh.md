# DSH 兼容记录

[English](compatibility.md) | 中文

DSH 基准由[运行时固定记录](upstream.json)指定：`dsh-v0.2.3-alpha.2`，源码 `4b399c39a6d1`。下文同时保留 `dsh-v0.2.2-rc.3` 的历史验证，不能将旧结果视为新版运行时的验收。以 `4c696c2b33` 拆分 DSH 源码的提交为历史分界。较早的迁移见[已有升级指南](../../docs/upgrade-guide)。

## 升级前复核的功能

Mac 打包先核对官方已发布 `dsh-cua-macos` 归档的锁定 SHA-512、准确 SDK 包版本、`cuaHelperSourceDigest` 和 `verifyCuaHelperPayload` 的双架构应用代次，再通过固定版本 `build_app.py` 的发布函数应用产品 Developer ID，公证、封存并重新读取选中的应用路径，运行宿主架构的官方 `protocol_e2e.py`。官方实现字节保持不变。后续升级复核这些构建工具接口和真实 Mac 签名、协议。

桌面产品设置保留在可编辑的 profile 根配置树，同时插入一个启用的原生 Include 作为私有应用的管理边界。其 profile 相对路径 `./ipollowork-desktop-management.yml` 使用公开的 `initial: []` 选项，由原生加载器创建空配置，不把产品偏好移入其他配置树。因此原生管理器以 `management-required` 拒绝停用 Bundle，以 `not-removable` 拒绝卸载。真实安装运行时冒烟同时验证这两项拒绝和产品设置可编辑。以后每次更换 pin 均复核这些公开保护规则，不修改 SDK 的受保护插件集合或放宽冒烟断言。

alpha.2 迁移对齐 Node.js（`^24.22.3 || >=26.13.1`）、Cordis（`4.2.0-alpha.1`）、Schemastery（`3.20.0-alpha.1`）、自有 SDK peer 依赖和私有桌面 Host 版本。DeepSeek 账号工程引用由 `credentials` 移至 `account`。模型配置改用 `maxImageBytes` 并提供 `requestImageBudgetCount`；MCP 探测改用公开的 `McpClientHost.probe`。隔离候选版已通过产品源码检查、桌面类型检查、原生源码暂存构建、模型/看板/MCP 契约测试和官方便携运行时检查。最终归档安装、外部账号验证及发布部署仍是独立验收项。

Windows 安装核验准确的 Git commit 和 tree，无需文件符号链接权限；配置副本由哈希管理。显式 `--upgrade-upstream` 会保留旧的已核验缓存，拒绝修改过的官方源码和静默替换 pin。临时短路径目录联接让完整的官方 Python wheel/Office 检查避开 MAX_PATH。`npm test` 覆盖 Node 拒绝、不变源码检出和目录联接清理；`check:upstream` 在打包前拒绝混用 SDK 版本。

可选的九步新手教程使用原生 `configForms`、`settings.section`、`shell.overlay`，只保存教程进度，保留原有初始化选择，支持继续未完成教程、重试和本地关闭，不会发送消息或创建项目。定位入口只聚焦或滚动；缺少入口时提供可阅读说明。后续升级应复核首次初始化衔接、设置中重新开始、关闭后迟到的保存响应、双语、明暗主题和受限窗口。

服务 schema 22 是已有产品迁移，并非 DSH 新增 schema。构建按导出的服务 schema 常量复制全部迁移；部署从构建镜像读取目标版本，避免继续固定为 21。实际服务器完成备份、向前迁移和切换后就绪验证前，不能宣称部署已完成。

alpha.2 的客户端聚合 remotes 类型不再自动引入 settings 命名空间。Suite 显式声明公开的 `@deepseek-ai/dsh-api-settings-controller/remote` 类型扩展；MCP 配置操作仍打开原生配置文档。Include 的 `applyEntryPatches` 改为返回 `{data,index}`，桌面组合测试读取 `data`，桌面 overlay 沿用 profile 所属的产品条目。下次更换 pin 时重跑 Suite 严格类型检查、MCP 设置入口及完整桌面测试。npm 安装后先运行 `link:workspace` 再测源码，让官方仅在工作区提供的开发依赖从固定版本依赖图解析。

真实 Electron 冷启动发现两处配置变化：`group: true` 现在要求数组；原生 ConfigEditor 仅编辑所属 profile 配置树，嵌套 Include 的设置另有归属。桌面改由私有 Bundle 直接插入产品条目，保留既有条目 ID 和已保存偏好，最终 overlay 仅保持 Suite 启用。运行时根清单显式声明发货 Suite 依赖，使 alpha.2 能解析这些原生配置条目。回归检查真实 Loader 格式及偏好保留；真实 Electron 验证套件 `/info`、教程与通知设置发现、全部九步漫游、刷新保留进度和深色受限窗口。私有 Host 必须依赖当前发货的 Suite 版本，打包前强制核对。

桌面 `integrations/desktop/src/web-document.ts` 不把 HTTP 工作台的 `Origin-Agent-Cluster` 转发到 `dsh-app://`。小红书的 `?1` 响应头在 Electron 44.7.0 中触发 Chromium `AddOriginAgentClusterStateForBrowsingInstance_Cpp` 检查，导致 browser 进程以 `0x80000003` 退出；普通 HTTP 浏览器验收无法覆盖这一差异。其余 CSP 和 CORP 保留，HTTP Host 的原始响应不变。升级桌面/Chromium 时复验真实桌面首次打开、切换后重开、账号弹窗及软件进程存活，不能仅用后台 `open-workbench` 成功代替。小红书子进程显式继承 Electron Node 模式；Canvas 在发送 AI 草稿前等待最新画布上下文写入。

小红书和微信公众号的命令式账号表单保留在所属 iframe 的原生 HTML dialog 内；搬入父文档会丢失业务 CSS 与依赖原 document 的事件处理。升级时复测主题、焦点、Escape、滚动和关闭。小红书打包会拒绝过期的生成版公共资源，旧链接按钮保留原锚点语义。桌面 Host 对 `tsc -b` 已产出的 JS 设置 `tsconfig: false` 再打包，避免构建器重复遍历工程引用；工具链升级后复验 Host、包导出与实际账号/profile 启动。

旧版 UI 适配层将按钮变体映射为当前原生支持的类型，并将旧弹窗标题转入 `Modal.title`。限定范围的弹窗样式挂载到父文档，在最后一个插件释放时移除；升级时复测唯一且可访问的标题、确认与取消按钮、表单宽度和样式清理。本地批量安装可用 `-NoNativeHmr` 暂时停用生成的 HMR 条目，走原生插件管理器的重启生效流程，再正常重启恢复 HMR；不手工修改插件选择，不修改上游。

Suite `0.1.50` 与迁移包的新版本按功能复用现有 Lucide 图形，侧栏不再统一显示拼图；标注和录制使用公开的原生图标组件。市场在已安装版本落后时使用新目录图标，避免旧包遮盖新版图标。旧工作台的空状态、提示、对话框和进度兼容组件提供统一主题样式；Canvas 使用宿主主题及中文草稿提示。决策情报 `1.0.2` 在固定来源 `f95aaa5e185f` 上补充包元数据、图标与原生右栏引导图标，Host 和编辑器业务不变。升级 pin 时用真实归档核对市场、管理器、侧栏和右栏，覆盖 26 项入口、明暗主题、窄窗口及常用弹窗；已安装旧包需要更新并检查运行进程，不能只检查目录中是否有图标字段。

Suite `0.1.49` 携带素材工作台 `0.1.3` 的页面接口别名适配：图片页的 `status` 对应 `image-status`，视频页的操作对应已声明的 `video-*` 服务。仍经过原有 owner 鉴权、工作区归属及输入校验，不扩展工具权限；未登录或未授权模型时显示配置提示。回归时检查两个页面的初始化以及真实授权后的模型与任务读取，付费生成另行按用户操作验证。

Suite `0.1.48` 同时携带数据标注和操作录制的原生 Button 工作区标题栏、标注深色空状态对比度修复，以及素材工作台 `0.1.2` 的主题图标修复。两个标题栏声明公开的 `dsh-client-ui-primitives` 客户端依赖；工作台沿用 iframe 的 `data-theme` 桥接。下次升级复验明暗主题、长工作区名称和窄布局。

Suite `0.1.47` 携带 22 个迁移原生包的显示元数据修复。各包导出 `./package.json` 与 `./locale/*.json`，发货中英文 `meta` 字典，使 DSH 的 `readPluginMeta` 能在安装后读取包图标和本地化标题。下次升级通过原生插件管理器安装实际归档，核对元数据、图标、启用和页面；市场有图标不能代替安装后元数据验证。

Suite `0.1.46` 将多引擎分支 24 个身份的对应清单和经校验的独立原生包加入既有 format-1 市场。`src/ported/host.ts` 使用 `ctx.tools.register`、`ctx.skills.register`、`workspaceRegistry`、所有者准入、沙箱策略、原生凭据记录和生命周期内的 `mcpManager.register`；`src/ported/client.tsx` 使用 `main`、`sidebar.panellist`、`plugins.bundle.config`、`uiWorkspace.connectWorkspace` 及未发送的会话草稿。自有 iframe 桥接复用原生组件，不包含旧宿主或 Agent 运行时。`ServiceCenter.capability` 通过既有账号授权能力接口接通模型，不向插件传递供应商密钥。下次升级复测实际安装包、schema 方言、启停卸载、凭据脱敏、只读和工作区拒绝、MCP 授权、iframe 操作、明暗主题与窄布局。没有对应服务契约的旧版高级媒体操作明确不可用；见[迁移清单](../../docs/multi-engine-plugin-migration.zh.md)。

工作台主题桥接从原生 body 读取 --dsw-/--dsh- 计算 token，只复制 style[data-plugin="@deepseek-ai/dsh-client-ui-primitives"] 样式；升级时复核这些 DOM 约定。本地重定向、Onto 动态扩展导入和 EventSource 地址保留所有者代理前缀。当前 pin 没有旧宿主按账号浏览器资料、自动观察和 ui/open-link 桥接的对应接口，这些流程明确不可用。

Desktop `1.0.10` 沿用 `initProfile`/`readProfileManifest` 和原生 `dsh.profile.bundles`，补齐已初始化配置缺失的私有 Host；备份原清单后移除重复的公开产品 Bundle 和产品直接依赖。`desktop-runtime.json.sharedPackages` 限定安装包拥有的 Suite/Stage/Host 副本，即使版本相同也恢复为安装包提供。最终原生 Include overlay 仅启用产品入口；Suite 根据 install-anchor 包身份固定该发行版的账号、主题及服务地址，保留其他插件配置和凭据。升级时复测旧 web-only profile、旧及相同版本 Suite、停用条目、已安装 Mac 的真实云端登录、错误密码分类和保持登录后再次进入。欢迎页进入工作区前核验 `/ipollowork-suite/info`，区分凭据错误、会话拒绝、服务异常、超时和限流。详见[升级诊断](../../docs/diagnostics/2026-11-20-mac-login-and-upgrade.md)。

官方模型代理只在响应头返回前连接失败，或网关报告同一调用仍在执行时，复用原请求 ID 恢复连接。恢复有次数上限、支持取消并绑定账号代次；原生 pi-ai 自动重试仍关闭。已开始输出的流和上游结果不明的调用不重放。账号服务另行在同一计费调用内重试明确返回 HTTP 429 的聊天请求。下次升级 DSH 时复验原生流、预备调用、取消、切换账号及只结算一次。Design 编辑器在拖拽与缩放前将 CSS 单位解析为布局像素，按父容器缩放换算指针位移，并在实际移动后才启用吸附；复验 PPT 百分比、样式表定位、内容盒尺寸、右下角锚定和固定画布缩放。

Desktop `1.0.9` 在官方 profile 启动前，使用现有锁和签名应用的 `desktop-runtime.json` 清单，将 profile 中版本不匹配的 DSH/Cordis 核心依赖备份到独立目录。DSH 原生解析保留 profile 优先级，插件停用后留下的旧依赖仍可能覆盖安装包。升级时复测旧 `dsh-llm`/`dsh-typert-protocol`、重复启动、数据保留、相同版本和外部链接；不修改解析器或 Agent。详见[诊断与验证](../../docs/desktop-startup-and-download-fix-2026-11-20.md)。

Suite `0.1.39` 携带 Design `1.0.0-beta.37`，使用原生 `ctx.skills.register`、`ctx.tools.register`、必需的 `systemPrompt.context`、工作区归属和沙箱策略处理模板生成。随包的 `ipollowork-design` Skill 和带 revision 的 `design_edit_text` 只替换文字，保留其余 HTML。模板清单作为有界来源数据处理；文档切换与工具写入共用插件生命周期队列。原编辑器在像素属性控件展示前解析 CSS 单位和主题变量，浮动元素操作直接打开“元素”页。企业 VI 模板保留默认几何并接入主题变量，固定原生幻灯片隐藏无效的全局几何控件；PDF 后台导出有计时兜底。升级时复测 Skill 发现/加载、必需模型上下文、过期版本/只读/跨工作区拒绝、HTML 卡片与链接、本地媒体、元素属性、主题持久化、38 页可编辑 PPTX/PDF、明暗主题和 390px。详见[验收记录](../../docs/design-template-fidelity-2026-11-19.md)。Agent 和 DSH 源码保持不变。

新增 [MCP 连接入口](../../plugins/ipollowork-suite/src/host/mcp-connections.ts) 使用原生 `mcpManager.list/restart`，并在 web-app 的 `mcp-manager` 命名空间中通过带 revision 的 `settings.mutate` 修改单个服务器的 `enabled` 字段或移除仅用户层存在的条目，保留同级配置和凭据引用。继承配置与插件注册条目不可删除，编辑仍打开原生配置文件。组织 MCP 的断开选择通过原生凭据提供方仅保存在本机，按已验证账号身份和服务来源隔离。没有历史选择时仍只请求授权目录；读取已保存选择时每个账号代次增加一次身份查询，不依赖积分接口。升级时复测工具撤回、连接、刷新和重启保持状态、切换账号、版本冲突、保存失败、删除确认及明暗主题和窄设置页，确认原生配置编辑和插件生命周期仍正常；不修改 DSH 源码。

| 功能与产品代码 | DSH 依赖 | 验证 |
| --- | --- | --- |
| [组织网页入口](../../plugins/ipollowork-suite/src/client/organization-websites.tsx) | 复用组织设置页面和当前 DSH 连接身份下的套件 Host 接口，由 Work 账号服务判定可见性，并在打开时解析网址。 | 用管理员账号添加按部门和角色授权的链接，用有权限的成员账号打开。修改成员权限后，确认此前显示的入口也无法继续打开。检查深浅主题和窄窗口。 |
| [插件后台安装](../../plugins/ipollowork-suite/src/client/market-installation.ts)与[原生添加插件入口](../../plugins/ipollowork-suite/src/client/add-plugin.ts) | DSH Plugin Manager 的安装请求 ID、`plugin-manager/install-state`、`plugin-manager/changed`、连接重置、`shell.overlay`、`plugins.tab`。原生工具栏的 DOM 是额外依赖，涉及 `data-plugin-toolbar`、菜单角色和本地化标签。 | 分别从工具栏主按钮、下拉菜单和市场开始安装。关闭弹窗并切换页面，确认安装继续、重新打开可见进度、安装结束按钮自动刷新。上游提供可替换的安装入口后移除 DOM 拦截。 |
| [精选市场更新](../../plugins/ipollowork-suite/src/host/market.ts) | `listBundles` 提供版本、来源、归属、选中及只读状态。同来源的固定 Git 提交使用 `plugins.tab.update`。归档更新以预期包名、版本和 `enabled: false` 调用原生 `installBundle`，替换同一个依赖时沿用现有选中状态。 | 分别更新已启用、已停用的旧归档，重启核对版本、配置、工程文件和启用状态。验证当前版本变化、归档损坏时拒绝更新，并复验兼容性、离线目录、同来源 Git 更新、明暗主题与窄窗口。[桌面自检](../desktop/scripts/smoke-runtime.ts) 核对市场安装来源，并根据安装包内的运行时清单验证两个离线归档的哈希。 |
| 原生会话归档与工作区移除 | 会话菜单、归档确认、已归档筛选、取消归档和工作区移除均由 DSH 负责。产品回收站、额外删除入口、移除工作区后的归档监听和归档文件 IPC 已在 `dsh-v0.2.2-rc.3` 上移除。已有归档数据继续由 DSH 管理。 | 确认侧栏没有产品回收站，会话菜单没有额外删除入口。通过 DSH 归档和取消归档，再移除可丢弃的测试工作区，核对原生行为。 |
| [组织资源共享](../../services/ipollowork/src/organization-publications.ts) | Work 保存审核过的插件包名和固定版本，DSH 插件管理器负责检查、确认及安装。已发布且授权的 Skill 进入 DSH 技能注册表。成员打开组织或资源页时刷新授权，Host 也在后台定期刷新。 | 成员保持登录时发布版本。打开资源页，在新会话用原生斜杠菜单选择 Skill。验证撤回授权会移除对应 Skill，插件由原生管理器检查且初始禁用。 |
| [Windows 开发版热更新](../desktop/scripts/start-local-hot.ps1)与[当前源码构建](../desktop/scripts/prepare-local-desktop.mjs) | 启动器验证 DSH 固定版本，核对当前外壳、Host 和账号组合的源码指纹，通过现有 `prepareDevelopmentProject` 和官方 CLI/profile 启动器构建独立产物。保留原 home 和用户目录，仅复用指纹一致的产物。已链接套件由 DSH 的 `hmr` 和 `client-hmr` 接管重载，CSS 先于 `client.js` 发布。 | 从旧产物运行时重新执行启动器，核对实际外壳版本、登录界面、账号地址和 Host 接口。只改外壳源码而不改版本号，确认替换进程；源码未变时重跑确认复用。保存套件源码，确认 `/plugins/events` 更新且会话保持。 |
| 总助手选择 | `conversation.hero.agentPreset` 和 `conversation.input.model` 由原生预设与模型选择器负责。总助手仍是可选的 Host 预设。 | 在新会话中选择总助手后切换到其他预设，再在总助手会话的输入区切换两个模型。 |
| [删除已保存的智能体](../../plugins/ipollowork-suite/src/host/agents.ts) | 调用 DSH 预设注册返回的清理函数，从新任务的可选项中移除该预设。已有的运行范围与会话历史由原生 DSH 管理。 | 删除一个已保存的智能体，验证不能用它发起新任务，再打开删除前创建的会话。 |
| [对话错误提示](../../plugins/ipollowork-suite/src/client/chat-errors.tsx)、[官方模型选择](../../plugins/ipollowork-suite/src/host/service-models.ts)与[输出续写](../../plugins/ipollowork-suite/src/host/output-continuation.ts) | `conversation.chat.node` 的 `turn-error`、DSH 错误码和旧错误文本、`agent/pre-step`、LLM provider/adapter 注册、`session/event`、`agent/turn-stopping` 和 inbox 生命周期。 | 分别验证未选模型、适配器缺失、服务不可用和切换到自有密钥。失败后换到可用模型发新消息，应执行新任务。仅当前轮正常截断时续写，停止或结束本轮后清理待续写消息。 |
| [组织 MCP](../../plugins/ipollowork-suite/src/host/enterprise-mcp.ts)与[企业服务](../../services/ipollowork/src/enterprise-mcp.ts) | Host 的 `mcpManager.register` 返回清理函数，使用 `streamable-http` 和本地 Web 路由。组织项目删除和 MCP 列表管理走企业服务自己的 API。PostgreSQL 迁移 `014` 兼容先前独立部署的 MCP 版 `013` 和主分支的组织通知版 `013`。 | 验证组织列表、授权成员工具发现、撤销和退出登录后的注销、无权限状态。空列表、旧服务缺路由和无权限应有独立状态。 |
| [统一的组织空间](../../plugins/ipollowork-suite/docs/enterprise-assets.md) | 邀请、资源审核与设置沿用 Work 账号凭据及组织 ID。成员、资源、项目和会话分享通知使用原生插槽、`shell.overlay` 提示及原生 Button、Tooltip 和 Modal。 | 检查 CSV 异常、邀请、工号和标志。双账号审核并定向下发资源，确认弹出提醒后接收者仍有未读角标，且能打开通知对应记录。全部标为已读后，确认当前账号的角标清除。 |
| [组织会话副本](../../plugins/ipollowork-suite/src/host/session-copies.ts) | 对话标题区分享仅将 `sessionQuery.readSurface` 中的可见文字发给指定有效成员。接收端通过 `Session.create`、`SessionPersistence.create` 和 `Workspace.attachSession` 写入新会话，随后刷新原生会话列表，通过 `uiWorkspace.openSession` 打开。原工作区和工具记录不进入副本。 | 分享给两名同事中的一人，关闭分享者客户端，核对接收者可在软件内复制并续聊、再次打开复用现有副本，且新消息不改变原会话。 |
| [IM 手动接入弹窗](../../plugins/ipollowork-suite/vendor/dsh-im/plugin-src/client/credential-binding.js) | 原生 `Modal` 挂载在页面顶层；表单、指引和操作区样式跟随弹窗内容。 | 在明暗主题和窄屏分别打开令牌、ID 加密钥、Slack、Matrix 和邮件表单，检查焦点与退出。 |
| [组织资源审核和下发](../../plugins/ipollowork-suite/src/client/organization-publications.tsx) | 模板、插件、Skill 和 MCP 共用带版本的提交流程。PostgreSQL 迁移 `018` 把 MCP 纳入审核。已下发的 MCP 与审核记录使用相同的 ID 和授权范围，DSH Host 通过原有代理加载当前成员获授权的工具。 | 以普通成员提交，以管理员审核并指定接收者，分别检查已授权和未授权成员。下架后确认运行时撤销工具访问。 |
| [iPolloWork 共用控件](../../plugins/_shared/ui/controls.tsx)与[产品主题](../../plugins/_shared/ui/theme.ts) | 套件通过 `ctx.theme.overrideTokens` 注册主题，表单复用原生公开的 `Button`、`Input`、`Switch`、`Menu` 和 `Modal`。[套件样式](../../plugins/ipollowork-suite/src/client/brand.css)在随包 Studio 的 `data-studio-editor`、`data-studio-overlay` 根节点映射主题变量。 | 更新 DSH 或 Studio 固定版本后，打开设置、项目和智能体创建、设计工作台。在两种主题和桌面、390 px 宽度下检查侧栏选中、菜单磨砂、开关和发送按钮对比度、组织空间标签和设置、焦点、原生下拉、编辑器与弹层颜色及作品预览隔离。将套件的 `theme` 设为 `false`，检查原生外观恢复后各插件仍可使用。 |
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
| Stage 桌面插件（在 PR #582 中移除） | 曾使用 `main`、`sidebar.panellist`、`plugins.bundle.config`、Host 连接准入、`workspaceRegistry`、`tools` 和 `sandboxPolicy`。 | 检查产品组合是否已移除 Stage Bundle。 |
| [iPolloWork 共用控件](../../plugins/_shared/ui/controls.tsx) | 套件客户端、项目看板与通知中心在构建时打入同一份产品源码。共用控件使用固定 DSH 的公开 `Button`、`Input`、`Menu`、`MenuSurface`、`Tag`、`Switch` 与主题语义变量。`FieldPopover` 在套件的智能体编辑和看板详情中使用浏览器顶层锚定弹层。看板和通知中心各自随客户端生命周期加载与撤销样式。 | 安装套件，在明暗主题与窄屏用鼠标和键盘检查智能体编辑与看板的下拉。分别停用和启用两个子插件，确认另一个入口的样式仍然可用。单独安装两个归档并验证它们可在没有套件时打开控件。 |
| [项目文件](../../plugins/project-files) | 使用原生 `sidebarRightTabs` 和 `sidebar.right.pane.tab` 接入对话右侧，用 `keepMounted` 在资源预览时保留文件浏览位置。Host 通过 `workspaceRegistry` 确认项目，使用 `sessionQuery.readSession` 读取历史、原生附件和工作区变更摘要，通过 `sessionFileAddress` 打开预览，使用 `fileMediaUrl` 和 `ImageLightbox` 支持项目图片和上传图片预览，按会话头的 `cwd` 解析记录中的相对路径。条目复用对话附件使用的原生 `FileTypeIcon`、`classifyFileType`、`fileExtension` 和 `fileSizeText`。从 `deliverables/presented` 的可选 `description` 取得显示标题。插件自己的文件操作要求所有者身份、文件系统一致及工作区路径校验。 | 分别独立安装和随套件安装。在两个项目打开右栏，核对本次对话和整个项目范围的输入输出、交付标题和文件名以及网格和列表排列、等大条目、原生文件图标、附件原件下载、小缩略图和直接预览交付网页及目录首页、复制、拖放、改名、废纸篓和恢复，验证跨项目与非所有者访问失败，并检查明暗主题和 390 px。 |
| [自定义外观](../../plugins/custom-appearance) | 使用原生 `settings.section`、`settings.section.icon`、`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`，通过 `theme.overrideTokens` 叠加在套件默认主题上。Host 使用 `storageDomain` 持久化、`connection.admit` 鉴权，通过 `webServer.tapIndex` 和公开 PNG Logo 与套件默认品牌组合。保留原生窗口标题里的会话前缀。 | 在隔离的套件 profile 切换预设并保存自定义明暗配色、名称和 Logo，核对设置、首页及选中会话。验证刷新、重启、首次页面标题和图标、鉴权、窄屏和停用恢复。 |
| [项目看板](../../plugins/collaboration-board) | `plugins/collaboration-board/src/client.tsx` 使用 `conversation.view`、`main`、`sidebar.panellist`、工作区及会话快照、`uiWorkspace.openSession`、`sessions.using` 和原生会话 `prompt`。输入区由 DSH 在看板视图中继续管理。`src/host.ts` 使用所有者准入、兼容 v1 的 v2 存储域、`tools` 注册表及 `sandboxPolicy`。浏览器归档使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`、`Input`、`Menu`、`MenuSurface`、`Tag` 和图标。插件样式使用 DSH 的语义色、标准警示色、圆角和阴影变量。`plugins/_shared/ui/date-time-field.tsx` 和 `controls.tsx` 使用浏览器 Popover API 和 CSS 锚定定位，分别显示日期日历和同一栏内可直接编辑的两个 24 小时时间端点。状态和优先级也使用锚定菜单。套件 Host 提供按账号授权的看板桥接。「智能体」服务通过原生 Agent preset 解析候选，项目会话使用 `ipollo_delegate` 创建专员子会话。Host 使用 `subagents.rootOf` 将该子会话的只读查阅限制在原项目。 | 在临时配置中安装归档，从状态列新增任务，打开任务详情侧栏，依次核对任务名称、进度、排期和协作成员。使用可搜索的选择器，从卡片修改状态，切换项目并刷新，确认看板与对话之间切换时可以使用原生输入区。在明暗主题与窄屏检查中性底色、黄色警示标签、嵌套菜单的键盘关闭和焦点恢复，以及日期键入、每 15 分钟一档的时间列表、精确到分钟的输入、时长以及单个日期和整体清除。使用第二个账号验证指派通知和前置任务解锁。验证 `ipollo_project_tasks` 只使用原生会话所属项目，拒绝跨项目访问及提前开始，并检查专员委派及回传、原生定时、两种主题和窄屏。 |
| [项目看板的对话权限](../../plugins/ipollowork-suite/src/host/native-sharing.ts) | 可选的客户端桥接 `ipolloProjectConversationShare` 复用套件的 `remote.liveshareShares` 和 PKCE 连接流程。套件 Host 使用原生工作区注册表校验对话，再通过 `liveshareShares.create` 为指定账号创建只读且禁止分叉的分享。 | 确认选择成员本身不会创建分享，明确授权后用指定账号打开当前对话，并验证其他账号无法打开。检查名单标记、阻止只读接收人发送消息和分叉、撤销后的权限。 |

Design `1.0.0-beta.31` 已在固定的 DSH 版本上通过 Windows 隔离测试。客户端从 Design 的 8 类模板各选一个，由测试模型保存，再从对话文件卡片打开。另测了关闭预览期间保存新版，再从同一张卡片打开。

Design `1.0.0-beta.32` 在同一版本的 DSH 上使用测试模型验证了 38 页幻灯片。收起侧栏后，对话卡片可以重新打开 HTML。点击「在 Design 中编辑」修改标题后，原文件成功保存，仍为 38 页。

Design `1.0.0-beta.33` 将模板身份保存到原生 HTML 绑定，通过 `systemPrompt.context` 给模板会话补充上下文，并用 `tools/pre-execute` 阻止该会话调用 `present` 交付 Office 幻灯片或 PDF。桌面实测从 38 页模板发送「做个 PPT」，写回 HTML 后由对话卡片重新打开 Design。

Design `1.0.0-beta.34` 将 HTML 交付约束应用于所有已激活的 Design 文档，包括直接从导航打开的文档。`surface.tsx` 等待鉴权后的 `/document` 继续编辑操作完成，再打开原生对话与右侧面板。会话级动态 `systemPrompt.section` 和必需的 `systemPrompt.context` 在关闭可选上下文时仍保留当前文件；`tools/pre-execute` 先恢复持久化绑定，再检查 `present`。升级时分别验证直接打开和使用模板，覆盖编辑器首次加载、已创建的 Agent 和插件重启。两条链路均先尝试返回 PPTX，再交付 HTML，由原生文件卡片重新打开并将编辑保存到同一个 HTML 文件。独立插件仓库的 CI 在 macOS 和 Windows 上运行该已安装归档的浏览器回归。

2026 年 11 月 19 日，同一份 beta.34 归档（`a17735f6e7f7e86680e0bacdecc6113baa19dacf41928691831ba50d8c6485fc`）在 Windows 和 [macOS](https://github.com/Devin-AXIS/deepseek-design/actions/runs/44454238252) 上通过了两种对话入口的回归。测试模型先尝试返回 PPTX，再写入并交付 HTML；原生文件卡片能重新打开 Design，手动编辑保存到同一个文件，模板保留全部 38 页。Windows 还通过了 Design/Video 同时安装的验证，现有开发配置已通过原生管理器更新并启用。macOS 验证使用原生 DSH Host 和浏览器，未操作用户已有的 Electron 安装版；该安装版仍需更新插件。两端的构建、类型检查和全部 129 项源码测试均通过。较大范围的 Linux Video 安装冒烟遇到了外部 GPU 依赖下载失败。

## 更新和验证

组织 MCP 同步直接调用已鉴权的授权目录，不再依赖额外的会话及积分查询。保留账号服务的安全错误码，以区分连接超时、登录失效与目录同步失败。验证已登录时仅请求目录、退出时不发出网络请求，以及目录故障时撤回连接。

组织 MCP 代理保留上游 4xx 状态和 `mcp-method`、`mcp-name` 协议头。当前 pin 的 MCP SDK 会先发送 `server/discover`；2025 协议服务器拒绝探测时，客户端需要依据原始 4xx 回退到 `initialize`，不能将其改写成 503。认证失败、权限不足和限流使用脱敏的独立错误码，上游错误正文不外发。升级 pin 时验证原生协议探测、旧版握手、工具列表、会话失效，以及 401/403/429 和上游正文脱敏。

Suite `0.1.36` 与 Design `1.0.0-beta.35` 通过可选客户端服务 `ipolloDesignTemplates` 注册组织模板来源。Cordis 注入与释放控制组织空间的模板页，账号凭证变化时清理旧账号来源。元数据来自已鉴权的账号目录；使用模板先重新校验指定版本的权限，再通过 `/document` 和带版本校验的 `/file` 创建新的 Design 文档。验证停用/启用 Design、不同授权的成员、撤权、切换账号，以及生成 HTML 后继续编辑。组织凭证不传递给 Design。

Design `1.0.0-beta.38` 的 `ipolloDesignTemplates` 目录要求清单版本符合 SemVer 格式。Suite 的 `src/host/enterprise.ts` 为其他发布标签生成稳定别名，`src/client/organization-templates.ts` 在鉴权读取时查找对应的原始标签，切换账号时清除映射。升级时验证名为 `设计验收` 的版本与数字版本同时出现在 Design 原生模板库，并可应用到工作区。

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

## 2026-11-20：发行版账号配置

Suite 0.1.41 和桌面组合保留部署选择的账号来源。应用所有权检查仍依据 `profileContext.installAnchor` 和 `@ipollo/desktop-runtime` 包身份，继续要求桌面必需界面，但不再覆盖 accountOrigin。`integrations/tooling/account-service.mjs`、`desktop-composition.mjs` 及平台/预设环境加载器把公开来源写入原生 application.yml，官方 Include 与 runProfile 分层保持生效。Suite 通过包导出读取发货的 deployment.json，包含嵌套打包入口。下次升级复验文件/预设/单次覆盖优先级、显式旧域名、HTTPS 拒绝、严格来源凭据隔离和真实归档安装。本次 83 项桌面配置/覆盖测试通过；Suite 205 项通过、11 项可选跳过；原生 0.2.2-rc.3 实际安装 0.1.41 归档，并通过自定义回环账号服务完成登录/退出。没有修改官方运行时或 Client slot 行为。

2026 年 11 月 19 日，在当前固定版本的 DSH Web 中单独安装项目看板。使用原生工作区和会话记录，验证了看板位置、项目切换、打开原有对话、进度编辑和刷新保留，并检查了 390 与 1200 像素下的浅色、深色及四个视图。

同一固定版本下，0.2.1 将看板移入原生对话标签。DSH Web 验证了「对话」页面、卡片跳转、升级后保留进度、项目切换，以及 390 和 1200 像素浅色和深色下的看板标签与四个视图。

0.2.2 验证了看板隐藏 DSH 输入区、切回对话后保留草稿。另用真实 iPolloWork 账号 API 和隔离的 PostgreSQL 验证组织指派、拒绝组织外成员和错误项目归属、个人项目省略负责人，以及 390 和 1200 像素下的两种主题。

0.3.0 在相同的 DSH Web 固定版本和隔离 PostgreSQL 账号服务中验证。原生界面检查了新增任务、任务详情、聊天草稿恢复、第二账号接收指派、接收人修改进度和前置任务解锁。测试会话通过原生定时服务向测试模型投递任务，模型调用 `ipollo_project_tasks` 完成看板任务。四个视图及弹窗均在 390 和 1200 像素下检查了两种主题。

0.3.1 验证了选取已启用的套件专员作为负责人，混选人员和 AI 参与人，以及「保存并交给 AI」。原生子 Agent 读取原项目的任务并向父会话回传结果。另一登录账号可读取共享任务，调用指派账号的专员时会被拒绝。单独安装插件也验证了新增个人任务、分配给当前对话 AI 并重新打开详情。

0.4.0 在 390 和 1200 像素的浅色与深色客户端中检查了看板和任务侧栏。实际流程验证了任务搜索、按列新增、快捷修改状态、键鼠选择、跨账号通知及原生专员委派和定时执行。项目归属和邀请入口复用套件的组织弹窗。验证过程生成项目邀请链接，拒绝错误邮箱，由受邀账号接受，确认该账号无权进入另一受限项目，然后指派新加入的成员。看板选中时使用对话视图的内容层，位于原生聊天宽度拖动条之上。

当前固定版本的 DSH Web 已使用账号服务和两个浏览器账号验证 0.4.1 归档。390 像素宽度的两种主题都正常显示姓名和邮箱。指定账号在明确授权后可查看原对话，其他账号被拒绝，转发服务禁止发送消息和分叉，撤销时名单权限标记消失。

已在原生 DSH Web 中以 1200 和 390 像素宽度、两种主题验证 0.4.3。通过现有对话插槽显示紧凑卡片和磨砂任务详情，并检查了键盘焦点和短屏内独立滚动。使用隔离账号服务验证人和 AI 共用协作名单、更换负责人后原负责人转为参与人，以及保存和刷新后的角色。

0.4.4 看板读取账号通讯录中的既有头像，以及套件智能体中已上传的头像。智能体照片路由使用 DSH 所有者准入与同源按需加载。验证实际头像、缺失或加载失败时的圆形首字、所有者准入，以及两种主题中的浅磨砂与日历细网格。

0.4.5 看板样式使用现有 DSH 对话插槽和浏览器原生模态顶层，模糊任务详情背后的看板。当前固定版本的 DSH Web 已在 1200 和 390 像素下验证两种主题的磨砂效果、统一按钮圆角、按键浮起和下压状态，以及圆形头像。减少透明度模式下使用实色详情，减少动态效果模式下按钮无位移。

0.4.6 归档已在原生对话视图中验证英文字母占位、更大的圆形头像和更小的字母。中文姓名采用支持姓氏读音的拼音转换。在 1200 和 390 像素的两种主题中，选择器保留成员姓名和邮箱，头像使用对应的首字母。

0.4.7 看板在 `plugins/collaboration-board/src/host.ts` 通过 `subagents.getProvider` 和 `tools.executable` 读取可选原生委派。打开「参与 AI」时刷新候选，原生对话从任务计划取得允许调用的工具名。升级固定版本时，验证两个官方包加载后显示、禁用后消失，已有任务能报告提供方不可用，且原生工具使用项目工作目录。当前 DSH Web 预览已在 1200 和 390 像素的两种主题验证两个官方选项，并在隔离配置中通过原生工具和确定性的测试提供方验证委派与禁用。

0.4.8 项目看板在 `plugins/collaboration-board/src/host.ts` 和 `src/schedule.ts` 使用可选的 Host `schedule` 服务。「待处理」任务由 AI 主负责且开始时间在未来时，保存使用 `ScheduleService.create` 按 `at` 类型注册一次定时，目标为原生对话。使用 `view` 和 `edit` 核对、改期和撤销。本地 `ipollo_project_board_schedule` 存储域保存定时 ID，以及工作区、账号和目标对话的执行校验。看板工具在模型开始工作前读取实时任务并校验进度版本。更新固定版本时，从实际看板保存并检查原生定时，验证重复保存、改期、自动触发原对话，以及有未完成前置的任务保持「待处理」。 0.4.8 归档在两个独立临时 DSH 配置中安装。使用确定性测试模型，从构建后的客户端验证了个人项目及 PostgreSQL 组织项目的自动启动与完成、重复保存、改期、取消和前置阻塞。定时提示在两种主题的 390 和 1200 像素宽度下均已检查。

独立通知中心 0.1.0 在 `plugins/notification-center/src/client.tsx` 使用原生 `sidebar.footer.action` 槽位。会话适配器读取 `sessions.list`、`workspaces.list` 和 `uiSession.sessionStatus`，通过 `mark` 提交已读，通过 `uiWorkspace.openSession` 打开原对话。项目看板 0.4.9 通过可选 Cordis 客户端服务 `ipolloNotificationCenter` 登记现有账号收件箱，用 `layout.selectPanel` 打开原 `main` 详情，并在中心缺失时保留 `sidebar.panellist` 独立入口。更新固定版本时，核对头像区域、折叠侧栏、多个来源的未读状态、失败会话样式、账号切换、已读转发、原详情导航和独立看板回退。 已在临时 DSH Web 配置中安装归档并验收，两种主题均覆盖 1200 和 390 像素，另验证了独立安装的紧凑侧栏、跨账号指派与确认、原生会话未读及失败提示、刷新和仅安装看板时的回退。

通知中心 0.1.1 沿用原生 `sidebar.footer.action` 注册，`plugins/notification-center/src/style.css` 根据相邻的 `data-slot="sidebar.footer.action"` 和 `data-slot="sidebar.settings"` 布局。展开侧栏且底部只有一个动作时，铃铛与账号放在同一行。紧凑侧栏和多个底部动作沿用原生布局。更新固定版本时，检查展开侧栏和窄屏抽屉内的头像与铃铛对齐，确认紧凑侧栏仍可操作，并验证两种主题下的弹层在视口范围内。 已验证两种主题的 1200 和 390 像素布局、紧凑侧栏的键盘操作，以及当前本地预览中的铃铛和弹层。

通知中心 0.1.3 在 `plugins/notification-center/src/host.ts` 声明来源开关，在 `src/client.tsx` 注册原生 `settings.section` 和 `settings.section.icon`。Host 通过 `settings.configure` 暴露插件条目下可即时生效的 `sourceEnabled` 字典，客户端用 `configForms.get` 读取已保存偏好，用 `mutate` 写入变化的来源键。更新固定版本时，从原生设置关闭各来源，验证列表及未读提示即时更新、刷新后开关保留，以及重新开启时原有未读通知恢复。 开发预览先卸载并重新选入该插件，使新增 Host Config 导出完成设置注册，再确认两个开关可操作。

组织空间在 `plugins/ipollowork-suite/src/client/enterprise.tsx` 观察可选 `ipolloNotificationCenter` 服务及 `ipollo.organization` 注册的生命周期，隐藏重复的页头铃铛，释放后恢复原入口。操作仍沿用 `EnterpriseController` 的授权与已读接口。通知中心使用原生 HTML popover 顶层、`--dsh-frame-top-clearance` 和限定高度的网格布局，让列表独立滚动。组织通知详情通过原生 Modal 的 `contentClassName` 提供滚动区域。更新固定版本时，验证来源可用状态、停用与重启回退、键盘关闭与焦点恢复、长列表与长文本在两种主题、窄屏和矮窗口中的显示，以及先授权打开详情再确认已读的顺序。

iPolloWork 套件 0.1.36 在 `plugins/ipollowork-suite/cordis.patch.yml` 将项目看板和通知中心注册为两个原生子插件。套件补丁以安装目录解析 Host 相对路径，`scripts/bundle-subplugins.mjs` 在各自的入口旁生成清单，供 DSH 发现对应浏览器模块。桌面组合生成器从同级 `@ipollo/desktop-host` 包重新定位两个入口。条目 ID、账号路由、看板存储域、定时任务 ID 和通知设置命名空间沿用原值。迁移早期开发配置时移除两个独立安装，只清除设置覆盖中的旧包名断言并以 ID 保留设置。升级固定版本时，只安装套件，在原生插件详情确认两个条目生效，并检查原有任务、排期、账号和通知偏好。已在打包后的 Web 客户端及当前开发预览验收升级。

iPolloWork 套件 0.1.41 保留两个原生子插件入口，并从看板打开组织现有的邀请码弹窗，默认选中参与权限。账号服务在数据库版本 20 运行看板迁移，保留本地看板预览版本 15 的任务及通知已读状态。在当前 DSH 固定版本中，隔离配置从套件 0.1.36 升级后保留了个人和组织任务、原生排期、账号及通知设置。实际构建的客户端验证了新增任务、组织邀请入口，以及两种主题下 390 px 宽度的四种看板视图。

Suite 0.1.42 在安装包生成的 `@ipollo/desktop-runtime` 清单记录公开字段 `ipolloworkAccountOrigin`。私有 Suite 依据 install-anchor 的安装清单选择服务来源，旧版清单回退发货 deployment.json；profile 中残留的地址不能覆盖发行版设置。企业打包仍可显式选择 HTTPS/本机测试地址，普通 DSH 插件继续支持 profile 配置。升级验证覆盖旧 localhost 地址、企业自定义发行版、非法来源拒绝及已安装 Mac 的真实登录。此条替代上文 0.1.41 允许 profile 覆盖私有桌面地址的行为。

### 组织空间工作流

项目看板归档恢复及全量搜索沿用 Suite `ipollowork.projectBoard` 桥接和已认证的账号路由（服务数据库版本 22）。`plugins/collaboration-board/src/host.ts`、`tasks.ts`、`reminders.ts` 通过公开 `storageDomain` 把 `ipollo_project_board` 从版本 2 升至 3，兼容 1/2，新增个人提醒表。原生 `schedules.entries()` 及所拥有定时的 `ended`／`paused` 状态支持每 15 秒检查延后启动。仅对已经投递、被前置任务阻塞的提醒，在原账号范围内用新投递校验值重新安排；队列中或手动暂停的提醒不重排。截止提醒沿用原有已授权的收件箱详情／已读路由及可选通知中心来源。下次更换固定版本时，用实际套件归档和独立配置验证版本 2 数据升级、归档／回收站／恢复、到期提醒重启已读状态、原生定时暂停和队列防重排、批量部分失败、超过 100 条任务的全量搜索，以及 390 px 下明暗主题的四个视图。账号服务单独复核接收权限并对截止提醒去重。

Suite `src/host/model-request-recovery.ts` 保持原生模型 `retryPolicy.maxRetries = 0`。有限重试只对收到响应头前的传输错误、`IPW_INVALID_RESPONSE`、准入拒绝及 `SERVICE_CALL_RUNNING` 复用同一 Suite 调用 ID，保留账号切换取消和未知结果保护。原生 `llm` 请求、`SuiteError` 映射及 `conversation.chat.node` 的 `turn-error` 入口保持权威。下次更换固定版本时运行原生模型上下文测试，覆盖 502、503、仍在执行的响应，确认调用 ID 唯一、收到响应头后不重放，以及具体错误的本地化提示，不改写历史聊天事件。

市场原生 `plugins.tab` 通过 `src/client/organization-market.tsx` 展示当前账号有权读取的组织插件发布记录。沿用 Suite 组织/发布接口及 `MarketInstallation.startManual`，由原生检查与安装进度接管安装。升级 pin 时复验组织切换、仅展示已发布版本、目录/版本读取中的账号切换、安装前撤权，以及原生安装弹窗；检查既有市场布局的明暗主题和窄容器。

`plugins/collaboration-board/src/client.tsx` 的项目看板继续使用 `conversation.view`、账号身份事件及 `projectBoardOwnershipEvent`。账号范围的取消信号同时覆盖任务分页、写入、对话授权及 `sessions.using`/`prompt` 交接；普通刷新不得中断「保存并交给 AI」。升级 pin 时复验在途写入或第二页读取时切换账号/归属、全部已加载页刷新、轮询错误提示和保存后的 AI 交接。生产组件隔离页验证了明暗主题下 1200/390 px 的四种视图，以及编辑、依赖解锁、拖拽、搜索、重试和键盘关闭；当前桌面验证了原生入口及视图。原生排期保护和 PostgreSQL 组织权限/通知另有隔离集成检查。

套件通过可选的 `ipolloNotificationCenter` 服务注册组织通知，并用既有 DSH `layout.selectPanel` 打开已授权的来源页面。组织页保留自身的通知入口。复验账号切换、单条已读、显式批量已读、资源或会话撤权以及定位到对应记录。模板管理可在未启用 Design 时使用，应用模板仍依赖既有 Design 集成。使用原生组织页复验分析、成员分页和文件包上传，并分别验证桌面端 `fileActions.save` 和 Web 下载。将桌面端与账号服务联测，并复验 PostgreSQL schema 21 迁移。
