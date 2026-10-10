# 插件工作区接入契约

适用于独立 HTML、iframe 和插件自己的 React 构建。核对日期：2026-10-10。

## 公共入口 · v1

以下入口按实际 `packages/ui/package.json` 的 exports 核对。`@ipollowork/ui` 是仓库私有 workspace 包，样板通过 `devDependencies: { "@ipollowork/ui": "workspace:*" }` 引用；没有对外发布 SDK。仓库外插件不能假定公共包管理器已有此包。

| 使用方 | 固定入口 | 支持范围 |
| --- | --- | --- |
| 宿主 React | `@/components/ui/button`、`input`、`textarea` | 原入口兼容重导出；不要强制业务调用方迁移私有路径 |
| 共享源码消费者 | `@ipollowork/ui/core` 或单模块入口 | 全部已迁移基础组件及 TypeScript Props；`controls` 继续兼容 Button、Input、Textarea |
| 共享浮层与反馈 | `@ipollowork/ui/select`、`dialog`、`sonner` | 原宿主组件同源实现；宿主原入口保留翻译、主题适配。iframe 业务仍从运行时对象取得组件，不静态导入实现 |
| iframe 插件业务脚本 | `@ipollowork/ui/runtime-contract` | `requireRuntime(major = 1, required = [])`；轻量主版本和函数能力检查，不导入 React |
| 宿主/插件的 Node 构建脚本 | `@ipollowork/ui/build-plugin-runtime` | `buildPluginRuntime('host' \| 'bundled') → { script, dependencies }`；不是浏览器接口 |
| 主题构建 | `@ipollowork/ui/palette.css`、`tokens.css`、`theme.css` | 共同 Token 源；单独导入不等于已有完整控件样式 |

`@ipollowork/ui/plugin-runtime` 虽然在 exports 中存在，但属于运行时安装实现入口，不作为插件业务脚本的接法；导入它可能把 React/ReactDOM 带入插件包。`@ipollowork/ui/react` 仍是 Paper 等现有组件入口，不能拿它替代 `controls`。不深导入 `packages/ui/src/*`、宿主领域内部代码或 Vite virtual 模块。

`requireRuntime(1)` 返回 `window.ipolloworkUi`。原v1对象的 `version`、`mode`、`React`、`createRoot`、`Button`、`Input`、`Textarea`、`enhance`、`observe` 保持兼容。1.1新增 Select、Dialog、Toaster/toast；1.2 扩展到 `packages/ui/src/react/core.ts` 的值导出，包含表单、菜单、浮层、反馈、数据和布局。具体主/子组件名称与 Props 以模块导出为准，完整映射见 `component-mapping.json`；不把 Figma 展示标题当作导出名。业务代码调用检查函数取得对象，不覆盖全局运行时、不直接调用 `installRuntime`。`mode` 是诊断值，不是兼容性或授权判据。

## 宿主桥接

宿主桥接：`apps/app/src/react-app/plugin-ui/workspace-app-frame.tsx`。
参考插件：`examples/plugin-packages/short-video-studio/src/bridge.mjs` 与 `workspace-theme.mjs`；真实 HTML 交互参考 `examples/plugin-packages/media-studio/ui/image-studio.html`。

使用目标插件现有初始化与 host-context 更新流程。宿主会提供 theme、locale 和 containerDimensions，并监听主题、语言、尺寸变化；检查实际插件契约后接入，不凭此文档臆造事件名或全局接口。

## 主题与 Token

### 来源与使用边界

2026-10-10迁移：以用户确认的紧凑UI字号与Teal品牌色为基础。色阶在 `palette.css`，语义颜色、字体栈及px字号变量在 `tokens.css`，工具类在 `theme.css`，尺寸与状态在 `control-styles.ts` 和对应组件。宿主与iframe引入同源文件；品牌、主操作与焦点的旧宿主暗色覆盖已移除，其他业务专用覆盖仍按调用方核对。

目标品牌强调为 Teal Accent `#1FBAC0`，加强色为 Teal Strong `#087B82`，浅色为 Teal Soft `#A9E7EA`。图中的中性色为 Page Mist `#F6F7FB`、Pure White `#FFFFFF`、Ink Black `#161E24`、Soft Charcoal `#1E262B`、Steel Text `#5A6774`、Divider `#EBEBEB`、Whisper Border `#E7E7E8`、Ice Border `#BED4E0`；Warm Sand `#E0DDC3` 仅用于局部内容分组，不作主操作色。这些是提供的设计色板，不表示所有 CSS Token 已映射到它们，也不直接把浅色值搬到暗色主题。

维护顺序为“原始色阶 → 语义 Token → 组件/业务别名”。业务 CSS 引用语义变量，不复制 hex/rgb，也不把私有 `--dls-*`、`--sv-*` 当作所有插件的公共接口；作品中的 `--ipw-*` 设计 Token 不是宿主 UI Token。已有品牌、设置密度和专业编辑器例外须记录真实调用方；本次不做全客户端强制替换。

