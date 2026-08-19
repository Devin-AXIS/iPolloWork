<h1 align="center">DeepSeek Design</h1>

<p align="center">
  <strong>由 iPolloWork 推出的 DeepSeek Harness 核心设计系统</strong><br />
  让 DeepSeek Harness 不只回答问题，也能生成、理解并持续修改真正可编辑的设计作品。
</p>

<p align="center">
  <a href="#简体中文">简体中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/deepseek-idesign"><img alt="deepseek-idesign" src="https://img.shields.io/npm/v/deepseek-idesign?label=deepseek-idesign&color=3b82f6" /></a>
  <a href="https://www.npmjs.com/package/deepseek-ippt"><img alt="deepseek-ippt" src="https://img.shields.io/npm/v/deepseek-ippt?label=deepseek-ippt&color=8b5cf6" /></a>
  <a href="https://www.npmjs.com/package/deepseek-ivideo"><img alt="deepseek-ivideo" src="https://img.shields.io/npm/v/deepseek-ivideo?label=deepseek-ivideo&color=1677ed" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="DeepSeek Harness plugin" src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-111827" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-iPolloWork%20Source%20Available-0f766e" /></a>
</p>

---

<a id="简体中文"></a>

## DeepSeek Harness 的核心设计能力

**DeepSeek Design** 是由 [iPolloWork](https://github.com/Devin-AXIS/iPolloWork) 推出、专为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的原生可视化设计系统。

它把 DeepSeek Harness 作为理解需求、生成内容和修改文件的 AI 引擎，把 iPolloWork Design Studio 作为可视化创作与精调界面。你可以在对话中提出完整需求，也可以选中画布里的一个标题、一张图片或一个组件，让 AI 只修改当前对象；需要更精确时，则直接在 Studio 中调整文字、字体、颜色、尺寸、间距、背景、链接与图片。

你可以把它理解为 DeepSeek Harness 中类似 Claude Design 的开放设计工作流：**AI 负责从意图到作品，Studio 负责从作品到细节，最终结果仍是工作区中真实、可保存、可继续编辑的文件。**

DeepSeek Design 不是另一个聊天机器人，也不会替换 DeepSeek Harness。它以原生插件方式进入 Harness 的对话界面，复用当前会话、模型、工作区与权限体系，为 Harness 增加一套专门的 Design 能力。

## 从一句话到可交付设计

1. 在 DeepSeek Harness 中描述你想要的网站、App 原型、海报、信息卡、报告或演示文稿。
2. Harness 在当前工作区生成或修改 HTML、CSS、设计令牌和项目说明文件。
3. 打开对话旁的 **Design** 或 **PPT** 视图，实时查看结果。
4. 直接编辑画布，或选中具体元素后使用 **Ask AI** 继续修改。
5. 继续对话、切换模板或撤销修改；PPT 作品还可导出为 PDF 或 PPTX。

这是一条持续循环的创作流程，而不是一次性的图片生成：

```text
描述需求 → AI 生成 → Studio 预览 → 手动精调 / Ask AI → 保存到工作区 → 继续迭代
```

## 三个独立插件，一套创作系统

| 插件 | 面向场景 | 核心能力 |
| --- | --- | --- |
| [`deepseek-idesign`](https://www.npmjs.com/package/deepseek-idesign) | 网站、App 原型、海报、信息卡、数据报告、杂志与其他非幻灯片设计 | Design 模板市场、桌面/移动预览、可视化元素编辑、主题与设计令牌、选区 Ask AI |
| [`deepseek-ippt`](https://www.npmjs.com/package/deepseek-ippt) | 演示文稿与幻灯片 | 独立 PPT 模板市场、逐页编辑、可视化精调、选区 Ask AI、PDF/PPTX 导出 |
| [`deepseek-ivideo`](https://www.npmjs.com/package/deepseek-ivideo) | 动态视觉、产品演示、数据故事与短视频 | HyperFrames 时间线、动画与素材、27 个 Video 模板、选区 Ask AI、自动校验、视频导出 |

三个插件可以单独安装，也可以一起使用。它们共享 iPolloWork Studio 契约和模板协议，但项目目录彼此隔离，因此不会相互覆盖。只安装所选 npm 包，不会下载另外两个插件。

## 核心特性

- **Harness 原生界面**：Design 与 PPT 作为独立视图出现在 DeepSeek Harness 对话中，不需要启动 iPolloWork 桌面端。
- **AI 与手动编辑并存**：既能让 AI 完整生成或重构，也能在画布中直接修改单个元素和全局主题。
- **选区级 Ask AI**：选中元素后，插件把明确的文件、定位信息和当前样式整理为对话草稿；由用户确认后再发送，不会自动提交。
- **真实项目文件**：作品保存在 Harness 工作区，而不是封闭的云端画布或不可编辑截图。
- **模板市场**：Design 与 PPT 拥有各自的精选模板入口；网站和海报不会混入 PPT，幻灯片也不会混入 Design。
- **可逆编辑**：支持保存、撤销和文件变更冲突检测，降低 AI 与手动编辑同时发生时的覆盖风险。
- **设计系统能力**：通过设计令牌统一管理颜色、字体、背景、圆角、阴影、间距和组件视觉语言。
- **独立安装**：每个 npm 包都包含所需的浏览器资源，只安装选择的能力，不把完整 iPolloWork 主项目带入 Harness。
- **原生 Video 工作流**：iVideo 直接复用 HyperFrames 时间线、可视化编辑、预览、校验与导出，不维护第二套视频引擎。

## 快速开始

### 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- DeepSeek Harness 当前版本及其插件管理所需的 pnpm

DeepSeek Harness 仍处于开发者预览阶段，可能出现兼容性变更。请优先使用最新版本，详见其[官方项目](https://github.com/deepseek-ai/deepseek-harness)。

### 只安装 Design

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign
npx @deepseek-ai/dsh web
```

### 同时安装 Design、PPT 与 Video

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign deepseek-ippt deepseek-ivideo
npx @deepseek-ai/dsh web
```

如果已经安装了 `dsh` 命令，可以把上面的 `npx @deepseek-ai/dsh` 直接替换为 `dsh`。Web 界面默认运行在 [http://127.0.0.1:3080](http://127.0.0.1:3080)。

### 更新或卸载

```sh
# 更新
npx @deepseek-ai/dsh plugin --profile web update deepseek-idesign deepseek-ippt deepseek-ivideo

# 卸载
npx @deepseek-ai/dsh plugin --profile web remove deepseek-idesign deepseek-ippt deepseek-ivideo
```

## 如何使用

1. 在要作为工作区的项目目录中启动 DeepSeek Harness。
2. 新建或打开一个对话，在对话视图中选择 **Design**、**PPT** 或 **Video**。
3. 点击编辑开关旁的 `+` 打开对应模板市场，或直接让 AI 从当前空白项目开始创作。
4. 点击画布中的元素进行精调；需要 AI 帮助时，点击 **Ask AI**，检查自动填入的修改要求后再发送。
5. 所有修改都会回到当前工作区，后续对话仍可继续读取和编辑。

Design 项目保存在：

```text
design/<sessionId>/
```

PPT 项目保存在：

```text
design/<sessionId>-ippt/
```

Video 项目保存在：

```text
video/<sessionId>/
```

## 安全与数据边界

- 插件只接受 DeepSeek Harness 已注册的工作区，并将读写限制在工作区的 `design/` 目录内。
- Studio iframe 使用进程级随机令牌访问宿主接口，并校验同源消息。
- 文本写入带版本冲突检查并采用原子替换，避免静默覆盖较新的文件。
- 模板应用先在隔离目录中完成校验，再原子替换当前项目；失败时恢复原项目。
- **Ask AI** 只填写当前对话的草稿，不会代替用户发送消息。
- 安装插件不会安装或启动 iPolloWork 桌面应用；每个插件只载入自己的 Studio。

## 项目结构与同步方式

```text
packages/
  deepseek-idesign/       可直接安装的完整 Design 插件
  deepseek-ippt/          可直接安装的完整 PPT 插件
  deepseek-ivideo/        可直接安装的完整 Video 插件
source/
  plugins/                DeepSeek Harness 适配器源码
  shared/                 三个插件共用的 Studio 协议与类型
SOURCE_COMMIT             对应的 iPolloWork 主库提交
repository.json           包版本与源码来源清单
```

[iPolloWork](https://github.com/Devin-AXIS/iPolloWork) 是产品源码的唯一事实来源；[`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) 是面向 DeepSeek Harness 用户的独立发布与贡献入口。

社区可以在本仓库修改 `source/` 或根目录 README。合并后，自动流程会在 iPolloWork 主库创建可审查的上游 PR；上游合并后再统一构建三个插件，并把结果同步回本仓库。这样，iPolloWork、DeepSeek Design 和三个 npm 包始终由同一套 Studio 能力升级，不需要分别维护功能分叉。

请不要直接修改 `packages/` 下的生成产物。

## 参与贡献

- 功能建议与问题反馈：[GitHub Issues](https://github.com/Devin-AXIS/deepseek-design/issues)
- 源码贡献：修改 [`source/`](https://github.com/Devin-AXIS/deepseek-design/tree/main/source) 并提交 Pull Request
- iPolloWork 核心 Studio 与模板贡献：[iPolloWork](https://github.com/Devin-AXIS/iPolloWork)

## 许可

本项目使用与 iPolloWork 主仓库一致的 [iPolloWork Source Available License](LICENSE)。第三方组件及历史许可部分继续保留各自的许可条款。

---

<a id="english"></a>

## The core design capability for DeepSeek Harness

**DeepSeek Design** is a native visual design system created by [iPolloWork](https://github.com/Devin-AXIS/iPolloWork) for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It uses DeepSeek Harness as the AI engine that understands a brief, creates content, and edits workspace files, while iPolloWork Design Studio provides the visual surface for previewing and refining the result. Ask for a complete design in conversation, select one heading, image, or component for a focused AI change, or directly adjust text, typography, color, size, spacing, backgrounds, links, and media in Studio.

Think of it as an open, source-available Claude Design-style workflow inside DeepSeek Harness: **AI moves from intent to artifact, Studio moves from artifact to detail, and the result remains a real, editable project in your workspace.**

DeepSeek Design is not a separate chatbot and does not replace Harness. It installs as a native Harness bundle and reuses the active conversation, model, workspace, and permission system to give Harness a dedicated Design capability.

## One continuous design loop

```text
Brief → AI generation → Studio preview → Visual edit / Ask AI → Workspace files → Iterate
```

1. Describe a website, app prototype, poster, information card, report, or presentation.
2. Harness creates or updates the HTML, CSS, design tokens, and project metadata in the current workspace.
3. Open the **Design** or **PPT** conversation view to see the result immediately.
4. Edit directly on the canvas or select an element and use **Ask AI** for a focused change.
5. Continue the conversation, switch templates, or undo changes; presentations can also be exported to PDF or PPTX.

## Three plugins, one creative system

| Plugin | Best for | Main capabilities |
| --- | --- | --- |
| [`deepseek-idesign`](https://www.npmjs.com/package/deepseek-idesign) | Websites, app prototypes, posters, cards, data reports, magazines, and other non-slide designs | Curated Design templates, desktop/mobile preview, direct element editing, themes and design tokens, selection-aware Ask AI |
| [`deepseek-ippt`](https://www.npmjs.com/package/deepseek-ippt) | Presentations and slide decks | Dedicated slide templates, page-by-page editing, visual refinement, selection-aware Ask AI, PDF/PPTX export |
| [`deepseek-ivideo`](https://www.npmjs.com/package/deepseek-ivideo) | Motion design, product demos, data stories, and short video | HyperFrames timeline, animation and media, 27 Video templates, selection-aware Ask AI, validation, and video export |

Install any plugin independently or use all three. They share iPolloWork Studio contracts and template protocols while keeping project directories isolated. Installing one package never downloads the other two.

## Highlights

- **Native Harness surface** — Design and PPT appear as dedicated conversation views; the iPolloWork desktop app is not required.
- **AI plus direct manipulation** — generate or restructure with AI, then refine individual elements and the global theme visually.
- **Selection-aware Ask AI** — the selected element, file location, and styles are prepared as a reviewable conversation draft and are never submitted automatically.
- **Real workspace files** — designs remain editable HTML, CSS, tokens, and metadata instead of a closed canvas or flattened screenshot.
- **Curated template catalogs** — Design and PPT have separate template entry points, so slide templates never pollute the general design catalog.
- **Reversible editing** — save, undo, and write-conflict detection protect mixed AI and manual workflows.
- **Design-system controls** — colors, typography, backgrounds, radii, shadows, spacing, and component language stay coordinated through design tokens.
- **Independent installation** — each npm package includes its browser assets and installs only the selected capability.
- **Native Video workflow** — iVideo reuses the HyperFrames timeline, visual editing, preview, validation, and export pipeline without a second video engine.

## Quick start

### Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- A current DeepSeek Harness release and pnpm for its plugin manager

DeepSeek Harness is currently a developer preview and may introduce compatibility-breaking changes. Follow its [official repository](https://github.com/deepseek-ai/deepseek-harness) for current requirements.

### Install Design only

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign
npx @deepseek-ai/dsh web
```

### Install Design, PPT, and Video

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign deepseek-ippt deepseek-ivideo
npx @deepseek-ai/dsh web
```

If `dsh` is already installed, replace `npx @deepseek-ai/dsh` with `dsh`. The Web UI is served at [http://127.0.0.1:3080](http://127.0.0.1:3080) by default.

### Update or remove

```sh
# Update
npx @deepseek-ai/dsh plugin --profile web update deepseek-idesign deepseek-ippt deepseek-ivideo

# Remove
npx @deepseek-ai/dsh plugin --profile web remove deepseek-idesign deepseek-ippt deepseek-ivideo
```

## Using the Studio

1. Start DeepSeek Harness from the directory you want to use as the workspace.
2. Create or open a conversation and choose the **Design**, **PPT**, or **Video** view.
3. Use the `+` beside Edit to open the matching template catalog, or ask the AI to start from the blank project.
4. Select elements for direct editing. Use **Ask AI** when you want Harness to make the next change, then review the prepared draft before sending it.
5. Every change remains in the current workspace and can be read or edited by later turns.

Design projects use `design/<sessionId>/`; PPT projects use `design/<sessionId>-ippt/`; Video projects use `video/<sessionId>/`.

## Security and data boundaries

- Access is limited to workspaces registered by DeepSeek Harness and paths below their `design/` directory.
- The Studio iframe uses a random per-process token and same-origin message checks.
- Writes use conflict checks and atomic replacement; template changes are staged and validated before replacing a project.
- **Ask AI** only prepares a draft in the current conversation and never submits it for the user.
- Installing these packages does not install or launch the iPolloWork desktop app; each package loads only its own Studio.

## Repository model

```text
packages/               Complete, installable plugin builds
source/plugins/         DeepSeek Harness adapter sources
source/shared/          Shared Studio protocol and types
SOURCE_COMMIT           Matching iPolloWork source commit
repository.json         Package and provenance manifest
```

[iPolloWork](https://github.com/Devin-AXIS/iPolloWork) is the single source of truth for product code. [`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) is the focused distribution and contribution entry point for Harness users.

Pull requests may update `source/` or this README. Accepted changes are imported into iPolloWork as a reviewable upstream pull request. After that pull request is merged, all three plugins are rebuilt from shared Studio sources and synchronized back here. Do not edit generated runtime files under `packages/` directly.

## Contributing

- Ideas and bug reports: [GitHub Issues](https://github.com/Devin-AXIS/deepseek-design/issues)
- Adapter contributions: open a pull request against [`source/`](https://github.com/Devin-AXIS/deepseek-design/tree/main/source)
- Core Studio and template contributions: [iPolloWork](https://github.com/Devin-AXIS/iPolloWork)

## License

This project uses the same [iPolloWork Source Available License](LICENSE) as the main iPolloWork repository. Third-party components and previously licensed portions retain their respective licenses.
