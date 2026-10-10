# 插件工作区接入契约

适用于独立 HTML、iframe 和插件自己的 React 构建。核对日期：2026-10-09。

## 公共入口 · v1

以下入口按实际 `packages/ui/package.json` 的 exports 核对。`@ipollowork/ui` 是仓库私有 workspace 包，样板通过 `devDependencies: { "@ipollowork/ui": "workspace:*" }` 引用；没有对外发布 SDK。仓库外插件不能假定公共包管理器已有此包。

| 使用方 | 固定入口 | 支持范围 |
| --- | --- | --- |
| 宿主 React | `@/components/ui/button`、`input`、`textarea` | 原入口兼容重导出；不要强制业务调用方迁移私有路径 |
| 共享源码消费者 | `@ipollowork/ui/controls` | Button、Input、Textarea；另导出 ButtonStyleScopeProvider、buttonVariants，但这两个不在 iframe 运行时对象中 |
| iframe 插件业务脚本 | `@ipollowork/ui/runtime-contract` | `requireRuntime(major = 1)`；轻量检查入口，运行时代码不导入 React |
| 宿主/插件的 Node 构建脚本 | `@ipollowork/ui/build-plugin-runtime` | `buildPluginRuntime('host' \| 'bundled') → { script, dependencies }`；不是浏览器接口 |
| 主题构建 | `@ipollowork/ui/palette.css`、`tokens.css`、`theme.css` | 共同 Token 源；单独导入不等于已有完整控件样式 |

`@ipollowork/ui/plugin-runtime` 虽然在 exports 中存在，但属于运行时安装实现入口，不作为插件业务脚本的接法；导入它可能把 React/ReactDOM 带入插件包。`@ipollowork/ui/react` 仍是 Paper 等现有组件入口，不能拿它替代 `controls`。不深导入 `packages/ui/src/*`、宿主领域内部代码或 Vite virtual 模块。

`requireRuntime(1)` 返回 `window.ipolloworkUi`，v1 对象仅包含：`version`、`mode`、`React`、`createRoot`、`Button`、`Input`、`Textarea`、`enhance`、`observe`。业务代码调用检查函数取得对象，不覆盖全局运行时、不直接调用 `installRuntime`。`mode` 是诊断值，不是兼容性或授权判据。

## 宿主桥接

宿主桥接：`apps/app/src/react-app/plugin-ui/workspace-app-frame.tsx`。
参考插件：`examples/plugin-packages/short-video-studio/src/bridge.mjs` 与 `workspace-theme.mjs`；真实 HTML 交互参考 `examples/plugin-packages/media-studio/ui/image-studio.html`。

使用目标插件现有初始化与 host-context 更新流程。宿主会提供 theme、locale 和 containerDimensions，并监听主题、语言、尺寸变化；检查实际插件契约后接入，不凭此文档臆造事件名或全局接口。

## 主题与 Token

- iframe 不自动继承宿主 CSS。读取初始主题和后续主题更新；只有主题字段存在时才修改当前主题，其他上下文更新保留主题。
- 本地 CSS 使用语义变量表达背景、表面、文字、次要文字、边框、选中、强调和危险状态。变量名沿用插件已有约定；将值与宿主视觉规范对齐。
- `--sv-*` 是短视频插件现有局部 Token，不是所有插件的公共 SDK。产物中的 `--ipw-*` 设计 Token 也不能直接等同宿主 UI Token。
- 宿主亮暗主题变化只影响插件操作界面，保留用户产物自身的配色和导出结果。
- 单一 Token 源为 `packages/ui/src/common/{palette,tokens,theme}.css`；宿主和插件运行时均引用它。短视频 `--sv-*` 是这些语义变量的别名，不是第二套颜色值。

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

## 版本兼容规则

当前唯一实现为 `UI_RUNTIME_VERSION = '1.0.0'`，来自 `packages/ui/src/plugin/runtime.ts`；它独立于主客户端版本、插件 package.version 和 Figma 节点身份。插件启动固定调用 `requireRuntime(1)`，再初始化桥接与业务。

