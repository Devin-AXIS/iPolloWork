# 组件清单与成熟状态

核对日期：2026-10-09。基于当前工作区（含未提交修改），状态可随代码与证据更新。62 个目录条目包含组件状态与内容示例，不等于 62 个独立组件。

## Figma 入口

- [使用说明与交互规范](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=199-40)
- [01 已实现与推荐使用](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=198-1447)：62 个条目，推荐范围以逐项证据为限。
- [02 已实现待验证](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=198-1927)：本轮两个缺陷已通过回归；保留此页用于后续待验证条目。
- [03 设计候选与待接入](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=199-11)
- [04 历史与替代方案](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=199-31)
- [90 完整目录与组件源](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=4-25)

## 验证依据与边界

推荐条目有现有组件源码及控件级证据。证据按场景解释，不能推广为所有状态或所有业务链路已通过。

- `evals/results/2026-10-09T04-42-48-598Z/fraimz.html`：compact-controls；表格/Badge/Toggle/Tabs、Card/Empty、Dialog/AlertDialog/Sheet、Alert/Toast、Input/Button/Select、Popover/Tooltip、Progress。使用真实控件与隔离数据，Composer 和图片插件宿主传输有模拟。
- `evals/results/2026-10-09T05-20-06-840Z/fraimz.html`：真实客户端模型搜索、模板目录控件、对话查找、项目进度。
- `evals/results/2026-10-09T06-10-56-598Z/fraimz.html`：真实客户端帮助分类按钮及选中切换。
- 对应断言查看 `evals/flows/compact-controls.flow.mjs`、`shared-controls-client.flow.mjs`、`shared-buttons-host.flow.mjs`。以上是已有记录；本次补充验证见下节。

Input Error 已补齐错误触发、草稿保留、错误关联和修改重试；校验规则为隔离回调，不代表所有业务表单已验收。Badge 推荐视觉载体，不代表所有业务状态映射已统一。AlertDialog / ConfirmModal 推荐已测确认语义，不代表所有业务请求已验收。

Autocomplete 在 Command 内组合使用；HoverCard 在 Source 内组合使用；没有直接业务导入不能视为未使用。Avatar 暂未找到直接业务采用；本次推荐基于真实基础组件的图片成功与失败回退验证，不表示客户端已经采用。

## 36 条目补充验证 · 2026-10-09

结果：36 个条目的下列控件级场景通过。两个缺陷已修复并补齐回归，完整 12 步证据：`evals/results/2026-10-09T10-42-54-418Z/fraimz.html`。不得把控件级验证扩大为真实模型请求、真实文件读写或系统应用启动验收。

- 基础矩阵：`evals/results/2026-10-09T09-49-31-806Z/fraimz.html`，10 个步骤通过，含截图及可观察断言。真实源码控件，独立 Chrome 配置；数据、通知存储和操作回调隔离。桌面宽度 1280px、窄窗口 390px；亮暗主题；Dropdown / CommandDialog / NotificationCenter 窄浮层及移动侧栏边界。
- Message 默认组合：`evals/results/2026-10-09T09-50-30-392Z/fraimz.html`，前 10 步通过，默认长串边界断言 Failed。基础矩阵中的 MessageContent 使用调用方 `min-w-0` 仅隔离其它控件的布局检查，不算默认组合已修复。
- ChainOfThought 属性透传：`evals/results/2026-10-09T09-52-03-297Z/fraimz.html`，前 10 步通过，传入触发器的 `id` 未出现在实际 DOM，断言 Failed。
- 执行流：`evals/flows/component-validation-matrix.flow.mjs`；组件夹具：`evals/support/component-validation-matrix.jsx`，通过现有 `compact-controls-fixture.html?matrix=1` 入口加载，不创建应用路由。
- 应用类型检查通过；`notification-store.test.ts`、`video-artifact-entry.test.ts`、`composer-model-behavior-menu.test.ts` 共 36 个测试通过。单元测试不代替 UI 或外部服务链路证据。

