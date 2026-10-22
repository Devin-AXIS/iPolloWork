# 组件清单与成熟状态

核对日期：2026-10-14。基于当前工作区（含未提交修改）；不是发布记录。Figma推荐页的62个目录条目包含状态与内容示例，不等于公共组件数量。当前core汇总43个模块；顶层组件、子组件、变体与设计条目分别计数，不混算。

## 当前状态 · 五个独立维度

“推荐”是选型建议，不代表下面五项全部完成。未记录证据的状态保持待核对，不能由一次挂载或单元测试升级为全状态验收。

| 维度 | 判断依据 | 当前边界 |
| --- | --- | --- |
| 代码可用 | core/单模块公开导出、类型与映射检查 | 基础控件、日期/上传、表格组合已有公共实现；宿主私有组合不自动公开 |
| 业务采用 | 实际调用方与数据/回调依赖 | 日期、上传、搜索、表格等有采用记录；每个组件是否采用须按调用方确认 |
| 设计对齐 | Figma主组件/变量身份及状态视觉 | 映射为null表示身份未核对，不表示没有代码；身份有记录不等于全部实例视觉对齐 |
| 交互验收 | 注明场景、主题、容器、键盘、异步与恢复的fraimz | 历史证据只覆盖注明范围；未测状态保持Incomplete |
| 发布验证 | 打包客户端、插件安装/升级、版本拒绝 | 本地实现不等于已发布；签名上传及跨客户端升级仍待验证 |

保留旧证据日期和失败记录，不用当前实现改写历史结论。固定验收矩阵与可执行入口见共享包README。

### P0收敛与当前证据 · 2026-10-14

- 工作台主属性标签与动画子标签复用共享Button，取消硬编码深色选中样式、单独字号及按下缩放；保留专业画布/时间轴布局。
- 展开脚本时属性容器隐藏且inert，避免被遮挡控件仍可聚焦；收起恢复原页签和交互，脚本值不变。
- Studio隔离矩阵28帧：六个标签 × 明暗 × 1440/900px，以及四组脚本展开/收起；共同首模块padding为12px，选中按钮28px/13px。五个镜头来自内存，内容写请求被拦截。证据：`evals/results/2026-10-14T05-38-24-108Z/fraimz.html`。
- 公共核心与异步反馈两模式回归通过：表单/菜单/浮层、明暗窄屏、关闭/焦点，以及刷新保留、失败/空态和同文件重试；声音和素材是真实业务组件配隔离响应。证据：`evals/results/2026-10-14T05-42-17-232Z/fraimz.html`。
- 本轮未核对实时Figma、未走查原生Electron宿主与Studio叠层的完整集成，也未验证真实云端生成/保存或打包发布。这些维度保持Incomplete，不能由以上隔离证据自动晋升。

## 共享包可调用范围 · 2026-10-10

设计成熟度与插件公共可用性分开记录：下表实现已本地整合到 Carrie，未提交、推送或发布。原目录中的宿主路径保留为兼容入口，迁入实现的真实位置及包入口见 `component-mapping.json`。组件样板与真实业务页面的验收范围分别记录。

| 核心范围 | 共享公共组件 |
| --- | --- |
| 输入与选择 | Label、Field、Input、InputGroup、Textarea、Select、Autocomplete、Checkbox、RadioGroup、Switch、Toggle、ToggleGroup |
| 动作与菜单 | Icon（运行时1.4，32个Lucide公共名字）、Button、DescriptiveButton、DropdownMenu、ContextMenu、Command（含 CommandInput / CommandDialog） |
| 浮层 | Dialog、AlertDialog、Sheet、Popover、HoverCard、Tooltip |
| 反馈与状态 | Alert（Info/Success/Warning/Error）、Toaster/toast、Badge、Progress、Skeleton、Empty |