### 颜色用途

| 用途 | 公共 Token | 使用规则 |
| --- | --- | --- |
| 页面背景 / 正文 | `--background` / `--foreground` | 成对使用；正文不通过全局 opacity 降低可读性 |
| 内容卡片 | `--card` / `--card-foreground` | 普通内容容器；不把反馈色铺满业务卡片 |
| 菜单、弹窗、浮层 | `--popover` / `--popover-foreground`，`--popover-border` | 复用对应组件，不能一律套页面背景 |
| 次要表面 / 次要文字 | `--muted` / `--muted-foreground` | 说明、辅助信息；不是禁用状态，也不能承载唯一关键指令 |
| 选中 / 悬停区域 | `--secondary` / `--secondary-foreground`，`--accent` / `--accent-foreground` | 复用组件状态样式；保留文字、勾选或 aria 状态，选中不改变排版 |
| 品牌强调 / 链接 | `--primary` / `--primary-foreground`；`--primary-text` | 品牌青色与配套深色前景；文字链接使用primary-text，不能把品牌青色直接铺在白底小字上 |
| 边框 / 输入 / 焦点 | `--border`、`--input`、`--ring` | 常规分隔、输入表面/边框、键盘焦点按组件定义使用；焦点不能只靠 hover |
| 错误 / 风险 | `--destructive`、`--warning` | 保留具体原因与恢复动作；持续反馈背景使用下列专用 Token |
| 信息 / 成功 / 警告 / 错误背景 | `--feedback-info-background` / `--feedback-success-background` / `--feedback-warning-background` / `--feedback-error-background` | 分别关联 sky/green/amber/red 第2档；Alert/Toast 无边框、无投影；图标与文字采用共享实现 |
| 数据图表 | `--chart-1` 至 `--chart-5` | 用于数据系列，不能借来表达任务成功/失败；搭配系列名称和图例 |

运行时1.3：共享 `--primary` 已映射 `--brand-accent:#1FBAC0`，宿主不再覆盖为蓝色；Progress、设置Select及项目强调引用语义变量。品牌强调与文字链接分开：`--primary-text` 浅色为#087B82、暗色为#1FBAC0，避免浅色背景上的品牌青色文字对比度不足。图表蓝色仍属于数据系列，不要求替换为品牌色。

2026-10-10 用户确认：品牌 primary 为青色 `#1FBAC0`；普通主要按钮（Button default）浅色模式保留黑底，暗色模式使用青底，危险按钮仍使用 destructive 语义。按钮文字与图标的前景色、hover/pressed/focus/disabled 状态需成套维护；青底不能直接沿用白色文字，普通控件文字按实际合成背景验证至少4.5:1。此规则须在共享层实现，宿主 React、开发 bundled 和生产 host 注入均遵循，不能由每个页面各写一套暗色覆盖。

Button default 使用 `bg-action text-action-foreground`：浅色#161E24/白色，暗色#1FBAC0/#161E24。`--action-hover` 浅色#1E262B、暗色#A9E7EA；`--action-pressed` 浅色#5A6774、暗色#087B82，pressed文字为白色；`--ring` 浅色#087B82、暗色#A9E7EA。link 使用 `text-link`。禁用仍复用组件 disabled 行为与透明度，次要说明不添加禁用语义。

亮暗模式以宿主 `theme` 和当前文档 `data-theme` 为准；语义变量跟随原始色阶切换。不要仅切 `.dark` 就假定全部颜色已切换，也不要用 CSS filter 反转作品。共享 palette 的 sRGB 与 Display-P3 值按设备能力生效，Figma sRGB 快照不保证所有屏幕逐像素相同。

### 字体、字号与字重

正文、标题、控件使用 `--ipollowork-font-sans`，代码、日志和需要逐字对齐的数值使用 `--ipollowork-font-mono`。前者是系统 UI 字体并带中文回退，不要求安装一款指定商业字体；后者是系统等宽字体栈。宿主虽然导入 Geist/IBM Plex Sans 字体资源，默认正文实际仍引用共享系统字体栈，不把资源已加载误写成默认使用。

以下为用户提供的紧凑客户端UI规范，不能混用品牌展示页56/40/28px的层级。以100%缩放下的视觉像素为目标；使用语义用途而非按HTML h1/h2标签自动决定大小。实施时核对实际根字号与rem换算。

| 设计层级 | 字号 / 行高 | 字重 / 使用场景 |
| --- | --- | --- |
| Page Title | 16 / 24px | 600；页面标题、插件库标题 |
| Section Title | 14 / 20px | 600；已安装、账户、安全等区块标题 |
| Control | 13 / 18px | 500；按钮、Tab、表单标签 |
| Body | 13 / 20px | 400；说明文字、普通正文 |
| Meta | 12 / 18px | 400–500；状态、时间、版本、辅助信息 |
| Caption | 11 / 16px | 400–500；卡片次级信息 |
| Micro | 10 / 14px | 600；仅用于Badge、Alpha标签，不承载关键说明 |

