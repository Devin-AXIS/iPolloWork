# DeepSeek iDesign

> 由 iPolloWork 为 DeepSeek Harness 打造的原生可视化 Design Studio。
>
> Native visual Design Studio for DeepSeek Harness, created by iPolloWork.

[简体中文](#简体中文) · [English](#english) · [DeepSeek Design 项目](https://github.com/Devin-AXIS/deepseek-design)

---

<a id="简体中文"></a>

## 让 DeepSeek Harness 真正拥有设计能力

`deepseek-idesign` 将 iPolloWork Design Studio 作为原生 **Design** 视图加入 DeepSeek Harness。AI 可以根据对话创建和修改设计文件，你也可以在同一个界面里直接选中元素，精调文字、字体、颜色、尺寸、间距、背景、链接与图片。

它适合网站、App 原型、海报、信息卡、数据报告、杂志文章等非幻灯片设计。编辑开关旁的 `+` 会打开专属 Design 模板市场；PPT 模板由独立的 [`deepseek-ippt`](https://www.npmjs.com/package/deepseek-ippt) 提供，Video Studio 不包含在本包中。

### 核心能力

- 作为 DeepSeek Harness 对话中的原生 **Design** 视图运行
- AI 对话生成、全局修改与选区级 **Ask AI**
- 画布内文字、排版、颜色、尺寸、间距、背景、链接和图片编辑
- 桌面与移动端预览
- 主题与设计令牌统一控制
- Design 模板市场
- 保存、撤销与文件冲突检测
- 真实 HTML、CSS 和项目文件保存在当前 Harness 工作区

## 安装并启动

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign
npx @deepseek-ai/dsh web
```

如果已经安装 `dsh`，可使用：

```sh
dsh plugin --profile web add deepseek-idesign
dsh web
```

DeepSeek Harness Web 界面默认运行在 [http://127.0.0.1:3080](http://127.0.0.1:3080)。打开对话后选择 **Design**，即可进入 Studio。

### 本地发布包

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-idesign-0.2.1.tgz
dsh web
```

## 使用方式

1. 在项目目录中启动 DeepSeek Harness。
2. 创建对话并打开 **Design** 视图。
3. 点击 `+` 选择模板，或直接让 AI 创建设计。
4. 打开编辑模式并选择画布元素进行精调。
5. 点击 **Ask AI** 时，插件会把当前元素和文件信息填入对话草稿；确认后再由你发送。

项目保存在 `design/<sessionId>/`。插件自带浏览器资源，不会安装或启动 iPolloWork 桌面端，也不会载入 PPT 或 Video Studio。

## 数据边界

- 只访问 DeepSeek Harness 已注册工作区中的 `design/` 目录。
- Studio iframe 使用进程级随机令牌并校验同源消息。
- 写入带冲突检查并采用原子替换。
- **Ask AI** 只准备草稿，不会自动发送消息。

## 参与贡献

请在 [`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) 仓库的 `source/plugins/deepseek-idesign` 下提交适配器改动。合并后的修改会作为可审查 PR 回到 iPolloWork 主库，并在上游合并后重新构建、同步和发布。

---

<a id="english"></a>

## Give DeepSeek Harness a native design capability

`deepseek-idesign` adds iPolloWork Design Studio to DeepSeek Harness as a native **Design** conversation view. Harness can create and edit the project through conversation, while you can select elements in the same surface and refine text, typography, color, size, spacing, backgrounds, links, and images directly.

It is designed for websites, app prototypes, posters, information cards, data reports, magazines, and other non-slide work. The `+` beside Edit opens the dedicated Design template catalog. Slides are provided by [`deepseek-ippt`](https://www.npmjs.com/package/deepseek-ippt); Video Studio is not part of this package.

### Highlights

- Native **Design** view inside DeepSeek Harness conversations
- Conversational generation, broad AI changes, and selection-aware **Ask AI**
- Direct canvas editing for content, layout, media, and visual styles
- Desktop and mobile preview
- Shared themes and design-token controls
- Curated non-slide template catalog
- Save, undo, and write-conflict detection
- Real HTML, CSS, and project files in the active Harness workspace

## Install and run

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign
npx @deepseek-ai/dsh web
```

If `dsh` is already installed:

```sh
dsh plugin --profile web add deepseek-idesign
dsh web
```

The Web UI is served at [http://127.0.0.1:3080](http://127.0.0.1:3080) by default. Open a conversation and choose **Design** to enter the Studio.

### Local release artifact

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-idesign-0.2.1.tgz
dsh web
```

## Workflow

1. Start DeepSeek Harness in the directory you want to use as the workspace.
2. Create a conversation and open the **Design** view.
3. Choose a template with `+`, or ask the AI to create a design from the blank project.
4. Enable Edit and select canvas elements for direct refinement.
5. Use **Ask AI** to prepare a focused change as a conversation draft, then review and send it yourself.

Projects stay under `design/<sessionId>/`. The package includes its browser assets and does not install or launch the iPolloWork desktop app, PPT Studio, or Video Studio.

## Data boundary

- Access is limited to the `design/` directory of workspaces registered by DeepSeek Harness.
- The Studio iframe uses a random per-process token and same-origin message checks.
- Writes use conflict detection and atomic replacement.
- **Ask AI** prepares a draft and never submits a message automatically.

## Contributing

Propose adapter changes under `source/plugins/deepseek-idesign` in the [`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) repository. Accepted changes return to iPolloWork as a reviewable pull request, then are rebuilt, synchronized, and released after the upstream change is merged.
