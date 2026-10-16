---
name: stage-diagrams
description: Use the 35 installed native business diagram components in the active iPolloWork video project. Edit their native text, graphics, shared data forms and seekable GSAP timelines with the standard Video Studio workflow.
---

# 商业图库原生视频组件

先阅读当前仓库的视频组件开发规范和视频插件的会话边界，再从 [组件目录](catalog.md) 选择信息结构匹配的组件。

1. 使用现有 Video Studio / HyperFrames 组件目录安装所选组件，工作范围保持在用户当前视频项目。
2. 内容通过原生文字、图层及标准变量编辑；有 `visualComponent.data` 的组件使用共用数据表格，并遵守真实行数、类型和语义限制。
   图形组合通过标准 `data-hf-group` 整体移动；文字保持直接编辑。局部图形使用现有图层面板的分组进入操作，保留分组位置节点与内部动画节点的关系。
3. AI 先调用 `media.video_component_read` 读取当前 JSON、revision、schema 和 guide，再调用 `media.video_component_write` 提交一个 data 对象与同一 revision。省略字段保持原值，数组整体替换；错误按路径修正，409 冲突先重读。Studio 的内容与 JSON 页签共享已保存的变量，JSON 应用是一笔保存与撤销。局部加工仍按 manifest 的 `visualComponent.ai.slots` 和 HTML 上对应的 `data-ipw-ai-slot` 定位局部区域。保留稳定元素 ID、主题继承和注册时间线。
4. 使用项目的 `--ipw-*` 主题令牌。无项目设置时保留组件作者默认视觉；不要另写配色、字体或参数面板。
5. 动画使用已有的暂停 GSAP 时间线，由 HyperFrames 播放与 seek。通过标准视频工具验证实际源文件、连续编辑、前后定位和短视频导出。

作者规则和几何由 `engine/specs.js` 与四类 renderer 维护。35 个组件全部通过 `tools/author.mjs` 生成原生 HTML、变量及注册元数据，并检查默认、最少、最多条目和状态机密集流转。使用仓库根目录的 `pnpm video:components:build` 更新全部组件；定向作者构建使用 `node tools/author.mjs`可在命令末尾指定组件类型以只生成部分组件。共享 JSON 转换与校验由 HyperFrames 核心的 `registry/componentContent.ts` 持有，`hyperframes/ai-adapter.mjs` 是该源码生成的独立分发版本。

行数、必填、唯一 ID、Unicode 文字长度及叶子列表容量必须投射到共用 `visualComponent.data` contract，motionRecipe 的 JSON 容量绑定使用同一 rows 变量，不另设私有校验协议。非法内容或 cue 应明确报错并保留上一有效画面，不裁掉数据。step-N 元素标记及 GSAP tween data 必须对应实际分支动作，使用宿主场景实际时长检查出现、末读和退场；少量分支按实测旁白缩短场景，不延长动作或暗中重分配默认节拍。

`pnpm video:components:build` 从作者源码生成、校验并打包五个标准组件包。安装后的更新使用既有组件库生命周期，已有视频保留用户真实内容。

不要使用自定义元素、独立图表渲染器、私有 rows/JSON 适配器、另一套编辑器或兼容实现。不要自行启动第二个制作项目或独立导出流程。

结构图、象限、Venn 面积、历程高低和轨道位置是定性表达，不能冒充实测数值。数据指标只使用用户提供或已核实的内容，保留单位、来源与不确定性；缺少输入时明确指出。