1.3共享七档与上表一致，真实类名为 `text-ui-page-title`、`text-ui-section-title`、`text-ui-control`、`text-ui-body`、`text-ui-meta`、`text-ui-caption`、`text-ui-micro`。旧 title/title-sm 别名保留并指向16/24，compact指向Meta；新增页面使用明确角色名。设置共用页面/区块标题、宿主body以及共享组件默认字体已迁移；业务调用方显式 className 仍可覆盖，不能把共享层验收说成所有页面已无遗留覆盖。

图二的Syne展示标题、PingFang SC中文正文和IBM Plex Mono技术信息属于提供的品牌排版参考；图一才是紧凑UI尺寸目标。当前默认UI是系统字体栈，等宽也是系统等宽栈，没有据此验证Syne/IBM Plex Mono已用于客户端，也不新增字体下载或把展示字体强加给所有操作界面。平台字体与展示字体的最终接入应另行确认，中文避免缺字和跨平台字体替换导致布局漂移。

字重按上述用途选择；不要为了选中、hover或亮暗切换改变字重、字号、行高和文字间距。聊天中文可读性等宿主专用500字重规则不自动扩大到整个插件。错误文字保持正文或控件层级，不因错误出现突然加粗放大；长说明换行，路径/代码可在自己的区域滚动，不能把整个页面撑宽。必需信息不要缩到10/11px来硬塞布局。

### 准确调用与根字号

- 宿主/独立源码消费者通过公开 CSS 入口进入已有Tailwind编译链，从 `@ipollowork/ui/core` 或具体公开模块取得组件及Props。七档角色类是实际工具类，不是组件构造函数；普通字段用 Field/FieldLabel/Input/FieldDescription，不深导入包源码。
- iframe 开发 bundled / 生产 host 均生成上述七档角色类和 font-normal/medium/semibold。普通CSS可用 `font-size:var(--ui-body-size);line-height:var(--ui-body-line);font-family:var(--ipollowork-font-sans)`；所有角色的size/line是px变量，不依赖root换算。`requireRuntime(1, required, 3)` 在桥接初始化前检查最低1.3；不假定任意其他Tailwind工具类也已生成。
- 运行时不重置无关插件body。主客户端body已13/20；短片插件显式使用共享sans、16px根和13/20正文。Field各档间距均8px，说明/错误没有负margin；无宿主Preflight时也清除对应段落的原生margin，不扩大为全局reset。
- 短片工作台标题/标签/说明/元信息按上述角色迁移；领域画布、轨道、媒体和作品不套UI排版。七页行为分别在 bundled/host 模式验收；这不是所有未来插件会自动迁移的承诺，旧插件的自写样式仍需按实际调用检查。
- 主客户端有原生整体缩放及 CSS 根字号回退两条路径。当前插件桥接提供 theme/locale/containerDimensions，没有独立字体缩放字段；不能声称 CSS 字号回退已同步给 iframe。缩放验收需分别检查真实客户端路径和插件文档，不改用户作品字号。

### Figma 对照与验收

代码维护共享值，Figma维护设计规范，Skill维护调用边界；没有自动双向同步。本轮原文件新增/复用 IPW UI Foundations Light/Dark变量和七档IPW/UI文字样式，已绑定Button主操作与Field/Input样本，身份在 component-mapping.json 中记录。Figma样式使用可用Inter预览，中文客户端走系统sans回退；这不表示全部目录实例的显式文字覆盖都已清除。反馈原有变量保持，不声称Code Connect已发布。

可见迁移的验收范围：开发打包/宿主注入、亮/暗、中文/英文、长标题/说明、1280px/390px及客户端实际缩放；比较 computed font-family/font-size/line-height/font-weight 与实际使用的语义档位，检查输入与按钮文字一致、选中前后几何不变、焦点可见、换行不遮挡操作。普通文字对比度目标不低于4.5:1；文字过背景渐变、透明度或作品时按实际合成背景验证，不仅比较 Token 字符串。文档核对不等于新增视觉验收，也不能引用上一轮控件 Fraimz 作为整页字体迁移证据。

iframe 不自动继承宿主 CSS。读取初始主题与后续主题更新；只有主题字段存在时才修改当前主题，其他上下文更新保留主题。主题、字体与缩放规则仅用于操作界面，保留作品配色、字体和导出结果。

## 开发打包方式

开发环境由插件携带与宿主同源的运行时。构建脚本显式调用 `buildPluginRuntime('bundled')`，把返回的 script 放在业务脚本之前执行；两种环境的业务代码都调用同一个 `requireRuntime(1)`。不要复制控件源码或另建颜色表。

短视频样板命令在 `examples/plugin-packages/short-video-studio` 中执行：

```sh
pnpm run build -- --bundled-ui
```

实际脚本为 `node scripts/build.mjs --bundled-ui`，输出 `dist/development/`。`pnpm run dev` 默认先构建此模式；`SHORT_VIDEO_UI_MODE=host` 才切换到模拟宿主注入的预览。不要混淆“开发服务运行中”和“插件包内包含运行时”：这个开关独立于 `NODE_ENV`，共享运行时构建本身使用 production React。

