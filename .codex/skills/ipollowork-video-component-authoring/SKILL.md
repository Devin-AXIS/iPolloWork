---
name: ipollowork-video-component-authoring
description: Develop or update reusable visual components for iPolloWork Video, including maps, charts, rankings, diagrams, openings and endings. Use for component authoring rules, manifests, editable variables, shared data forms, inherited design themes, AI editing slots and seekable HyperFrames timelines. Not for producing a whole video, authoring a full-project template, or packaging a DeepSeek host plugin.
---

# iPolloWork 视频组件开发规范

交付的是能放进视频、通过共用表单调整、跟随项目主题、可由 AI 加工的组件。不要为一个组件另做编辑器、参数面板、渲染器或宿主插件。

## 1. 开始前：以当前代码契约为准

在 iPolloWork 仓库根目录阅读 `AGENTS.md` 和维护性规范。先找同类组件，再选择扩展还是新增。以下路径均相对仓库根目录：

- `vendor/hyperframes/registry/blocks/world-map/`：地图、主题继承、结构化数据的参考。
- `vendor/hyperframes/registry/blocks/metric-signal/`：数据展示及可选动画配方的参考。
- `vendor/hyperframes/packages/core/src/registry/types.ts`：组件分类及 manifest 契约。
- `vendor/hyperframes/packages/core/src/registry/componentData.ts`：共用数据结构及解析规则。
- `vendor/hyperframes/packages/core/schemas/registry-item.json`、`packages/types/src/hyperframes.ts`：注册项和宿主校验契约。
- `vendor/hyperframes/packages/studio/src/utils/blockInstaller.ts`：真实安装、主题与变量接入方式。

不要复制这些 schema 或创建另一套数据协议。规范与代码不一致时，先核对当前消费者，不用旧示例猜测接口。

## 2. 最小交付结构

通常只需在 `vendor/hyperframes/registry/blocks/<slug>/` 放置：

```text
registry-item.json       # 元信息、变量、分类、文件和能力声明
<slug>.html              # 画面与动画
```

确有需要再加本地图片、字体、数据或预览文件；安装所需文件必须在 `files` 中声明，路径保持包内相对路径。注册到现有 `vendor/hyperframes/registry/registry.json`，不另建组件目录服务。

产品里统称“组件”，但底层类型要准确：有独立画布和时长的地图、排行榜等通常是 `hyperframes:block`；注入已有画面的片段才是 `hyperframes:component`。完整项目模板属于另一种交付，不混用。

## 3. 变量：少而有用，表单共用

- 在 manifest 的 `variables` 声明稳定的 `id`、可理解的 `label`、类型及默认值，与 HTML 的 `data-composition-variables` 保持一致。
- 沿用现有 `string / number / color / boolean / enum` 类型；数字给合理范围，枚举给选项，长文本给长度约束。不要擅自增加对象类型。
- 只暴露内容、数据、高亮、必要的布局等用户决策；不要把每个 CSS 数值都变成参数。颜色默认来自主题，不能靠用户逐项配色才能使用。
- `update: live` 仅用于能即时更新的参数；改变结构或动画时按现有机制使用 `rebuild / reload`，声明必须与实际行为一致。
- 接入现有变量更新机制，更新后 DOM 和动画都应反映新值，并保持宿主当前播放位置。不得只更改文本而让时间线仍指向旧元素。
- 使用共用变量表单和数据表格，不给单个组件新写一套面板。`motionCueTimes`、`motionStyle` 等系统控制字段不当作普通用户参数。

## 4. 数据：给 AI 结构，给用户表格

地图、路线、图表、排行榜等数据组件使用 `visualComponent.data`，声明列、语义、行标识、行数限制和绑定。沿用已有 `category-value / region-value / point-value / route-value / series-value`，选择真正匹配数据的类型。

AI 面向的标准数据是：

```json
{
  "version": 1,
  "kind": "region-value",
  "rows": [
    { "region": "China", "value": 96 },
    { "region": "Japan", "value": 77 }
  ]
}
```

列名由该组件的 `columns` 决定，不是所有组件固定使用 `region`。`rowId` 稳定且唯一，数字保持数字类型；单位、精度、高亮和替换/覆盖语义按现有契约声明。