| 条目 | 已验证范围 | 接入边界 |
| --- | --- | --- |
| Label、Input · Error | 标签聚焦、aria-invalid、错误描述关联、保留草稿、修改与重试清错 | 校验为夹具回调；业务异步校验需另测 |
| Textarea、SearchField | 多行值、禁用说明、过滤结果、空结果及清空恢复 | 不含远程搜索响应与竞态 |
| Checkbox、RadioGroup、Switch、Autocomplete | 空格或箭头选择、可访问选中值、禁用项、搜索与 Enter 选择 | Autocomplete 是可编辑输入，不要把输入变化回调误当提交动作 |
| Command Input、Command、CommandDialog | 搜索结果与空态、实际选项回调、弹窗聚焦、Escape 返回入口 | 业务执行在调用方；不代表命令实际完成 |
| DescriptiveButton、DropdownMenu、ContextMenu、ModelBehaviorMenu、LinkActionMenu、Modal Pattern | 键盘按钮执行、菜单禁用项与回调、模型行为选择、链接预览分发、取消不执行及明确确认 | 模型目录请求、OS 打开/Reveal、业务确认请求未在本次调用；Panel/Preview 为隔离回调 |
| Avatar、Image、Source、HoverCard | 头像可用与失败回退、图片占位及长图展开/收起、键盘聚焦浮层、来源安全链接、长内容布局 | 不含图片损坏后的自动重试；来源内容图标依赖远端；Avatar 暂无直接业务采用记录 |
| Tool、Tool Status、Skeleton、ModelLoadingStatus | 运行指示、错误文本与输入保留、成功输出、展开详情、加载语义、结果就绪后移除占位 | 使用隔离工具结果和目录数据，不代表连接成功；加载阶段不是服务端真实进度 |
| Accordion、Collapsible、Sidebar、PanelTabs、Resizable、ScrollArea、Separator | 键盘展开、桌面折叠/移动侧栏、面板切换与关闭、键盘分栏、滚动、语义分隔及窄布局 | 本次不含 PanelTabs 拖动排序；Sidebar 未保存用户偏好 |
| Artifact、NotificationCenter | 产物空态与入口回调、通知空态/未读/读取、亮暗窄浮层；相关路由和存储单元测试 | 真实文件重命名/下载、引擎重载、市场安装及跨客户端同步需对应业务 flow |

已修复缺陷及边界：

- **Message**：公共 MessageContent 默认添加 `min-w-0`，夹具不再由调用方补类；亮暗窄窗口和默认连续长串边界通过。
- **ChainOfThought**：当前 Base UI 默认触发器取出 `id` 后未用于默认元素；本地封装已透传 props。本次通过默认 render 元素保留 ID；自定义 data 属性、可访问禁用语义和禁用时 Enter/Space 不展开均通过。调用方自定义 render 仍由调用方负责元素属性。

复现：独立浏览器打开本仓库 Vite 的 `/@fs/<仓库绝对路径>/evals/support/compact-controls-fixture.html?matrix=1`，然后运行 `pnpm fraimz --flow component-validation-matrix --cdp-url <独立浏览器CDP>`。加 `IPOLLOWORK_MATRIX_DEFAULT_MESSAGE=1` 或 `IPOLLOWORK_MATRIX_THOUGHT_PROPS=1` 可执行相应失败回归。不要连接日常用户浏览器配置执行隔离通知测试。

## 源码映射

所有路径相对于仓库根目录。宿主 React 可直接复用；独立插件工作区使用相同语义并按插件接入契约实现。