开发产物仅用于独立预览，不作为发布包上传宿主。宿主注入已有运行时时安装器会复用它，这不是允许混用两种提供方的发布规则。

## 生产注入方式

生产构建不打包共享运行时或 React/ReactDOM，只留下业务脚本与轻量检查入口。短视频 `pnpm run build`（实际 `node scripts/build.mjs`）默认输出 `dist/package/`；签名打包脚本读取这个目录，而不是 `dist/development/`。签名需要已有授权密钥，本契约不提供密钥，也不授权签名/发布。

HTML 的 `<head>` 保留这个原样标记：

```html
<meta name="ipollowork-ui-runtime" content="1">
```

当前识别实现是正则，不是通用 HTML 属性解析器：使用双引号、name 在 content 前，不自行换顺序、改成单引号或改变值。`content="1"` 表示参与当前注入协议，不是完整 semver 版本声明。构建工具不得移除这个标记。

实际链路为：`apps/app/vite.config.ts` 构建 host 运行时 → `shared-ui-runtime.ts` 的 `withSharedUiRuntime` 检查标记并在 head 开头插入脚本 → `workspace-app-frame.tsx` 添加现有 CSP → 写入 iframe.srcdoc → 业务脚本调用 `requireRuntime(1)`。运行时在 iframe 内执行，不借用父窗口 DOM、不继承父窗口 React 实例、不从 CDN 或本地文件 URL 加载。不放宽 sandbox/CSP；没有标记的 HTML 保持不注入。

运行时样式已包含共享 palette/tokens/theme 与控件 utilities；插件不要再次手写控件 CSS。样板把业务 CSS 放在 `@layer plugin`，避免通用 button/input 样式覆盖共享控件。更新客户端运行时后，重新打开或重载工作区才取得新实现；已打开的文档没有热替换协议。Figma 编辑不会直接修改线上插件。

无构建步骤的原始 HTML 包可在 module script 中使用固定公共导入 `import { requireRuntime } from "@ipollowork/ui/runtime-contract";`。宿主 `withSharedUiRuntime` 仅对带标记的 HTML 内联此无 React 的检查函数；独立开发预览也需显式注入 bundled 运行时。不支持任意裸模块导入，也不放宽 CSP。

## 两种环境共用的业务接法

原生 HTML 在容器内标记真实 button/input/textarea，然后调用 `enhance(container)`：它查找容器的后代，不包含容器自身。

```js
import { requireRuntime } from '@ipollowork/ui/runtime-contract';
const ui = requireRuntime(1);
ui.enhance(document.body);
```

标记为 `data-ipw-control="button|input|textarea"`；button 可选 `data-ipw-variant`（default、outline、secondary、ghost、destructive、link）与 `data-ipw-size`（default、xs、sm、lg、icon、icon-xs、icon-sm、icon-lg）。不支持的标记/值会抛错。`enhance` 只增强尚未 ready 的元素；不承诺之后改变 variant/size 属性会自动换样式。

动态新增控件可调用 `observe(container)`，销毁工作区时调用返回的清理函数。它观察新增后代，不是任意属性变更监听。HTML 适配只共享样式，字段验证、焦点、dialog 和持久化仍由插件负责，不把它描述成 Base UI 的 React 行为。

iframe 内的 React 也从同一对象取得组件和 React；不要再从 `controls` 静态导入组件或让 JSX 构建器自动带入第二份 `react/jsx-runtime`：

```js
import { requireRuntime } from '@ipollowork/ui/runtime-contract';
const ui = requireRuntime(1);
const container = document.getElementById('app');
if (!container) throw new Error('插件界面容器不存在');
const root = ui.createRoot(container);
root.render(ui.React.createElement(ui.Button, { onClick: save }, '保存'));
// 工作区销毁时 root.unmount()；save 使用插件现有桥接。
```

使用 JSX 时需要构建配置明确复用 `ui.React`；本轮样板以 createElement 验证，不声称已经提供通用 JSX external/import-map 适配器。加载/版本错误需就地显示可理解的提示并停止桥接初始化，不留下空白页。

### 反馈样式与迁移

Alert 和 Toast 共用无边框、无投影的语义浅背景。Alert 的 `default / success / warning / destructive` 分别对应信息 / 成功 / 警告 / 错误；Toast 使用 `toast()` 或 `toast.info / success / warning / error`，不要把展示名 Error 当作 Alert 的 variant。

背景 Token 在 `packages/ui/src/common/tokens.css` 维护：`--feedback-info-background → --sky-2`、`--feedback-success-background → --green-2`、`--feedback-warning-background → --amber-2`、`--feedback-error-background → --red-2`。亮暗值沿用共享 palette；Figma 的 `IPW Feedback Theme` 同名变量绑定主组件，WEB codeSyntax 对应上述 CSS 变量。Figma 当前记录 sRGB 值，代码在支持 Display-P3 的设备上沿用 palette 的广色域值；不声称所有屏幕逐像素一致。

