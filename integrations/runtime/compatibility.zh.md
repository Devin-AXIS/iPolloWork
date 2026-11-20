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
| [插件组合](../../plugins/ipollowork-suite/cordis.patch.yml)、[Studio 市场](../../plugins/ipollowork-suite/catalog/index.json)与[桌面资源打包](../desktop/scripts/prepare-dsh.ts) | Cordis 插入项和依赖、原生插件加载器、DSH ASAR 布局、Host/CLI 启动入口和电脑操作资源路径。官网安装包和 Office 回退在产品打包层。 | 用各平台打包客户端验证启动、市场按需安装、打开已有 Design/Video 项目、Office 打开和电脑操作辅助程序。 |
| [Stage 桌面插件](../../plugins/stage) | `main`、`sidebar.panellist`、`plugins.bundle.config`、Host 连接准入、`workspaceRegistry`、`tools` 和 `sandboxPolicy`。桌面组合包含 Stage Bundle。 | 验证手动打开、关联与解除关联、每个工作区授权及只读限制。换账号后重新授权工作区。 |
| [项目看板](../../plugins/collaboration-board) | `plugins/collaboration-board/src/client.tsx` 使用 `conversation.view`、`main`、`sidebar.panellist`、工作区及会话快照、`uiWorkspace.openSession`、`sessions.using` 和原生会话 `prompt`、输入区标记 `data-conversation-scroll` 和 `data-conversation-region="composer"`。`src/host.ts` 使用所有者准入、兼容 v1 的 v2 存储域、`tools` 注册表及 `sandboxPolicy`。浏览器归档通过客户端加载器使用 `@deepseek-ai/dsh-client-ui-primitives` 的图标。套件 Host 提供按账号授权的看板桥接。「智能体」服务通过原生 Agent preset 解析候选，项目会话使用 `ipollo_delegate` 创建专员子会话。Host 使用 `subagents.rootOf` 将该子会话的只读查阅限制在原项目。 | 在临时配置中安装归档，从状态列新增任务，打开任务详情侧栏，使用可搜索的选择器，从卡片修改状态，切换项目并刷新，确认返回对话时保留草稿。使用第二个账号验证指派通知和前置任务解锁。验证 `ipollo_project_tasks` 只使用原生会话所属项目，拒绝跨项目访问及提前开始，并检查专员委派及回传、原生定时、两种主题和窄屏。 |
| [项目看板的对话权限](../../plugins/ipollowork-suite/src/host/native-sharing.ts) | 可选的客户端桥接 `ipolloProjectConversationShare` 复用套件的 `remote.liveshareShares` 和 PKCE 连接流程。套件 Host 使用原生工作区注册表校验对话，再通过 `liveshareShares.create` 为指定账号创建只读且禁止分叉的分享。 | 确认选择成员本身不会创建分享，明确授权后用指定账号打开当前对话，并验证其他账号无法打开。检查名单标记、阻止只读接收人发送消息和分叉、撤销后的权限。 |

## 更新和验证

1. 修改涉及 DSH 的功能时，同步更新本记录的中英文版本。记录产品入口、使用的 DSH 接口或选择器、验证方式，以及已验证的 DSH 版本。上游实现接替本地适配后，记录移除原因和首次验证的版本。
2. 在新工作树评估候选 DSH。同步更新固定记录、依赖清单和锁文件，使用候选版本自己的源码和产物。优先使用上游公开的扩展点与类型。可选能力通过宿主能力检测接入；遇到缺失的必要接口时，在采用新 pin 前完成适配和验证。
3. 在仓库根目录运行 `npm run setup:build`、`npm test`、`npm run check:upstream` 和 `npm run check:docs`。执行受影响套件的构建、类型检查和测试。插件 RPC 和会话归档类型由 DSH 提供，DOM、运行时事件和打包资源仍需实际验证。
4. 按[桌面验证说明](../desktop/tests/README.zh.md)用隔离 profile 跑上表受影响的流程，记录候选源码提交、平台、测试结果和未覆盖项。当前 pin 的测试通过只证明当前版本。

## 最近验证

2026-11-17，Windows Electron 开发版使用当前 pin 和已有登录会话，成功打开组织 MCP 列表及共享表单。迁移和授权回归使用隔离 PostgreSQL，覆盖从业务 schema `11` 升到 `13`、原组织与登录会话保留、管理员共享及撤销。桌面端共 19 项相关回归通过。真实第三方 MCP 的连接和调用需要配置服务后验证。

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

iPolloWork 套件 0.1.36 在 `plugins/ipollowork-suite/cordis.patch.yml` 将项目看板和通知中心注册为两个原生子插件。套件补丁以安装目录解析 Host 相对路径，`scripts/bundle-subplugins.mjs` 在各自的入口旁生成清单，供 DSH 发现对应浏览器模块。桌面组合生成器从同级 `@ipollo/desktop-host` 包重新定位两个入口。条目 ID、账号路由、看板存储域、定时任务 ID 和通知设置命名空间沿用原值。迁移早期开发配置时移除两个独立安装，只清除设置覆盖中的旧包名断言并以 ID 保留设置。升级固定版本时，只安装套件，在原生插件详情确认两个条目生效，并检查原有任务、排期、账号和通知偏好。已在打包后的 Web 客户端及当前开发预览验收升级。
