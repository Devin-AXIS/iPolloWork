# Stage Diagrams 商业图库

35 个原生 iPolloWork / HyperFrames 视频组件，全部版本为 **4.0.0**，通过同一作者源码生成五个标准组件包。

## 构建与使用

需要 Node.js 24+，并先在 `vendor/hyperframes` 执行 `bun install --frozen-lockfile`。构建复用 HyperFrames 已有的 Puppeteer 和 Studio GSAP 依赖，没有独立依赖目录。

在仓库根目录执行：

```bash
pnpm video:components:build
```

默认使用 Puppeteer 管理的 Chrome。使用系统 Chrome 时，将 `CHROME_PATH` 设置为浏览器可执行文件的路径；未安装管理浏览器时，在 `vendor/hyperframes/packages/producer` 执行 `bunx puppeteer browsers install chrome`。

构建会重新生成所有 35 个组件、校验默认与最少/最多条目的完整及卡片布局，再发布 `dist/hyperframes/*.hfcomponent.json`。在 Video Studio 的「组件 → 导入」选择这五个包；已有安装可在构建后执行 `pnpm video:components:install` 原子替换图库包。安装更新保留已有视频的真实内容与编辑结果。

GitHub Tests 的 `business-components` 作业执行同一构建并上传 `stage-diagrams-4.0.0` 产物，包含五个最新组件包和 AI 适配器。

## 展示中心

构建后，在本目录运行任意静态 HTTP 服务并打开 `gallery.html`。展示中心播放生成的真实视频组件；支持中英文、原有四套风格、演示配色、完整/卡片/海报布局、点击重播及全屏展示。演示配色仅作用于展示中心，项目中的组件继承项目主题令牌。

保留原有 **Keynote / 电影感 / 点阵 / 杂志** 四种风格。镜头提供 **平稳 / 俯视 / 立体 / 聚焦**，另有自动选择。聚焦仅用于沿路径展开的 9 个组件：时间线、旅程、流水线、路线图、S 曲线、时序、状态、泳道、峡谷。

## 编辑和 AI

内容、JSON、原生文字及画布共享同一组标准变量，一次 JSON 应用对应一次保存与撤销。AI 使用现有 `media.video_component_read` / `media.video_component_write`，读取 `revision`、schema、guide 和 example 后提交一个对象。

JSON 的四个块为 `content`、`copy`、`timing`、`look`；省略字段保留原值，提交的数组整体替换。稳定 ID、关系引用、数量和文字预算由 HyperFrames 核心的 `registry/componentContent.ts` 校验，未知字段或无效排版明确报错并保留上一有效画面。详见 [JSON 规范](../../docs/video-component-json-proposal.zh-CN.md) 和 [AI 使用说明](skill/SKILL.md)。

## 源码所有权

- `engine/specs.js`：35 个组件的字段、数量与动画能力；四类 renderer 维护几何和原有视觉。
- `engine/component.js`：原生变量、稳定 ID、旁白卡点与可定位的 GSAP 时间线。
- `tools/author.mjs`：从上述源码及共享核心契约生成原生 HTML 与 registry 元数据并校验布局；可传组件类型做定向生成。
- `build.mjs`：完整生成、验证和打包的唯一入口。
- `gallery.html` / `player.html`：一个展示中心与真实组件播放页。

生成的 `src/`、`dist/`、GSAP 资源、独立 AI 适配器及 skill bundle 不提交到源代码树；它们始终由上述源码重新生成。示意位置和关系不代表实测数据。