宿主旧 Alert 入口保留翻译适配、Toaster 保留主题适配，但都复用共享实现；基础调用无需逐页重写。迁移必须查调用方的 border / bg 覆盖、Figma 实例覆盖、旧规范和验收断言。字段错误边框、Badge、确认弹窗不属于此卡片样式迁移。关闭按钮继续使用共享 Button；问题不只靠背景色表达。

本轮审计宿主 39 个直接 Alert 调用，无根节点 className/style 覆盖。另迁移授权、插件包、云市场、扩展页面的 7 处手写 role=alert 错误面，以及 SettingsNotice、登录失败、云端不可用、环境变量和工作区提醒样式；这些私有组合复用背景 Token，保留原布局与业务操作。不是所有业务状态卡片的重构，也不表示每个业务页面已逐一端到端验收。

验证：`evals/results/2026-10-10T04-18-15-972Z/fraimz.html`，开发打包/宿主注入各 6 帧；四种 Alert、五种 Toast 调用均在亮暗主题及 1280/390px 下验证语义背景、零边框、不横向裁切，Alert 说明文字对比度不低于 4.5，并验证关闭/重试及既有 144 项关闭图标几何回归。宿主控件夹具 `evals/results/2026-10-10T04-16-59-014Z/fraimz.html` 验证四种状态图标和 SettingsNotice 的背景复用；业务请求为隔离回调，不是打包 Electron 发布验收。

开发 `bundled` 插件须重新构建才能带上样式更新；生产 `host` 随宿主运行时更新，已打开工作区需要重新打开以加载新运行时。既有 1.1 客户端不会因 Figma 修改自动更新。当前改动未改变公共 Props 和加载契约，不自动替换运行中的插件脚本。

### Select、Dialog、Toast · 1.1

启动先检查实际使用的函数，例如 `requireRuntime(1, ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem', 'Dialog', 'DialogContent', 'Toaster', 'toast'])`。此检查针对实际能力，不凭版本字符串断言导出存在；新消费者必须携带新版轻量检查函数，旧客户端缺组件时就地提示更新并停止桥接。

HTML 插件可以把这些 React 组件挂到独立容器中，使用运行时同一份 React/createRoot。替换容器内容前先 `root.unmount()`，不要让字符串渲染覆盖活跃 React 树。Select/Dialog 的 Portal 位于当前 iframe 中，不跨宿主 DOM；测试真实容器边界。1.2 已提供 Checkbox、Autocomplete 和 AlertDialog 的 React 实现，不提供对应原生 HTML 标记转换。

### 核心组合 · 1.2

核心样板证据：`evals/results/2026-10-10T03-54-16-684Z/fraimz.html`，开发打包/宿主注入各4帧，共8帧通过。验证表单失败保留、Checkbox、Radio 键盘、Switch、Toggle、Autocomplete、Dropdown/Command、Popover Escape、Dialog、AlertDialog确认取消、Sheet焦点恢复、Tabs/Accordion/Collapsible、描述按钮回调、ScrollArea真实滚动、Progress真实值，以及暗色390px、表格文字继承、提示状态色与Toast。ContextMenu、HoverCard、Tooltip、ToggleGroup及图像组件在样板中可调用并挂载，但此轮尚未穷尽交互状态；不要把38组导出可用表述为38组全状态验收。该样板使用浏览器沙箱与真实共享控件，回调隔离；不是插件目录安装、真实删除或写盘验收。

共享源码开发可使用 `import { Checkbox, Field, Sheet } from '@ipollowork/ui/core'`；按模块导入可缩小宿主源码消费者的依赖。iframe 的业务脚本仍只静态导入轻量 `runtime-contract`，例如 `requireRuntime(1, ['Checkbox', 'Field', 'Sheet', 'SheetTrigger', 'SheetContent'])`，再用 `ui.React.createElement` / `ui.createRoot` 挂载。完整组合调用见 `evals/support/shared-ui-core-fixture.mjs`，不是只能调用顶层组件。

特别注意：ScrollArea 内容放在 ScrollAreaViewport 内；AlertDialogAction 是普通动作按钮，成功后由调用方更新受控 open，失败不自动关闭；Alert.closeLabel 和 Image.showFullLabel/showLessLabel 由调用方提供本地化文本。Checkbox/Radio 的 id 可能落在隐藏表单 input 上，验证与操作使用带 role/可访问名称的可见控件，不把隐藏节点当作交互入口。

短片工作台的七页（画布、分镜、剧本、角色、素材、轨道、生成记录）统一接入共享控件：Button/Input/Textarea 使用运行时的原生标记适配；所有单选使用 Select，多选素材使用 Checkbox；导航使用 Tabs，状态与反馈使用 Badge/Alert/Empty/Skeleton/Toaster，短弹窗使用 Dialog。画布、连线、媒体预览和轨道保持领域布局，不另造通用控件。先 unmount React 岛再替换业务 DOM；自动保存失败持续显示错误并保留待保存草稿，重试成功后清除。保留原服务、桥接、插件身份及数据路径。