`binding.variable` 必须对应真实变量。底层可以使用已有 `json / key-value-list / route-value-list / label-detail-list` 编码，但由共用适配层转换；不要求用户手写逗号、冒号等字符串。不要另设一份互不同步的 JSON 状态。非法数据给明确提示，不静默丢行或生成虚构数值。

## 5. 主题与分类

- 声明 `visualComponent.version: 1`、`themeMode: inherit`，按能力填写 `surfaces`；首选 `video`，未验证前不要声称支持 PPT 或网页。
- 分类沿用当前 `VISUAL_COMPONENT_CATEGORIES`，例如地图 `maps`、数据 `data`、架构/金字塔 `diagrams`。开头、结尾还可用已有 `librarySection` 定位；不要另造一套分类树。
- 使用现有主题变量，例如 `--ipw-color-bg`、`--ipw-color-surface`、`--ipw-color-text`、`--ipw-color-primary`、`--ipw-color-border`、`--ipw-font-display`、`--ipw-font-body`、`--ipw-card-radius`。
- 允许独立预览的默认回退值，但不能覆盖宿主传入的主题。主题切换后背景、文字、图形、边框和字体应协调变化；数据的语义色例外需有明确理由。
- 保持层级清楚、留白合理、中文可读。必要时用克制的渐变或玻璃质感，不以特效代替信息表达。

## 6. 动画与时间线

- 默认 HTML + CSS + GSAP；优先复用现有图形及本地 SVG。只有明确需要真实 3D 时才考虑 Three.js，不为简单地图增加重型依赖。
- 沿用现有 composition 根节点、尺寸、时长和安装机制，注册到 `window.__timelines[compositionId]` 的暂停 GSAP 时间线，由 HyperFrames 控制播放、暂停与 seek。
- 每个实例的选择器、状态和时间线只影响自己。重建时清理旧动画，不覆盖其他实例。
- 同一时刻必须得到同一画面：不要用独立计时器、自动播放循环、未固定的随机数或 CSS 自运行动画驱动关键内容。真实图片、音视频遵循现有媒体时间同步方式。
- 动画服务于讲解顺序：明确出现、强调、停留、退出；文字和数据留足阅读时间。避免所有组件同一种入场，也避免为了炫技持续运动。
- 普通组件不强制增加 `motionRecipe`。需要让 AI 按旁白调用动画配方时，才沿用已支持的配方契约；事件、cue 绑定和实际元素一致，容量与文字限制有真实依据，不伪造配音时间。

## 7. AI 加工空间

用 `visualComponent.ai.slots` 声明稳定的可编辑区域，并在 HTML 对应位置添加 `data-ipw-ai-slot`。`instructions` 简要说明用途、输入规则和需要保留的结构。

支持 AI 替换内容、调整布局、缩小地图并在旁边加说明等局部加工；保持变量 ID、数据绑定、主题继承及时间线接入不变。不强制所有加工都变成表单参数，也不为 AI 再维护一份画面。

外部文字按文本处理，不拼入可执行 HTML；不执行输入数据中的脚本，不嵌入密钥。引用地图、字体、图片等资源保留来源和授权，缺少素材时明确说明，不暗中联网替换。

## 8. 验收与交付

1. manifest、HTML 变量、AI slots、数据绑定及安装路径一致，通过当前仓库对应校验和受影响的测试。
2. 在现有 Studio 安装组件；共用表单能修改实际画面，数据表格能增删和编辑合法行。
3. 检查默认、边界、空值、长中文、错误数据和两种主题；多实例互不影响。
4. 检查从头播放、中间 seek、拖回起点、参数更新后的 seek；画面与时间线一致。
5. 用真实素材导出一段短视频，确认浏览器预览与输出一致；不能仅凭截图声称通过。
6. 交付组件文件、必要资源与来源、参数/数据示例、实际测试结果和未验证项。不复制 Studio，不改现有模板行为，不残留替代实现。

本规范只指导组件开发。发布 npm、修改宿主插件、提交 PR 或上传组件市场需按用户授权及现有发布流程另行处理。