Alert / Toast 已统一为无边框的语义浅背景；主组件、完整目录与推荐页实例同步，其他状态页无这五个组件的实例。2026-10-13 警告背景改为 project-dialog-notice 浅暖灰（Light #F4F4EE / Dark gray-3），Figma 原有警告背景变量同步，组件与变量 ID 不变。警告图标保留语义强调，信息、成功、错误底色不变。Alert 四种设计身份及对应 variant 已记录在 `component-mapping.json`，主题 Token 与迁移边界见 `plugin-contract.md` 的“反馈样式与迁移”。NotificationCenter 仍是宿主私有组合，本次保留其既有浅背景参考，不把它误标为公共导出。

2026-10-10 用户截图修正：反馈背景减淡到palette第2档；模板操作32px、筛选触发器复用共享Button；设置按钮装饰不占flex间距，选中尺寸稳定；Dialog关闭统一28px点击区/16px图标。真实客户端8帧证据 `evals/results/2026-10-10T05-21-04-298Z/fraimz.html`，两种运行模式12帧证据 `evals/results/2026-10-10T05-18-34-476Z/fraimz.html`；这是所测页面与状态的证明，不是全客户端视觉验收。
| 数据与布局 | Table、Card（含 CardContent）、Avatar、Image、Tabs、Accordion、Collapsible、ScrollArea、Separator |

上述基础能力统一由 `@ipollowork/ui/core` 和单模块入口提供；运行时1.8.0提供同源值导出，含后续日期、上传和表格组合。单一实现，不另写插件版控件。`shared-ui-core.test.ts` 检查映射、模块数量和状态维度，`shared-ui-core.flow.mjs` 驱动两种加载模式的核心调用样板；样板回调隔离，不代表真实业务服务验收或所有组件全部状态已通过。

以下推荐条目仍没有独立插件公共组件：ModelBehaviorMenu、LinkActionMenu、ConfirmModal、NotificationCenter、ModelLoadingStatus、Tool/Tool Status、Message、Source、ChainOfThought、Artifact、Sidebar、PanelTabs、Resizable。不能让插件直接引用这些宿主私有路径；ConfirmModal可先按共享基础组件组合，但不能声称已公开同名API。需继续提取数据/回调依赖或迁入纯组件，补齐类型与两模式验证。

新增映射记录目录条目和真实源码；未核对 Figma 主组件身份的项目保留 `figmaMainId: null`。代码导出、设计身份与交互验收是三种不同状态。

## 高频控件补齐 · 2026-10-12

2026-10-12 真实客户端表格接入：工作中心保留看板/日程并新增列表，复用已加载（上限1,000条）查询，支持名称/更新时间排序、状态和名称组合筛选、分页、跨页选择及版本化批量状态更新。执行绑定和启用自动执行的记录保留原生命周期入口，不参与批量改状态。环境变量复用原数据接口、遮罩值与应用变更流程，支持名称搜索/排序、分页及列明名称的批量删除确认；两处均保留刷新前内容、限制5个并发写入并只保留失败项重试。真实业务组件与HTTP客户端的10帧隔离响应证据：`evals/results/2026-10-12T06-02-08-850Z/fraimz.html`；实际服务端接口另以临时存储测试。没有对用户日常数据执行写入，不代表真实用户数据上的破坏性操作或原生桌面窗口全链路验收。

公共运行时 1.6 新增六组：SearchField、NumberField、Slider、Calendar、DatePicker（含 TimeInput）、FileUpload（含 FileUploadItem）。统一32px控件、13px字体与共享主题；NumberField/Slider复用Base UI，日历复用DayPicker。输入附件/按钮组合参考shadcn/ui Base InputGroup，不引入第二套视觉系统。

真实接入：设置搜索、插件自定义比例、模板数值滑杆、任务日期、数字人图片上传。日期保存本地年月日；任务时间菜单保持原15分钟步长。上传校验为空文件/类型/大小；失败保留文件重试，仅调用方提供真实进度或取消回调时显示相应功能。专业时间轴、画布和属性布局不改。

验证：`evals/results/2026-10-12T04-30-25-419Z/fraimz.html`，两种运行时和宿主搜索/日期/上传交互通过。上传传输为模拟HTTP响应，保存回调为隔离数据，不表示真实服务器写入验收。Figma主组件身份未核对，映射保持null。新增控件需最低minor6。