Select 保存中禁用并关联字段错误；风格提示失败恢复持久化值，成功将风格和提示词一起保存；其他编辑字段保留待保存值，使用持续错误提示重试写盘，业务由原服务处理。Dialog 输入校验、异步提交与关闭策略仍由插件决定；提交中关闭与 Escape 不生效，失败保留输入，完成清理后再交还焦点。沙箱不放宽 `allow-forms`，按钮/输入 Enter 走显式保存回调。

每个工作区挂一个 Toaster。未传 theme 时跟随当前文档 `data-theme`；宿主适配保留原主题订阅和翻译。短成功操作可用 `toast.success`，字段错误仍就地持续显示。关闭按钮支持键盘和指针；测试时等待 Toast 实际挂载后再操作。Toaster和提示不修改作品配色。

## 版本兼容规则

当前 `UI_RUNTIME_VERSION = '1.5.0'`（1.5新增Badge的info/success/warning语义变体，使用时调用 `requireRuntime(1, ['Badge', 'Icon'], 5)`；1.4新增公共Icon；1.3规范保持兼容）；独立于客户端与插件版本。1.3增加公共颜色/字体变量、保证七档字号类生成并增加最低minor检查；保留原v1组件入口与Props。短片包0.1.3采用新规范，插件ID和数据路径不变。生产业务脚本不包含组件实现；旧体积统计属于1.2快照，不当作本轮产物实测。

| 运行时情况 | 当前代码行为 | 插件要求 |
| --- | --- | --- |
| 不存在 | 抛出更新客户端提示 | 停止初始化，保留明确错误；不从网络补装或改用本地副本 |
| major为1、minor满足最低值且函数齐全 | 返回运行时 | 仅使用此契约已公开的v1 API；本轮基础规范最低minor为3 |
| minor低于minimumMinor或无法解析 | 抛出版本过旧提示 | 停止桥接初始化，更新宿主后重新打开 |
| 主版本匹配，但 required 中任一导出不是函数 | 抛出缺少组件的更新提示 | 新消费者在初始化桥接前列出实际使用的函数；不静默改用插件副本 |
| 首段不等于 1 | 抛出同一提示 | 停止；2.x 需要另行迁移，不能声称自动兼容 |
| 重复安装且已有 v1 对象 | 复用已有对象，不替换 CSS/实现 | 不以此容错机制支持生产混入 bundled 包 |

`requireRuntime(major, required, minimumMinor=0)` 检查主版本、最低minor和具名函数。新规范调用 `requireRuntime(1, required, 3)`；旧两参数调用保留默认行为。不是完整semver范围/最低patch协商，没有运行时下载、回滚或UI manifest版本字段；manifest compatibility.ipollowork仍只约束客户端版本。破坏Props、删除API或改变Token含义仍须升major；本轮样式按用户批准迁移，旧自写视觉覆盖需单独复验。

维护规则：保持现有 v1 API、默认行为和 Token 语义兼容；修复用 patch，兼容新增用 minor，删除/改义/破坏原有 props 或 Token 需提升 major 并更新宿主、插件、映射及验证。新增组件需先扩展契约，再验证消费者；若插件需要旧 v1 没有的 API，必须增加明确的能力/最低版本机制及验证，不能只靠 `requireRuntime(1)` 宣称满足。这里是维护约束，不是说升级协商已实现。

## 核对与验收

本轮1.3基础规范证据：`evals/results/2026-10-10T06-34-30-302Z/fraimz.html` 验证两种加载、七档实际字号/行高/字重、13/16px根、亮暗主按钮与Field说明8px；`evals/results/2026-10-10T06-35-47-099Z/fraimz.html` 为真实客户端8组逐页检查；`evals/results/2026-10-10T06-41-53-139Z/fraimz.html` 为内置目录更新到短片0.1.3后的真实宿主8帧验收。短片七页双模式证据位于隔离工作区 `evals/results/2026-10-10T06-28-19-563Z/fraimz.html`。最低minor与无效minor拒绝另由runtime-contract测试验证。

仍未完成的范围：全部Figma目录实例的显式样式覆盖逐个清理、签名上传归档、发行版Electron及真实跨客户端升级。主页面业务显式字号和作品排版不因共享层修改而自动统一；不能承诺未迁移插件的自写控件已更新。现有测试归档要求签名产物，本轮没有准备该产物；包API/签名生命周期测试未通过，普通包测试42项与宿主剪辑兼容测试通过。

核对源码：`packages/ui/package.json`、`src/plugin/runtime-contract.ts`、`src/plugin/runtime.ts`、`build-plugin-runtime.mjs`；宿主 `shared-ui-runtime.ts`、`workspace-app-frame.tsx`、`vite.config.ts`；样板 `scripts/build.mjs`、`scripts/dev.mjs`、`scripts/package.mjs`、`src/ui.mjs`。

