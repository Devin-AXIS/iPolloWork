# DeepSeek iPPT

> 由 iPolloWork 为 DeepSeek Harness 打造的原生可视化 PPT Studio。
>
> Native visual PPT Studio for DeepSeek Harness, created by iPolloWork.

[简体中文](#简体中文) · [English](#english) · [DeepSeek Design 项目](https://github.com/Devin-AXIS/deepseek-design)

---

<a id="简体中文"></a>

## 在 DeepSeek Harness 中完成整套演示文稿

`deepseek-ippt` 将 iPolloWork PPT Studio 作为原生 **PPT** 视图加入 DeepSeek Harness。AI 可以在对话中梳理叙事、生成页面和修改内容，你也可以逐页预览并直接调整文字、图片、排版、颜色、位置与视觉样式。

编辑开关旁的 `+` 只显示精选幻灯片模板，网站、App 原型、海报和报告模板不会混入其中。通用 Design 能力由独立的 [`deepseek-idesign`](https://www.npmjs.com/package/deepseek-idesign) 提供；两个插件可以同时安装。

### 核心能力

- DeepSeek Harness 对话中的原生 **PPT** 视图
- AI 生成叙事、页面与内容，支持选区级 **Ask AI**
- 逐页预览与可视化元素编辑
- 独立 PPT 模板市场
- 主题与设计令牌统一控制
- 保存、撤销与文件冲突检测
- 导出 PDF 与 PPTX
- 与 iDesign 分目录存储，互不覆盖

## 安装并启动

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-ippt
npx @deepseek-ai/dsh web
```

如果已经安装 `dsh`，可使用：

```sh
dsh plugin --profile web add deepseek-ippt
dsh web
```

DeepSeek Harness Web 界面默认运行在 [http://127.0.0.1:3080](http://127.0.0.1:3080)。打开对话后选择 **PPT**，即可进入 Studio。

### 本地发布包

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-ippt-0.1.1.tgz
dsh web
```

## 使用方式

1. 在项目目录中启动 DeepSeek Harness。
2. 创建对话并打开 **PPT** 视图。
3. 点击 `+` 选择幻灯片模板，或让 AI 从空白演示文稿开始创作。
4. 逐页查看结果，打开编辑模式精调元素。
5. 使用 **Ask AI** 继续修改叙事、页面或选中元素。
6. 完成后下载 PDF 或 PPTX。

项目保存在 `design/<sessionId>-ippt/`，可与 `deepseek-idesign` 同时使用。插件自带浏览器资源，不会安装或启动 iPolloWork 桌面端，也不会载入 Video Studio。

## 数据边界

- 只访问 DeepSeek Harness 已注册工作区中的 `design/` 目录。
- iPPT 使用独立的 `-ippt` 项目后缀，不覆盖 iDesign 文件。
- Studio iframe 使用进程级随机令牌并校验同源消息。
- 写入带冲突检查并采用原子替换。
- **Ask AI** 只准备草稿，不会自动发送消息。

## 参与贡献

请在 [`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) 仓库的 `source/plugins/deepseek-ippt` 下提交适配器改动。iPPT 与 iDesign 共用同一套 iPolloWork Design Studio，核心能力会从主库统一升级，不需要维护第二套编辑器。

---

<a id="english"></a>

## Build complete presentations inside DeepSeek Harness

`deepseek-ippt` adds iPolloWork PPT Studio to DeepSeek Harness as a native **PPT** conversation view. The AI can shape the narrative, create slides, and revise content through conversation, while you can preview every page and directly refine text, images, layout, color, position, and visual styles.

The `+` beside Edit shows only curated slide templates; websites, app prototypes, posters, and reports stay out of this catalog. General Design work is provided by the separate [`deepseek-idesign`](https://www.npmjs.com/package/deepseek-idesign) package, and both plugins can be installed together.

### Highlights

- Native **PPT** view inside DeepSeek Harness conversations
- AI-generated narratives, pages, and content with selection-aware **Ask AI**
- Page-by-page preview and direct element editing
- Dedicated presentation template catalog
- Shared themes and design-token controls
- Save, undo, and write-conflict detection
- PDF and PPTX export
- Isolated project path that never overwrites iDesign work

## Install and run

```sh
npx @deepseek-ai/dsh plugin --profile web add deepseek-ippt
npx @deepseek-ai/dsh web
```

If `dsh` is already installed:

```sh
dsh plugin --profile web add deepseek-ippt
dsh web
```

The Web UI is served at [http://127.0.0.1:3080](http://127.0.0.1:3080) by default. Open a conversation and choose **PPT** to enter the Studio.

### Local release artifact

```sh
pnpm pack
dsh plugin --profile web add ./deepseek-ippt-0.1.1.tgz
dsh web
```

## Workflow

1. Start DeepSeek Harness in the directory you want to use as the workspace.
2. Create a conversation and open the **PPT** view.
3. Choose a slide template with `+`, or ask the AI to start from the blank deck.
4. Review each page and enable Edit for direct refinement.
5. Use **Ask AI** to revise the narrative, page, or selected element.
6. Download the finished presentation as PDF or PPTX.

Projects stay under `design/<sessionId>-ippt/`, so the package can run beside `deepseek-idesign`. It includes its browser assets and does not install or launch the iPolloWork desktop app or Video Studio.

## Data boundary

- Access is limited to the `design/` directory of workspaces registered by DeepSeek Harness.
- The `-ippt` project suffix keeps presentation files separate from iDesign.
- The Studio iframe uses a random per-process token and same-origin message checks.
- Writes use conflict detection and atomic replacement.
- **Ask AI** prepares a draft and never submits a message automatically.

## Contributing

Propose adapter changes under `source/plugins/deepseek-ippt` in the [`deepseek-design`](https://github.com/Devin-AXIS/deepseek-design) repository. iPPT and iDesign share one iPolloWork Design Studio, so core capability upgrades flow from the main repository without maintaining a second editor.