| 运行时情况 | 当前代码行为 | 插件要求 |
| --- | --- | --- |
| 不存在 | 抛出更新客户端提示 | 停止初始化，保留明确错误；不从网络补装或改用本地副本 |
| version 首段转成数字后为 1 | 返回运行时 | 仅使用此契约已公开的 v1 API |
| 首段不等于 1 | 抛出同一提示 | 停止；2.x 需要另行迁移，不能声称自动兼容 |
| 重复安装且已有 v1 对象 | 复用已有对象，不替换 CSS/实现 | 不以此容错机制支持生产混入 bundled 包 |

这是主版本检查，不是完整 semver 校验、功能探测或最低 minor/patch 约束。没有 `>=1.1` 检查、版本范围协商、运行时下载/回滚或 UI 版本 manifest 字段；现有 manifest 的 `compatibility.ipollowork` 只限制客户端版本，不能替代这个检查。1.x 字符串通过也不表示未来新增 API 在旧 1.0.0 上存在。

维护规则：保持现有 v1 API、默认行为和 Token 语义兼容；修复用 patch，兼容新增用 minor，删除/改义/破坏原有 props 或 Token 需提升 major 并更新宿主、插件、映射及验证。新增组件需先扩展契约，再验证消费者；若插件需要旧 v1 没有的 API，必须增加明确的能力/最低版本机制及验证，不能只靠 `requireRuntime(1)` 宣称满足。这里是维护约束，不是说升级协商已实现。

## 核对与验收

核对源码：`packages/ui/package.json`、`src/plugin/runtime-contract.ts`、`src/plugin/runtime.ts`、`build-plugin-runtime.mjs`；宿主 `shared-ui-runtime.ts`、`workspace-app-frame.tsx`、`vite.config.ts`；样板 `scripts/build.mjs`、`scripts/dev.mjs`、`scripts/package.mjs`、`src/ui.mjs`。

构建验收检查：开发产物包含 bundled 运行时且在业务前安装；生产产物保留 meta、没有 React/ReactDOM 和运行时实现输入；模式分别输出 development/package；版本缺失或主版本不兼容不初始化业务。构建脚本的 dependency watch 列表只能包含真实文件，不含虚构 stdin 入口。

既有体验证据：`evals/results/2026-10-09T10-57-03-400Z/fraimz.html`，7 个截图帧通过，覆盖两种加载、提交禁用、失败保留输入、真实本地服务重试、暗色/390px、无关上下文、Escape 焦点、实际宿主注入函数、React/HTML 实际外框尺寸和版本拒绝。失败由隔离预览注入一次传输故障，不是声称真实磁盘故障。

复跑使用隔离工作区与浏览器：Vite 在 5193；样板 `PORT=5896 SHORT_VIDEO_UI_MODE=bundled node scripts/dev.mjs` 与 `PORT=5897 SHORT_VIDEO_UI_MODE=host node scripts/dev.mjs`，分别指定独立 `SHORT_VIDEO_DEV_ROOT`；再执行 `pnpm fraimz --flow shared-ui-runtime --cdp-url <隔离浏览器CDP>`。不要使用日常浏览器或用户项目目录。

接入样板仅覆盖短视频新建项目弹窗和隔离 React/HTML 控件。正式安装、Electron 打包启动、升级兼容仍未验收，且代码仍需整合到主客户端。本次纯文档契约更新不重跑 fraimz，也不把旧证据扩大为全组件或生产发布通过。

## 行为

独立插件保留同一字段标签、错误关联、提交中状态和输入恢复规则。弹层需处理焦点、Escape、关闭后返回入口；考虑 iframe 边界造成的裁切，用宿主容器尺寸检验窄宽度。

使用插件已支持的宿主能力进行打开链接、发送上下文或展示模式切换。页面按钮不能直接操纵宿主 DOM，也不能仅凭 Figma 展示推断宿主 API 可用。异步操作的最终状态来自真实结果。

首次接入优先验证一条完整小流程：填写 → 选择 → 提交中 → 成功或失败 → 重试；另验证主题更新和容器缩放。控件预览通过、模拟桥接通过与安装到宿主后通过分别记录。