构建验收检查：开发产物包含 bundled 运行时且在业务前安装；生产产物保留 meta、没有 React/ReactDOM 和运行时实现输入；模式分别输出 development/package；版本缺失或主版本不兼容不初始化业务。构建脚本的 dependency watch 列表只能包含真实文件，不含虚构 stdin 入口。

既有体验证据：`evals/results/2026-10-09T10-57-03-400Z/fraimz.html`，7 个截图帧通过，覆盖两种加载、提交禁用、失败保留输入、真实本地服务重试、暗色/390px、无关上下文、Escape 焦点、实际宿主注入函数、React/HTML 实际外框尺寸和版本拒绝。失败由隔离预览注入一次传输故障，不是声称真实磁盘故障。

复跑使用隔离工作区与浏览器：Vite 在 5193；样板 `PORT=5896 SHORT_VIDEO_UI_MODE=bundled node scripts/dev.mjs` 与 `PORT=5897 SHORT_VIDEO_UI_MODE=host node scripts/dev.mjs`，分别指定独立 `SHORT_VIDEO_DEV_ROOT`；再执行 `pnpm fraimz --flow shared-ui-runtime --cdp-url <隔离浏览器CDP>`。不要使用日常浏览器或用户项目目录。

真实客户端证据：`evals/results/2026-10-10T02-44-36-997Z/fraimz.html`，6个截图帧通过。使用专用 Electron 数据目录，从内置目录安装生产插件，在真实 WorkspaceAppFrame 中接收宿主1.0.1运行时，验证32px控件、一次注入的503失败保留输入、真实服务重试写项目文件、刷新后重新打开、真实宿主主题桥接和390px容器、Escape焦点恢复，以及注入2.x时显示更新提示并停止业务初始化。生产插件文件hash保持不变，更新共享控件不要求重打插件包。

复跑：先在临时 profile 内安装插件，使用 Control API 创建空任务，并打开右侧面板。设置 `IPOLLOWORK_UI_CLIENT_ROOT=/tmp/ipollowork-shared-ui-client-<本次目录>`，运行 `pnpm fraimz --flow shared-ui-client --cdp-url <专用ElectronCDP>`。此 flow 包含显式传输故障、宿主主题/容器测试状态和2.x替身，不能连日常客户端。

1.1.0 新增组件证据：`evals/results/2026-10-10T03-23-00-685Z/fraimz.html`，开发打包与生产注入各7帧，共14帧通过。验证 Dialog 提交禁用、失败保留与重试，Select 键盘/Escape、保存失败回滚与成功写盘、重绘后焦点恢复，以及暗色/390px 浮层、Toast 边界和键盘关闭。主题、传输故障和旧运行时是显式隔离测试状态，不调用收费生成。

真实客户端1.1.0证据：`evals/results/2026-10-10T03-16-39-756Z/fraimz.html`，8帧通过；除原有6帧外，实际安装插件的 Select 保存同步写入风格与提示词并恢复焦点，旧1.x缺少新增组件时提示更新并阻止业务初始化。旧版由替身注入，不代表真实旧客户端升级验证。原有 React/HTML 控件兼容回归：`evals/results/2026-10-10T03-20-23-835Z/fraimz.html`。

复跑新增组件：沿用上述隔离预览和独立数据目录，运行 `pnpm fraimz --flow shared-ui-overlays --cdp-url <隔离浏览器CDP>`。临时 Electron 应设置 `IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR=<当前仓库>/examples/plugin-packages`，防止链接依赖指向其它 checkout 的旧内置插件；从真实扩展目录安装当前生产构建，再运行真实客户端 flow。

上一轮1.2核心扩展已本地整合到Carrie；本轮继续整合运行时1.3.0与短片包0.1.3，没有更改插件ID或数据目录，未提交、推送或发布。隔离分支保留；未增加依赖。下面1.2证据保留为历史记录，不替代本轮验收。

本地整合证据：`evals/results/2026-10-10T04-46-21-450Z/fraimz.html` 覆盖开发打包和宿主注入的核心组件；`evals/results/2026-10-10T05-20-14-808Z/fraimz.html` 在专用临时 Electron profile 安装当前生产构建，8帧验证1.2运行时注入、失败保留与真实写盘重试、主题、窄容器、焦点及不兼容拒绝。旧版本与503是显式测试替身，不是实际跨客户端升级或磁盘故障。签名归档上传、Electron发行打包启动和完整发布仍未验证。

逐页操作与本轮视觉修正证据：`evals/results/2026-10-10T05-21-04-298Z/fraimz.html` 的8帧覆盖设置主题、授权必填验证及Configure居中、插件导入非法地址、云市场未登录入口、窄窗口权限菜单、模板32px操作与选中尺寸稳定、设置标签居中、统一28px/16px关闭按钮，以及无前置图标的模型入口。未登录真实账号、未提交凭证、未调用付费生成；不覆盖云服务不可用或真实授权成功，不代表全客户端所有页面视觉验收。

