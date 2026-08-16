# DeepSeek iVideo

> 由 iPolloWork 为 DeepSeek Harness 打造的原生 HyperFrames Video Studio。
>
> Native HyperFrames Video Studio for DeepSeek Harness, created by iPolloWork.

[简体中文](#简体中文) · [English](#english) · [DeepSeek Design 项目](https://github.com/Devin-AXIS/deepseek-design)

---

<a id="简体中文"></a>

## 让 DeepSeek Harness 真正拥有视频创作能力

`deepseek-ivideo` 将 iPolloWork 的同一个 Video Studio 作为原生 **Video** 视图加入 DeepSeek Harness。它直接复用 iPolloWork 的 `VideoPanel` 和定制 HyperFrames 时间线、可视化编辑器、动画系统、预览及视频导出能力，不维护第二套编辑器、顶部栏或渲染链路。

你可以让 Harness 从对话生成或修改整段视频，也可以在画面中选中标题、图片、素材或其他元素，通过 **Ask AI** 只修改当前对象。所有操作仍落在当前工作区的真实 HTML、CSS、素材和项目文件中，可继续手动精调、预览和导出。

### 核心能力

- DeepSeek Harness 对话中的原生 **Video** 视图
- HyperFrames 时间线、可视化编辑、动画、素材和实时预览
- 27 个内置可编辑 Video 模板
- 整段视频与选区级 **Ask AI**
- `ipollowork_video_validate` 自动校验工具
- HyperFrames 原生视频导出
- 每个工作区会话独立运行，空闲自动回收
- 真实项目保存在 `video/<sessionId>/`

首版不包含语音克隆、语音设置和 iPolloWork 全局 Design System 抽屉。

## 安装并启动

要求 Node.js 22 或更高版本。发布包内置从 iPolloWork 主仓库构建的定制 HyperFrames 运行时，当前源版本为 `0.7.60`；不会在安装时另外下载同名公共 npm 版本。

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-ivideo
npx @deepseek-ai/dsh web
```

如果已经安装 `dsh`：

```sh
dsh plugin --profile web add deepseek-ivideo
dsh web
```

DeepSeek Harness Web 界面默认运行在 [http://127.0.0.1:3080](http://127.0.0.1:3080)。打开对话后选择 **Video** 即可进入 Studio。

### 本地发布包

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-ivideo-0.1.1.tgz
dsh web
```

## 使用方式

1. 在项目目录中启动 DeepSeek Harness。
2. 创建对话并打开 **Video** 视图。
3. 点击顶部 **模板** 选择一个视频模板，或从空白项目开始。
4. 在对话中让 AI 生成或修改视频；也可以选中画面元素后点击 **Ask AI**。
5. 在时间线中预览并精调，最后使用 HyperFrames 原生导出功能生成视频。

**Ask AI** 只会把经过校验的文件、元素定位、文字、素材和样式信息写入当前对话草稿，不会自动发送或直接执行。

## 安全与运行边界

- 只访问 DeepSeek Harness 已注册工作区中的 `video/<sessionId>/`。
- 拒绝目录穿越和逃逸工作区的符号链接。
- Studio 接口使用进程级随机令牌；跨 iframe 消息同时校验来源窗口和来源地址。
- 模板应用先停止预览、暂存并原子替换；失败时恢复旧项目，再重新启动。
- 并发启动会合并；端口冲突会安全回退；只回收插件自己创建的进程。
- 模型校验工具返回有限、结构化的结果，不提供任意文件访问。

## 参与贡献

请在 [`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) 仓库的 `source/plugins/deepseek-ivideo` 下提交适配器改动。iPolloWork 主仓库是唯一上游代码源；贡献会作为可审查 PR 回流，合并后再统一构建、同步和发布三个插件。

---

<a id="english"></a>

## Give DeepSeek Harness a native video capability

`deepseek-ivideo` adds the same Video Studio used by iPolloWork to DeepSeek Harness as a native **Video** conversation view. It directly reuses iPolloWork's `VideoPanel` and customized HyperFrames timeline, visual editor, animation system, preview, and export pipeline—there is no second editor, top bar, or renderer to maintain.

Ask Harness to generate or revise the whole video, or select a heading, image, media item, or other visual element and use **Ask AI** for a focused change. The result remains real HTML, CSS, assets, and project files inside the active workspace, ready for visual refinement, preview, and export.

### Highlights

- Native **Video** view in DeepSeek Harness conversations
- HyperFrames timeline, direct manipulation, animation, media, and preview
- 27 bundled editable Video templates
- Whole-video and selection-aware **Ask AI**
- `ipollowork_video_validate` model tool
- Native HyperFrames video export
- Session-scoped runtimes with idle cleanup
- Real projects under `video/<sessionId>/`

The first release intentionally excludes voice cloning, voice settings, and the global iPolloWork Design System drawer.

## Install and run

Node.js 22 or newer is required. The release artifact embeds the customized HyperFrames runtime built from the iPolloWork source repository, currently at source version `0.7.60`; installation does not fetch the public npm package with the same name.

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-ivideo
npx @deepseek-ai/dsh web
```

If `dsh` is already installed:

```sh
dsh plugin --profile web add deepseek-ivideo
dsh web
```

The Web UI is served at [http://127.0.0.1:3080](http://127.0.0.1:3080) by default. Open a conversation and choose **Video**.

### Local release artifact

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-ivideo-0.1.1.tgz
dsh web
```

## Workflow

1. Start DeepSeek Harness from the directory you want to use as the workspace.
2. Create a conversation and open the **Video** view.
3. Choose a template from the top bar, or start with the blank project.
4. Generate or revise through conversation; select an element and use **Ask AI** for a focused edit.
5. Preview and refine on the timeline, then export through HyperFrames.

**Ask AI** places validated file, locator, text, media, and style context into the conversation draft. It never submits or executes the request automatically.

## Security and runtime boundaries

- Access is limited to `video/<sessionId>/` in workspaces registered by DeepSeek Harness.
- Path traversal and workspace-escaping symbolic links are rejected.
- Studio APIs use a random per-process token; iframe messages validate both source window and origin.
- Template changes stop preview, stage and atomically replace the project, restore on failure, then restart.
- Concurrent starts coalesce, occupied ports fall back safely, and only plugin-owned processes are reclaimed.
- The validation tool returns bounded structured results and cannot read arbitrary files.

## Contributing

Propose adapter changes under `source/plugins/deepseek-ivideo` in the [`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) repository. The iPolloWork repository remains the single upstream source; accepted contributions return as reviewable pull requests before all three plugins are rebuilt, synchronized, and released together.