| 条目 | 状态 | 代码位置 | Figma 原始条目 |
| --- | --- | --- | --- |
| Table | 推荐 | `apps/app/src/components/ui/table.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1196) |
| Card | 推荐 | `apps/app/src/components/ui/card.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1185) |
| Card Content | 推荐 | `apps/app/src/components/ui/card.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1308) |
| Avatar | 推荐 | `apps/app/src/components/ui/avatar.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1219) |
| Image | 推荐 | `apps/app/src/components/ui/image.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1233) |
| Message | 推荐 | `apps/app/src/components/ui/message.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1244) |
| Source | 推荐 | `apps/app/src/components/ui/source.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1254) |
| Tool | 推荐 | `apps/app/src/components/ui/tool.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1266) |
| ChainOfThought | 推荐 | `apps/app/src/components/ui/chain-of-thought.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1276) |
| Artifact | 推荐 | `apps/app/src/components/chat/artifact.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1297) |
| Label | 推荐 | `apps/app/src/components/ui/label.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-532) |
| Field | 推荐 | `apps/app/src/components/ui/field.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-540) |
| Input · Default | 推荐 | `apps/app/src/components/ui/input.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-549) |
| Input · Focus | 推荐 | `apps/app/src/components/ui/input.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-557) |
| Input · Error | 推荐 | `apps/app/src/components/ui/input.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-566) |
| Input · Disabled | 推荐 | `apps/app/src/components/ui/input.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-575) |
| InputGroup | 推荐 | `apps/app/src/components/ui/input-group.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-591) |
| SearchField | 推荐 | `apps/app/src/react-app/domains/settings/settings-list.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=66-1391) |
| Textarea | 推荐 | `apps/app/src/components/ui/textarea.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-583) |
| Select | 推荐 | `apps/app/src/components/ui/select.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-637) |
| Autocomplete | 推荐 | `apps/app/src/components/ui/autocomplete.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-653) |
| Command Input | 推荐 | `apps/app/src/components/ui/command.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-693) |
| ModelBehaviorMenu | 推荐 | `apps/app/src/components/model-behavior-menu.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-793) |
| Checkbox | 推荐 | `apps/app/src/components/ui/checkbox.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-600) |
| RadioGroup | 推荐 | `apps/app/src/components/ui/radio-group.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-612) |
| Switch | 推荐 | `apps/app/src/components/ui/switch.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-624) |
| Toggle | 推荐 | `apps/app/src/components/ui/toggle.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-668) |
| ToggleGroup | 推荐 | `apps/app/src/components/ui/toggle-group.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-680) |
| Button | 推荐 | `apps/app/src/components/ui/button.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-711) |
| DescriptiveButton | 推荐 | `apps/app/src/components/descriptive-button.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-726) |
| DropdownMenu | 推荐 | `apps/app/src/components/ui/dropdown-menu.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-737) |
| ContextMenu | 推荐 | `apps/app/src/components/ui/context-menu.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-756) |
| Command | 推荐 | `apps/app/src/components/ui/command.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-776) |
| LinkActionMenu | 推荐 | `apps/app/src/components/markdown/link-action-menu.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-812) |
| Dialog | 推荐 | `apps/app/src/components/ui/dialog.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-832) |
| AlertDialog | 推荐 | `apps/app/src/components/ui/alert-dialog.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-846) |
| Sheet | 推荐 | `apps/app/src/components/ui/sheet.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-860) |
| CommandDialog | 推荐 | `apps/app/src/components/ui/command.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-905) |
| Modal Pattern | 推荐 | `apps/app/src/react-app/design-system/modals/confirm-modal.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-919) |
| Popover | 推荐 | `apps/app/src/components/ui/popover.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-874) |
| HoverCard | 推荐 | `apps/app/src/components/ui/hover-card.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-885) |
| Tooltip | 推荐 | `apps/app/src/components/ui/tooltip.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-895) |
| Alert · Info | 推荐 | `apps/app/src/components/ui/alert.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-936) |
| Alert · Success | 推荐 | `apps/app/src/components/ui/alert.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-946) |
| Alert · Warning | 推荐 | `apps/app/src/components/ui/alert.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-956) |
| Alert · Error | 推荐 | `apps/app/src/components/ui/alert.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-966) |
| Toast / Sonner | 推荐 | `apps/app/src/components/ui/sonner.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-977) |
| NotificationCenter | 推荐 | `apps/app/src/react-app/shell/notification-center.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1030) |
| Badge / Status | 推荐 | `apps/app/src/components/ui/badge.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-987) |
| Progress | 推荐 | `apps/app/src/components/ui/progress.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1001) |
| Skeleton | 推荐 | `apps/app/src/components/ui/skeleton.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1011) |
| Empty | 推荐 | `apps/app/src/components/ui/empty.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1020) |
| ModelLoadingStatus | 推荐 | `apps/app/src/components/model-directory-loading-status.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1040) |
| Tool Status | 推荐 | `apps/app/src/components/ui/tool.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1050) |
| Tabs | 推荐 | `apps/app/src/components/ui/tabs.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1063) |
| Accordion | 推荐 | `apps/app/src/components/ui/accordion.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1076) |
| Collapsible | 推荐 | `apps/app/src/components/ui/collapsible.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1097) |
| Sidebar | 推荐 | `apps/app/src/components/ui/sidebar.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1118) |
| PanelTabs | 推荐 | `apps/app/src/components/panel-tabs.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1138) |
| Resizable | 推荐 | `apps/app/src/components/ui/resizable.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1151) |
| ScrollArea | 推荐 | `apps/app/src/components/ui/scroll-area.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1162) |
| Separator | 推荐 | `apps/app/src/components/ui/separator.tsx` | [预览](https://www.figma.com/design/kpx32oBzY6ecHJZX11mAvr?node-id=6-1173) |

## 业务复合模式

Composer、附件项、预览四态、属性参数、工作项表单及日期时间是场景组合，按实际能力复用。参考原稿的章节 13、14、15、17 和相应业务源码；不要把 Figma 中的组合展示误称为独立导出的公共组件。Composer 排队验证包含模拟传输；AI 标记与悬浮工具的能力有工作区边界。

## 候选与历史

候选：统一上传恢复；表格排序/筛选/分页/批量操作；通用日期时间选择；独立插件 UI Token 与控件复用契约。Figma 本页提供待接入需求，不声称已存在通用实现。

历史：SelectMenu 已在当前工作区删除，使用 Select；TextInput 仍为兼容封装，新普通表单组合 Field + Input。原审计稿泛称“已完成”的状态不能替代用户验收语义。