反馈第2档与两种运行模式证据：`evals/results/2026-10-10T05-18-34-476Z/fraimz.html`，12帧通过；Alert背景直接与palette第2档比较，亮暗/1280与390px、文字对比度、关闭居中矩阵及Toast恢复动作通过。Figma四个既有背景变量同步Light/Dark值，保留ID、WEB codeSyntax及五个主组件绑定；Button/Dialog主组件描述同步尺寸与交互规则。

## 行为

真实客户端完整迁移证据：`evals/results/2026-10-10T05-55-17-912Z/fraimz.html`，专用临时 Electron profile 从内置目录正常更新到插件0.1.2，8帧通过。验证宿主1.2.0注入、七页共享控件及真实Tab面板、一次传输失败保留输入与服务写盘重试、刷新重开、主题/窄容器/焦点及旧运行时能力拒绝。未签名、发布或操作日常项目；签名归档与完整发行包验收仍另行进行。

短片完整迁移证据：`evals/results/2026-10-10T05-54-34-802Z/fraimz.html`，开发打包与宿主注入各7帧，共14帧通过。使用本地分镜、角色、素材与字幕轨道夹具，验证七页共享控件、真实 Tabs 面板与键盘、32px操作/28px关闭/16px居中图标、表单保存失败保留草稿并真实写盘重试、画幅/镜头/多选值写盘、持续提醒与空态、弹窗失败重试和焦点恢复、暗色及390px无页面溢出。失败由隔离传输注入；没有登录真实渠道或调用付费生成，不声称已验证所有模型条件分支及付费任务完整生命周期。

复跑完整迁移：在独立目录分别启动 `PORT=5906 SHORT_VIDEO_UI_MODE=bundled SHORT_VIDEO_DEV_ROOT=/tmp/ipollowork-full-ui-bundled node scripts/dev.mjs` 与 `PORT=5907 SHORT_VIDEO_UI_MODE=host SHORT_VIDEO_DEV_ROOT=/tmp/ipollowork-full-ui-host node scripts/dev.mjs`，再运行 `pnpm fraimz --flow short-video-shared-ui --cdp-url <隔离浏览器CDP>`。预览注入脚本必须使用 replace 回调，不能让运行时中的 `$&` 被当作替换模板。

独立插件保留同一字段标签、错误关联、提交中状态和输入恢复规则。弹层需处理焦点、Escape、关闭后返回入口；考虑 iframe 边界造成的裁切，用宿主容器尺寸检验窄宽度。

使用插件已支持的宿主能力进行打开链接、发送上下文或展示模式切换。页面按钮不能直接操纵宿主 DOM，也不能仅凭 Figma 展示推断宿主 API 可用。异步操作的最终状态来自真实结果。

首次接入优先验证一条完整小流程：填写 → 选择 → 提交中 → 成功或失败 → 重试；另验证主题更新和容器缩放。控件预览通过、模拟桥接通过与安装到宿主后通过分别记录。

## 公共图标与按钮 · 运行时1.4

共享源码使用 `import { Icon, type IconName } from '@ipollowork/ui/icon'`，或从core导入；iframe使用 `requireRuntime(1, ['Button', 'Icon'], 4)`。公共范围为 `ICON_NAMES` 列出的32个具名Lucide图标，不导出Lucide全集，不支持任意字符串。新图标必须加入同一映射并补齐验证。图标为线性描边、currentColor，默认M16px；S14px、L20px为固定像素，不随根字号或Button默认SVG选择器缩放。

```js
import { requireRuntime } from '@ipollowork/ui/runtime-contract';
const ui = requireRuntime(1, ['Button', 'Icon'], 4);
const h = ui.React.createElement;
const leading = h(ui.Button, { size: 'sm', onClick: save },
  h(ui.Icon, { name: 'Plus', size: 's', 'data-icon': 'inline-start' }), '新建');
const trailing = h(ui.Button, { onClick: download }, '下载',
  h(ui.Icon, { name: 'Download', 'data-icon': 'inline-end' }));
const iconOnly = h(ui.Button, { size: 'icon', 'aria-label': '搜索', onClick: search },
  h(ui.Icon, { name: 'Search' }));
```

Button继续使用原children API：sm28px、default32px、lg36px；icon-sm/icon/icon-lg分别同尺寸，xs24兼容。图标默认aria-hidden装饰；独立表达状态的图标提供label，生成role=img和可访问名称。纯图标按钮名称放在Button的aria-label，内部Icon保持装饰，不重复朗读。加载由调用方管理disabled/aria-busy与LoaderCircle的animate-spin，操作成功后恢复；Icon不自动触发动作或异步任务。

验收范围为现有shared-ui-core样板和双模式流程：所有公共名字SVG非空、S/M/L、前置/后置/纯图标、真实鼠标与键盘、禁用/加载、亮暗窄容器及13/16px根字号。此处描述验证契约，完成状态以本轮fraimz证据为准。