## 资源卡代码扩展 · runtime 1.8

Card原default/outline保留；新增 `variant="resource"` 与CardIcon/CardMeta，CardTitle支持as=h3，最低minor8。resource正式提供surface=plain无边框款（默认透明、hover浅灰）与surface=outline描边款（默认值，hover强调边框），均无投影、12px圆角、16pxpadding、12pxgap；既有槽无额外内距，标题/说明/meta为sans 14/20/600、12/18/400、11/16/400，图标32px透明对齐槽，内部Logo为24px、Lucide笔画1.5px。可用layout=row紧凑行（默认stack）：图标/名称/一句说明优先，操作在右侧或空间不足时右下；不强制meta块和高度。实际调用与Props见共享包README。

此条仅记录公共代码扩展：沿用Card模块与历史身份，不修改或确认新Figma主组件。业务采用、两模式明暗/窄屏/字体/焦点验收、打包发布各自记录，不能继承历史Card样板的Passed。`shared-ui-core-fixture.mjs`包含default/outline/resource对照；required列明新槽并校验最低minor8。

## Figma 状态页

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

2026-10-12 表格组合：在既有 `/table` 和 core 导出 TableSortHead、TablePagination、TablePageSelection、TableBulkActions，运行时最低minor7。受控排序/分页/选择；筛选复用 SearchField/Select；确认复用 AlertDialog。紧凑13px文字、32px分页和表头操作，旧Table默认样式不变。开发样板以23条完整隔离数据演示先排序筛选后分页、跨页选择、筛选重置选择、取消不执行、部分失败仅重试失败项，以及失败页保留上一页。无真实服务或卡片列表迁移、无新依赖；Figma身份未在本轮核对。16帧证据：`evals/results/2026-10-12T05-18-08-985Z/fraimz.html`。


2026-10-12 异步反馈：复用 Skeleton、Empty、Alert/AlertAction、Button、FileUploadItem；无新增公共 API 或依赖。声音列表刷新保留已确认数据，失败就地重试且不误报空列表；分镜素材导入保留搜索、草稿和同一 File，重试成功才更新素材。数字人图片上传复用上一批恢复规则。模拟延迟/失败由现有夹具显式提供，不代表真实云端收费或写盘验收；完整规则见共享包 README。当前客户端源码11帧证据：`evals/results/2026-10-12T05-01-28-249Z/fraimz.html`。


2026-10-12 标准组合补齐：复用现有 Field / InputGroup / Button / Popover / DropdownMenu，不新增独立组合 API、依赖或运行时能力。1.6.1 修正多行附件聚焦和字段窄容器边界。示例与调用规则见 `packages/ui/README.md`；可执行流程 `shared-ui-compositions.flow.mjs` 分别验证两种运行时及实际声音、数字人、分镜和插件库入口。输入与菜单业务行为仍由调用方拥有，插件库目录数据、视频云端与分镜保存回调隔离，不代表真实安装/付费生成/保存已验收。Figma 未在本轮更新。当前客户端源码12帧证明：`evals/results/2026-10-12T04-47-29-594Z/fraimz.html`。


Composer、附件项、预览四态、属性参数、工作项表单及日期时间是场景组合，按实际能力复用。参考原稿的章节 13、14、15、17 和相应业务源码；不要把 Figma 中的组合展示误称为独立导出的公共组件。Composer 排队验证包含模拟传输；AI 标记与悬浮工具的能力有工作区边界。

## 候选与历史

待扩展/待验收：全客户端上传恢复覆盖、日期范围与多日期的完整状态验收、更多表格业务接入、页面级字体收敛及完整Figma文字样式对照。DatePicker/TimeInput和受控表格组合已有公共实现及采用记录，不再列为“未实现候选”。独立插件Token与控件契约亦已有实现，见 `plugin-contract.md`。Figma候选页是历史需求快照，不替代当前代码状态。

历史：SelectMenu 已在当前工作区删除，使用 Select；TextInput 仍为兼容封装，新普通表单组合 Field + Input。原审计稿泛称“已完成”的状态不能替代用户验收语义。
