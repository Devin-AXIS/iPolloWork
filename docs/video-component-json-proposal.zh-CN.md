# 35 个视频图解组件：可视化、JSON 与 AI 共用的数据方案

日期：2026-10-07。状态：最初方案及实施记录。第 1～10 节保留初审依据；当前已实现的接口、镜头与规则见第 12 节，源码与生成的 schema 优先。

## 1. 结论与边界

全部 35 个组件都提供完整内容 JSON。表单、画布和 JSON 编辑同一份内容；AI 提交这一份内容对象。数量、层级、引用、文字与排版校验共用，保存和撤销共用。

这次审查覆盖全部 35 个组件的声明、变量映射、渲染器与 Studio 数据编辑入口。下文的“当前”是源码中的声明；“建议”是待落实与验证的设计。当前最大数量没有经过所有边界组合的播放验收，不能据此承诺任意合法输入都好看。

第一版保持现有组件的结构用途。固定 2、3、4、5、7 项的组件，不因为有 JSON 就自动变成任意数量或任意深度的图编辑器。需要更多内容时，缩短、分镜，或选更适合的组件。

## 2. 当前查到的具体问题

| 问题 | 当前证据与影响 | 需要补充 |
|---|---|---|
| 主列表 JSON 不等于完整组件 | 主列表是扁平 rows，其余标题、核心、参与者和回路等在独立变量或 base 样例里 | 一个完整内容对象，包含主列表、关联对象和所有可见字段 |
| 子层级难理解 | 系统架构用 node1～node4；树用 child1～child3；环形生态用 group1/group2 的分隔字符串 | 有边界的自然数组，不让 AI 拼序号或分隔符 |
| 关系沿用样例 | 架构、泳道、流水线、状态的部分连线结构没有完整编辑入口 | 显式关系集合、稳定 ID、引用校验；禁止隐藏继承示例关系 |
| 改名影响连接 | 架构无 ID 时按名称连接；时序与泳道支持名称匹配 | 名称只负责显示，所有引用用 ID |
| 无效引用静默处理 | 泳道、时序找不到角色时可回退第一列；部分连线找不到节点直接跳过 | 返回准确路径，整次修改不应用 |
| 文字上限缺少排版依据 | specs 最后将文字长度统一乘 4，中文也放宽；另有按样例放大长度的 fit | 按字段显示位置测量，保留行数与阅读字号限制 |
| 超长内容可能隐藏 | native 文本有 line-clamp/overflow:hidden；card 的固定尺寸与换行测量可能不一致 | 内容完整性与实际几何检查，不能靠裁切“通过” |
| 有编辑项没有显示位置 | capsule 有子步骤时主阶段 label 不显示；bowtie 左侧 item.desc 没有显示 | 增加显示位置或取消该侧字段；本方案采用补显示位置 |
| 样例数值残留 | stat 主 progress 未完整暴露，缺失时渲染器有默认进度；hub/stack 的 figure.progress 也需一起核清 | 未提供真实进度时不画进度，不从示例填值 |
| JSON 可能丢失层级字段 | 当前 core normalizeRows 只复制声明列，未声明字段不会保留 | 扩展完整内容契约，不能将富 JSON 经旧 rows 解析后保存 |
| AI 操作说明与工具需要对齐 | 现有格式化输出列出 set/upsertRows/removeRows；本次未确认每项都有可调用写入入口 | 第一版只暴露一个真实可调用的整对象写入操作 |
| 动画以行号绑定 | 当前 step-N 随重排行位置变化 | 内容身份用稳定 ID；动画语义目标按 ID，旧 step-N 由适配器转换 |

## 3. 最简单的使用方式

### 3.1 用户界面

组件详情内两个页签：**内容 / JSON**。内容页使用现有表单，复杂结构加折叠层级列表与引用选择器；JSON 页用同一数据的格式化表示，带复制、校验和应用。画布双击文字同样写回该内容。

- JSON 页输入中只保留草稿，未通过校验不写入正式内容；预览继续显示上一次有效结果。
- 点击应用，先完成结构、引用和排版检查，再原子替换正式内容；一次撤销恢复整个修改。
- 未应用草稿存在时，切页签可以保留草稿；继续修改可视化前明确选择应用或放弃草稿，避免两份版本互相覆盖。
- 外部 AI 更新时检查组件 revision。草稿所基于的 revision 过期，显示冲突并让用户重新载入/对比，不做盲目覆盖。
- 复杂字段可以通过折叠表单编辑；画布不需要能拖动每种关系，但切回表单不能丢掉合法 JSON 中的任何内容。
- 有限数量列表用“3 / 6”“子项 2 / 3”提示。达到上限禁用新增；批量粘贴、JSON、AI 仍经过同一校验。
- 删除被引用对象时，展示受影响关系，可选择连同关系删除；最后提交的数据必须整体有效。

### 3.2 AI 入口

复用现有组件读写通道，逻辑上只需要两个能力：读取当前组件；提交完整内容。下面名字描述拟议接口，并非宣称已有这些工具。

```text
读取组件(instanceId)
  -> componentType, revision, data, 当前组件的 schema, 简短 rules, 一个最小示例

设置组件内容(instanceId, expectedRevision, data)
  -> applied, revision, errors[]
```

AI 得到对象参数，不需要把 JSON 再转成转义字符串，不需要操作画布、点控件、写 HTML/CSS、指定像素尺寸或生成主题颜色。内部序列化适配器负责兼容旧变量。

规则只返回当前组件的一份，不把 35 份全塞进每次请求。schema 是精确字段定义；rules 说明用途和不能从类型约束中表达的关系；示例与默认数据满足同一规则。简短说明从规则生成，避免维护两份相互矛盾的限制。

第一版采用整对象替换。数据容量很小，这样修改节点和连线可以一起校验，减少 AI 写补丁路径的负担。暂不增加 set/upsert/remove 等多套写法。

示例错误：

```json
{
  "applied": false,
  "errors": [
    {
      "code": "too_many_items",
      "path": "/layers/1/nodes",
      "actual": 5,
      "expected": {"min": 1, "max": 4},
      "suggestion": "这一层最多 4 个节点，请合并内容或拆成另一个场景。"
    }
  ]
}
```

错误必须可定位；不能返回模糊的“格式错误”，也不能截掉第五项后报告成功。AI 修正完整对象再次提交。

### 3.3 内部只保留一套正式数据

```text
可视化表单 / 画布 / JSON 草稿 / AI 对象
                  ↓
      同一个 schema + 关系校验 + 排版预检
                  ↓
         一份正式内容 + revision + undo
                  ↓
           同一个组件渲染器与动画绑定
```

不另建 JSON 编辑状态库，不另造第二套组件，不为每个图做独立编辑器。复用组件注册表、变量保存、表单、撤销与现有渲染通道。

持久化需有 schemaVersion，但放在实例元数据中。用户编辑的内容 JSON 不重复填写 componentType/version/encoding/kind 等包装字段。旧数据只在迁移/导入边界转换；转换后不长期同步维护扁平 rows 与富 data 两份正式内容。

## 4. 所有组件共用的精确规则

### 4.1 数据与字段

- schema 只接受该组件声明的字段，未知字段明确报错，不能静默删除。
- 可显示对象使用 id 与 label；id 是非空字符串，模式 `[a-z][a-z0-9_-]{0,31}`，全组件内唯一。UI 创建对象可生成 ID，AI 沿用已有 ID，新建时使用简短语义 ID。
- 关系使用 `{id, from, to, label?}` 对象，不用数组元组；是否允许 label 按组件声明，架构初版连线没有标签。
- 引用必须指向已有且类型正确的对象。改 label 不改 id；移动数组顺序不改 id。删除、替换、重排后重新校验引用和动画目标。
- 列表是真实数组；没有子项用 `[]`。标量可选项省略，不能用空对象表示有效项目。required label 去除首尾空格后至少一个可见字符。
- 布尔值是真正的 true/false；数字是真正的有限数值。禁止 yes/no、数字字符串、NaN、Infinity。
- 可选文字空字符串在应用前规范为省略；必填文字空字符串报错。列表内空项报错，不静默压缩。规范化结果必须返回并同步显示。
- optional icon 只允许注册表里的图标名；highlighted 为 optional boolean，默认 false，只在有对应样式的字段提供。
- 可选 metric 为 `{value, unit?, label?, progress?}`；提供 metric 就必须有 value。value 是展示字符串，progress 是真实数值 0～1，不能自动从展示字符串猜测。
- 没有提供 metric/progress 时不出现对应数值/进度。样例数据仅在显式插入演示模板时使用。
- 只有 schema 声明的字段能编辑。本文提到可选字段“0～1”表示对象或字段可省略，不能出现两份。
- 枚举按 schema 精确值提交；UI 可中英文显示选项，但保存的标识保持不变。

### 4.2 文字规则：字符数与真实排版一起检查

后面 `8×1` 表示**最多 8 个全角文字宽度的预算、最多 1 行**；`18×2` 表示总预算 18、最多 2 行，不是每行 18。它是建议的初版写作与测量预算，尚待对应布局验收。

中文、英文和混合文案共用这一显示预算，不再统一把中文字符上限乘 4。AI 可获得“建议短标题”“最多两行”和本地化示例，无需自己精确计算英文宽度。

- 廉价预检可估算全角=1、普通拉丁字符≈0.55；最终按实际字体、字号、字重、可用宽度、图标占位、换行和行高测量，估算不能替代验收。
- 所有短文本设置 128 Unicode 码点的输入硬上限；caption.description 是 256。这个是输入大小边界，排版检查仍会更早拒绝多数长文。
- 标签中的换行由渲染器安排；标题、节点 label 不接受手写换行。说明字段允许换行，但总预算与行数不变。
- 标签/正文最小字号不得低于组件登记的阅读字号，不能为了塞进更多内容无限缩小。过长返回路径、行数、测得宽度及改写建议。
- 文字实际容器宽度比预算更窄时，以实际宽度为准；换字体、图标、语言、横竖版、卡片/海报布局后都重新预检。
- 每个字段登记 textRole、maxLines、可用区域和最小字号；主题可改色，不能绕过内容/布局限制。

共用可选 caption：`{title?, description?, eyebrow?}`，title `24×2`、description `60×3`、eyebrow `12×1`；特定组件自身更窄的标题预算覆盖该默认。卡片/海报使用同一 caption，旧 heading/headline 等由边界适配，不让 AI 同时维护两个同义标题。无外框的布局若不显示 caption，编辑器明确标注其适用布局。

### 4.3 数量不是唯一排版规则

必须一起验证：主列表数量、每个子列表数量、总节点数、深度、同列密度、关系数量、关系方向、标签宽度、最终几何。

预检需检查可见文本未裁切，语义节点/标签没有越界或遮盖，不可读的连线标签冲突，且所有可编辑内容确实出现在声明的显示位置。分区、同心圈、胶囊等设计本来有重叠，按组件语义登记允许关系，不使用“任何 bounding box 重叠都报错”的粗糙规则。装饰光效允许溢出，语义内容不允许。

超出数量硬限制直接报错；数量合规但排版仍冲突时，尝试组件已支持的有限自动布局。仍放不下则报错，建议简化或分场景，不能截断、静默遗漏、自动合并事实或把文字缩到不可读。

## 5. 35 个组件容量总表

“当前”来自 specs/manifest；“建议”含新增组合限制，不代表已上线。固定数量意味着该版页面结构就是这些槽位。

| # | 组件 / type | 当前主数量 | 建议完整容量与层级 |
|---|---|---|---|
| 01 | 决策流程 decision | 2～3 分支 | 起点 1、问题 1、分支 2～3，每分支条件/行动/结果各 1；列标题固定 4 |
| 02 | 思维导图 mindmap | 2～6 分支 | 中心 1；每分支 0～4 叶子；总叶子建议≤12；最多中心→分支→叶子 3 层 |
| 03 | 里程碑时间线 timeline | 2～8 项 | 每项日期/说明各 0～1；current 最多 1；无子层 |
| 04 | 交集关系 venn | 固定 2 集合 | 每集合 0～4 要点，交集 1、交集要点 0～4；初版不提供第三集合 |
| 05 | 用户旅程 journey | 2～6 阶段 | 每阶段行动/触点各 1、描述 0～1、体验位置 0～1；行标题固定 2 |
| 06 | 产品路线图 roadmap | 2～6 任务 | 周期固定 4；每任务区间或里程碑 1；now 0～1 |
| 07 | 定位象限 quadrant | 2～5 点 | 坐标轴固定 2、象限名固定 4；位置各 0～1，点与标签不能拥挤 |
| 08 | 能力对比 matrix | 2～6 行 | 产品列固定 3；每行值固定 3；无第四列、无额外层级 |
| 09 | 层级结构 tree | 2～3 分支 | 根 1；每分支 0～3 子项；总节点≤13；最多 3 层 |
| 10 | 泳道协作 swimlane | 2～6 步骤 | 泳道固定 3；列 0～3；每泳道/列最多 1 步骤；显式连线建议 0～6 |
| 11 | 循环飞轮 cycle | 3～5 阶段 | 中心 1；闭环由顺序生成；无任意跨节点边 |
| 12 | 流水线 / 依赖 pipeline | 固定 7 节点 | 初版仍固定 7；显式边建议 6～8，必须连通且无环；2～6 列，每列≤3 节点 |
| 13 | 汇聚转化 funnel | 3～7 来源 | 核心 1、产出固定 3；关系自动生成，非数值漏斗 |
| 14 | 鱼骨归因 fishbone | 2～6 类别 | 问题 1；每类别 0～2 原因；最多问题→类别→原因 3 层 |
| 15 | 集成中枢 hub | 3～6 节点 | 核心 1；可选数字 0～1；只支持核心与外围关系 |
| 16 | 平台分层 stack | 2～4 层 | 每层 0～3 项；可选数字 0～1；层内不再嵌套 |
| 17 | 系统架构 architecture | 2～4 层 | 建议每层 1～4 节点，总≤16；连线建议 0～8；初版跨相邻层；层内节点不再嵌套 |
| 18 | 时序交互 sequence | 2～8 消息 | 参与者固定 5；消息双方按 ID；自消息需要边界检查 |
| 19 | 状态流转 state | 固定 5 状态 | 初版固定 5 状态、7 条转移与现有拓扑；initial 1；终止态 0～5 |
| 20 | 轨道生态 orbit | 2～3 圈 | 建议每圈 1～6 成员；总成员建议≤14；中心→圈→成员 3 层 |
| 21 | 增长曲线 scurve | 2～4 阶段 | 曲线 1～2 条；位置 0～1；curve 枚举 1/2；第二曲线可关 |
| 22 | 同心圈层 rings | 2～4 圈 | 每圈标题 1、副标题/说明各 0～1；没有圈内成员列表 |
| 23 | 数据高光 stat | 1～3 辅助数据 | 主数据 1；每个数据进度 0～1 个且值在 0～1；不得沿用演示进度 |
| 24 | 前后对比 versus | 固定 2 侧 | 每侧 0～4 要点、数字 0～1；不能追加第三侧 |
| 25 | 立体分区盘 disc | 2～8 分区 | 组固定 2；第一组 0～3 要点，第二组 2～8 分区；等分扇区 |
| 26 | 菱形框架 diamond | 固定 4 外圈 | 内交叠固定 4、中心 1、固定 4 角注槽（每槽 0～1 条） |
| 27 | 关键拐点曲线 valley | 固定 4 时刻 | 关键区间 1、结局固定 2；结局接第三时刻；位置/间距一起验证 |
| 28 | 胶囊流程 capsule | 固定 5 阶段 | 组固定 3、回路固定 2；每阶段 0～3 子步骤；建议有子步骤阶段≤2、总子步骤≤6 |
| 29 | 双核映射 bridge | 固定 2 侧 | 每侧 0～4 项、中间层固定 3；初版保持内建映射关系 |
| 30 | 圈层扩张 zones | 固定 4 区域 | 每区域 0～4 注释，上方≤2、下方≤2；无第五区域 |
| 31 | 环形生态 radial | 2～3 方向 | 中心 1、每方向 0～2 组、每组 0～3 叶子；总叶子≤18；最多 4 层 |
| 32 | 汇聚发散 bowtie | 固定 2 侧 | 每侧 0～6 项、数字 0～1；中心 1；左说明需补显示位置 |
| 33 | 立体象限 cube | 固定 4 格 | 坐标轴固定 3；额外策略 0～1；不能任意增加格子 |
| 34 | 迭代回路 loops | 固定 3 回路 | 阶段固定 6、衔接标签固定 6；回路引用阶段 ID；宽度由渲染器控制 |
| 35 | 嵌套胶囊 nested | 2～4 层次 | 每层说明 0～1；位置 up/down；按小→大排序，不能再加子列表 |

新增的总叶子、总成员、总子步骤与关系上限是保守设计候选，要用现有例子和边界样例实际预览后冻结。不应直接把候选值当成已经验证的事实。

## 6. 每个组件的完整字段与特殊规则

以下是建议的内容模型；自然字段名与现有扁平变量不同，旧字段由适配器转换。`*` 为必填；数组元素 ID 按公共规则。只提供列出的 optional 字段，不自动给每种节点加一套无显示位置的字段。共用 caption 不在每段重复。

### 01 decision：决策流程

- `start* {label*, subtitle?, icon?}`：10×1、14×1；`question* {label*, icon?}`：14×2。
- `columns*` 固定 4 个非空文字，各 8×1，对应输入、判断、行动、结果。
- `branches* [ {id*, condition*, action*, outcome*, highlighted?} ]` 2～3。
- condition 6×1；action `{label*, icon?}` 14×2；outcome `{label*, icon?}` 12×2。
- 结构自动连线，每分支都有结果；不给任意新层级或自由图关系。

### 02 mindmap：思维导图

- `center* {label*, subtitle?, icon?}`：14×2、14×1。
- `branches* [{id*, label*, subtitle?, icon?, highlighted?, leaves*}]` 2～6；label 10×2、subtitle 18×2。
- leaves 0～4 个 `{id*, label*}`，各 12×2；建议总叶子≤12。
- 不允许 leaves 再带 children。6 分支时不能默认所有分支各塞满 4 个叶子。

### 03 timeline：里程碑时间线

- `items* [{id*, label*, date?, description?, icon?, current?}]` 2～8。
- label 10×2、date 18×1、description 28×2；current boolean，最多 1 项为 true。
- 数组就是呈现顺序。date 是显示标签，不按日期差分配横向距离；日期一致也不能重叠。

### 04 venn：交集关系

- `sets* [{id*, label*, subtitle?, icon?, items*}]` 固定 2；label 8×1、subtitle 18×2。
- 每集合 items 0～4 个 `{id*, label*}`，各 8×1。
- `overlap* {label*, icon?, items*}`，label 14×2；items 0～4，各 8×1。
- 圆大小不表达比例；第三集合拒绝。当前两集合版显示 4 个要点，不能把未启用三集合分支的行为误当成现有缺陷。

### 05 journey：用户旅程

- `actionLabel*`、`touchLabel*` 各 10×1。
- `stages* [{id*, label*, experience*, action*, touchpoint*, note?, icon?, highlighted?}]` 2～6。
- label 7×1；experience 数字 0～1；action/touchpoint 各 16×2；note 20×2。
- experience 是定性曲线位置。没有体验数据不能从样例复制，AI 需确认或采用其他组件。

### 06 roadmap：产品路线图

- `periods*` 固定 4 个非空文字，各 10×1。
- `tasks* [{id*, label*, owner?, start*, end?, note?, icon?, highlighted?}]` 2～6。
- label 10×1、owner 8×1、note 10×1；start/end 为 0～4 的有限数。
- 省略 end 表示里程碑；提供 end 时必须 start<end，零宽区间不能冒充任务条。
- 可选 `now {position*, label?}`，position 0～4、label 6×1；位置为周期坐标，非像素或日期字符串。

### 07 quadrant：定位象限

- `axes* {x*, y*}`，每轴 `{label*, low*, high*}`，各 8×1；`quadrants*` 固定 4 个名字，各 8×1。
- `points* [{id*, label*, subtitle?, x*, y*, icon?, highlighted?}]` 2～5。
- label 10×1、subtitle 8×1；x/y 数字 0～1。
- 允许归一化语义位置，禁止像素定位；重复位置或标签碰撞必须处理后才能应用，边缘点也必须容得下标签。

### 08 matrix：能力对比

- `columns* [{id*, label*}]` 固定 3，label 12×1。
- `rows* [{id*, label*, description?, icon?, values*}]` 2～6；label 12×1、description 18×2。
- values 固定 3，与 columns 顺序对应；每格为数字枚举 0/1/2 或非空短字符串 8×1。数字与文本通过 JSON 类型区分，文本价格不会被猜成支持等级。
- 可选 tag 6×1、scoreLabel 12×1、legend 40×2。移列必须同步 values；第一版不开放增列。

### 09 tree：层级结构

- `root* {id*, label*, subtitle?, icon?, children*}`；label/subtitle 各 12×2。
- root.children 2～3 个 `{id*, label*, subtitle?, icon?, highlighted?, children*}`；label 8×1、subtitle 10×1。
- 分支 children 0～3 个 `{id*, label*, icon?, highlighted?}`；label 8×1。
- 深度最多 3 个可见层，节点≤13；第三级不能再出现 children，不提供任意递归树。

### 10 swimlane：泳道协作

- `lanes* [{id*, label*, subtitle?, icon?}]` 固定 3；label 8×2、subtitle 10×1。
- `steps* [{id*, label*, laneId*, column*, icon?, highlighted?}]` 2～6；label 10×1。
- column 整数 0～3；laneId 必须存在；同一 laneId+column 只能有一个步骤。
- `links* [{id*, from*, to*, label?}]` 建议 0～6；label 6×1；不允许自连或重复边。
- 第一版只允许向后一列/更后列，或同列跨泳道交接。反向回流用其他组件或待验证的路由扩展，避免现有箭头方向/避让错误。

### 11 cycle：循环飞轮

- `center* {label*, subtitle?, icon?}`：10×2、14×1。
- `stages* [{id*, label*, description?, icon?, highlighted?}]` 3～5；label 6×1、description 14×2。
- 首尾闭环按数组顺序生成，不重复让 AI 提交一份 links；换顺序改变闭环顺序。

### 12 pipeline：流水线 / 依赖

- `nodes* [{id*, label*, subtitle?, icon?, highlighted?}]` 初版固定 7；label 8×1、subtitle 10×1。
- `links* [{id*, from*, to*, label?}]` 建议 6～8；label 6×1。
- 无自连、重复边、悬空引用；底层无向图连通，方向图无环；按拓扑分层 2～6 列，每列≤3，入/出度各≤2。
- 可选 `callouts [{id*, label*, description?, highlighted?}]` 固定 3 个，label/description 各 14×2；不需要时整体省略，不留隐形样例点。
- “up to seven”的旧用途说明与固定 7 声明不一致，先统一成固定 7。2～7 的弹性版需另做数量/拓扑边界验收。

### 13 funnel：汇聚转化

- `inputs* [{id*, label*, icon?}]` 3～7，label 8×1；`core* {label*, subtitle?, icon?}` 10×2、18×2。
- `outputs* [{id*, label*}]` 固定 3，label 12×2；inputLabel/outputLabel optional，各 12×1。
- 关系内建；形状不表示真实人数、比例或转化率，需要数值漏斗时不选此组件。

### 14 fishbone：鱼骨归因

- `problem* {label*, subtitle?, icon?}`：10×2、12×1。
- `categories* [{id*, label*, subtitle?, icon?, highlighted?, causes*}]` 2～6；label 6×1、subtitle 12×1。
- causes 0～2 个 `{id*, label*}`，各 8×1；不能在具体原因下继续嵌套。

### 15 hub：集成中枢

- `core* {label*, subtitle?, icon?}`：12×2、18×2。
- `nodes* [{id*, label*, icon?, highlighted?}]` 3～6，label 8×1。
- metric optional 0～1：value 6×1、unit 4×1、label 16×2，progress 0～1 可省略。
- 自带标题区使用 caption 的收紧预算：title 18×2、description 32×2。外围彼此没有自由连线。

### 16 stack：平台分层

- `layers* [{id*, label*, subtitle?, icon?, highlighted?, items*}]` 2～4。
- label 10×1、subtitle 16×1；items 0～3 个 `{id*, label*}`，各 8×1，整行组装后仍需真实排版检查。
- metric optional：value 6×1、unit 4×1、label 16×2、progress optional 0～1。
- caption title 14×2、description 28×2。数组由上至下，不自动反转，层内无子层。

### 17 architecture：系统架构

- `layers* [{id*, label*, icon?, highlighted?, nodes*}]` 2～4，label 8×2。
- 每层 nodes 建议 1～4 个 `{id*, label*, icon?, highlighted?}`，label 12×2；总节点≤16。第一版不开放没有显示位置的 node.subtitle。
- `links* [{id*, from*, to*}]` 建议 0～8；from/to 必须引用节点，不是层。跨相邻层，不能同层或重复边；上行/下行由节点所属层决定。
- callouts optional，整体存在时固定 3 个 `{id*, label*, description?, highlighted?}`；label 14×1、description 16×2。
- caption title 16×2、description 34×2；固定卡片高度要与实际换行匹配。名称翻译和改名不影响引用。

### 18 sequence：时序交互

- `actors* [{id*, label*, icon?}]` 固定 5，label 8×1。
- `messages* [{id*, from*, to*, label*, reply?, highlighted?}]` 2～8，label 14×1；reply boolean。
- from/to 指向 actor ID；数组顺序为交互顺序。允许自消息，但特别检查最右参与者的自消息标签是否越界。
- 一条消息形成一次关系，不另外重复维护 links；不认识的参与者不能回退第一个。

### 19 state：状态流转

- `states* [{id*, label*, icon?, highlighted?, final?}]` 固定 5，label 6×1。
- `initial*` 引用一个状态；final boolean；允许多个终止状态（0～5），不自动替用户定义业务终止条件。
- `transitions* [{id*, from*, to*, label?, highlighted?}]` 初版固定 7，label 6×1。
- 初版的 7 对 from/to 按模板槽位与状态顺序生成并校验：第 1→2、2→3、3→4、4→5、2→1、3→1、2→2。实际保存端点为这些槽位对应的状态 ID，完整 JSON 可读出，端点在 UI/AI schema 标记为固定；文字与强调可改。不要假装任意 7 条转移都已经完成避让。
- 放开转移端点编辑需要后续对回跳、自环、平行边与重叠标签做专门路由验收；届时升级规则版本。

### 20 orbit：轨道生态

- `core* {label*, subtitle?, icon?}`：12×2、12×1。
- `rings* [{id*, label*, members*}]` 2～3，label 8×1。
- 每圈 members 建议 1～6 个 `{id*, label*, icon?}`，各 8×1；建议总成员≤14，圈由内至外。
- 节点找位后必须检查文字框，不能最后退回重叠位置却报告成功。空圈若需要表达独立语义，另行验收后开放。

### 21 scurve：增长曲线

- `xLabel*`、`yLabel*` 各 8×1；`secondCurve` optional `{label?}`，label 8×1；省略表示只有第一条曲线。
- `phases* [{id*, label*, description?, at*, curve*, icon?, highlighted?}]` 2～4。
- label 6×1、description 16×2；at 数字 0～1；curve 只能数字 1 或 2。
- 同曲线的 at 严格递增；使用 curve=2 必须有 secondCurve。位置重叠/边界标签仍需测量；不将定性曲线冒充实测增长值。

### 22 rings：同心圈层

- `rings* [{id*, label*, subtitle?, description?, icon?}]` 2～4。
- label 6×1、subtitle 12×1、description 22×2；顺序从外到内。
- 不接受 members/children，避免与 orbit/radial 混淆；环的厚度由布局控制。

### 23 stat：数据高光

- `main* {value*, unit?, label*, icon?, progress?}`：value 6×1、unit 4×1、label 20×2。
- `supporting* [{id*, value*, unit?, label?, progress?, highlighted?}]` 1～3；value 6×1、unit 4×1、label 14×2。
- progress 数字 0～1，省略时不显示比例进度；caption.eyebrow 在此为 10×1。
- 展示值无需强制转数字（例如 3.2×）；不能由文字 99.9% 暗中生成未确认的进度。

### 24 versus：前后对比

- `left*`、`right*` 各 `{label*, tag?, icon?, items*, metric?}`。
- label 10×1、tag 14×1；items 0～4 个 `{id*, label*}`，各 12×2。
- metric optional：value 6×1、unit 4×1、label 10×1；本组件不提供 progress。
- 双方条目数可以不同，布局按多的一侧安排，少的一侧不能用样例填满。

### 25 disc：立体分区盘

- `excluded* {label*, items*}`：label 12×1；items 0～3 个 `{id*, label*}`，各 8×1。
- `included* {label*, segments*}`：label 12×1；segments 2～8 个 `{id*, label*, icon?, highlighted?}`，label 6×1。
- 固定两组语义，不提供第三组；扇区等分，没有 value 或百分比字段。

### 26 diamond：菱形框架

- `outer* [{id*, label*, icon?}]` 固定 4，label 6×1；`overlaps*` 固定 4 个非空文字，各 4×1。
- `center* {label*, icon?}`：6×1。
- `cornerNotes*` 固定 4 个槽，按四角顺序，各为 null 或文字 24×3。这里明确允许 null 表示空槽，不套用普通对象列表的空项规则。
- 外圈/交叠/角注的方位由槽位决定；不要求 AI 指定像素坐标。

### 27 valley：关键拐点曲线

- `xLabel*`、`yLabel*` 各 8×1；`moments* [{id*, label*, quote?, x*, y*, highlighted?}]` 固定 4。
- label 6×1、quote 12×2；x/y 数字 0～1；数组 x 严格递增，不在渲染时静默改排序。
- `zone* {label*, from*, to*}`：label 8×1；0≤from<to≤1。
- `endings* [{id*, label*, quote?, from*, x*, y*}]` 固定 2；label 6×1、quote 10×2。
- from 固定引用第三时刻；结局 x 必须大于第三时刻的 x。两个结局位置不同，并与主线结局/标签保持可读距离。
- 曲线高度、关键区间与结局属于归一化语义位置；没有任意 path 或 px 字段。

### 28 capsule：胶囊流程

- `stages* [{id*, label*, icon?, caption?, highlighted?, steps*}]` 固定 5；label/caption 各 6×1。
- 每阶段 steps 0～3 个 `{id*, label*, icon?}`，label 6×2；建议含子步骤的阶段≤2、总子步骤≤6。
- `groups* [{id*, label*, description?, from*, to*}]` 固定 3，label 6×1、description 28×2。
- 分组范围初版固定为第 1 阶段、第 2～3 阶段、第 4～5 阶段，from/to 用 ID。
- `loops* [{id*, from*, to*, label?}]` 固定 2，label 6×1；初版端点固定为第 2→4、4→2 阶段，语义是模板中的往返路径。
- 所有阶段 label 必须显示，包括有 steps 的阶段；需补其标题位置。回路避开胶囊标题、分组说明和 caption。全部 5 阶段都填 3 子步骤不在建议初版范围内。

### 29 bridge：双核映射

- `left*`、`right*` 各 `{label*, subtitle?, icon?, items*}`；label 8×1、subtitle 10×1。
- 每侧 items 0～4 个 `{id*, label*}`，各 8×1。
- `middle* [{id*, label*, description?}]` 固定 3；label 6×1、description 18×2。
- 两侧到中间的关系由组件内建，不提供逐项任意映射边；需要自定义映射时选架构/流程等合适组件。

### 30 zones：圈层扩张

- `zones* [{id*, label*, subtitle?, notes*}]` 固定 4，label 6×1、subtitle 10×1。
- notes 0～4 个 `{id*, label*}`，各 10×2；前 2 个在上方、后 2 个在下方。
- 顺序从内至外；不增加第五区域，也不丢掉第五注释后报告成功。

### 31 radial：环形生态

- `center* {label*, subtitle?}`：6×1、10×1；此版中心不开放未渲染的 icon。
- `directions* [{id*, label*, icon?, groups*}]` 2～3，label 6×1。
- 每方向 groups 0～2 个 `{id*, label*, items*}`，label 6×1；每组 items 0～3 个 `{id*, label*}`，各 6×1。
- 中心→方向→组→叶子最多 4 层；总叶子≤18，总对象数≤28；组存在时必须有名称，可没有叶子；叶子不能带 children。
- caption 对应左侧标题，title 12×2、description 16×2。满容量需专项检查圈外文字与标题区。

### 32 bowtie：汇聚发散

- `left*`、`right*` 各 `{label*, subtitle?, items*, metric?}`；label/subtitle 各 10×1。
- 每侧 items 0～6 个 `{id*, label*, description?, icon?}`；label 6×1、description 10×1。
- metric optional：value 6×1、label 16×2；此版不提供 unit/progress，展示单位可包含在 value 中。
- `center* {label*, subtitle?, icon?}`：8×1、24×1。
- 左侧 description 需要实际新增显示位置并复核行距；完成前 schema 不应宣称其可编辑可显示。

### 33 cube：立体象限

- `axes* {x*, y*, z*}`，每轴 `{label*, low*, high*}`；label 6×1、low/high 各 4×1。
- `cells* [{id*, label*, description*, icon?, highlighted?}]` 固定 4；label 4×1、description 18×4。
- `extra` optional `{label*, description*}`：4×1、22×4；省略时不画附加策略框。
- 格子顺序固定左上、右上、左下、右下；不能当成任意三维坐标数据图。

### 34 loops：迭代回路

- `stages* [{id*, label*}]` 固定 6，label 6×2；`handoffs*` 固定 6 个文字槽，各 4×1，可用空字符串隐藏相应标签。
- `loops* [{id*, label*, from*, to*, highlighted?}]` 固定 3，label 4×1。
- from/to 引用阶段 ID，不能相等，不允许完全重复的无向阶段对；三个回路几何可有设计上的重叠，但标签不得互盖。
- 不向 AI 暴露 width 像素值；原宽度字段在迁移时作为布局覆盖保留，不放在新内容契约中，避免丢掉既有人工调整。

### 35 nested：嵌套胶囊

- `items* [{id*, label*, note?, noteSide?, icon?, highlighted?}]` 2～4。
- label 4×1、note 12×2；noteSide 枚举 up/down，省略使用组件确定性默认位置。
- 数组从小到大；没有 note 时不接受无意义的 noteSide。标签与说明检查相邻区、顶部/底部边界，不再嵌套 children。

## 7. 两个 AI JSON 示例

例子只展示语义内容对象；无需包成 version/kind/rows，无需任何颜色或像素尺寸。所有可选字段省略时不会补入演示内容。

### 泳道：改名不改变关系

```json
{
  "lanes": [
    {"id": "user", "label": "用户"},
    {"id": "agent", "label": "智能助手"},
    {"id": "reviewer", "label": "审核人"}
  ],
  "steps": [
    {"id": "request", "label": "提交需求", "laneId": "user", "column": 0},
    {"id": "draft", "label": "生成方案", "laneId": "agent", "column": 1},
    {"id": "review", "label": "审核方案", "laneId": "reviewer", "column": 2}
  ],
  "links": [
    {"id": "request-draft", "from": "request", "to": "draft"},
    {"id": "draft-review", "from": "draft", "to": "review", "label": "待审核"}
  ]
}
```

### 系统架构：数组直接表达两级

```json
{
  "layers": [
    {
      "id": "access", "label": "接入层",
      "nodes": [{"id": "web", "label": "网站"}, {"id": "app", "label": "移动端"}]
    },
    {
      "id": "service", "label": "服务层",
      "nodes": [{"id": "gateway", "label": "接口网关"}, {"id": "agent", "label": "智能编排"}]
    }
  ],
  "links": [
    {"id": "web-gateway", "from": "web", "to": "gateway"},
    {"id": "app-agent", "from": "app", "to": "agent"}
  ]
}
```

## 8. 语言、主题、展示中心与动画

- 展示中心只有一个，用于展示与挑选；切中英文同时切界面与演示图中的内容，演示内容有预置双语数据，不依赖临时 AI 翻译。
- 真实项目语言来自项目/内容设置。界面语言切换不自动翻译用户内容；项目需要双语时，两种语言保持相同 ID、结构与引用，仅翻译可见文字，各自排版预检。
- 内容模型不默认装入双语包装；常规 AI 只提交项目当前语言的对象。双语项目通过实例级语言版本保存，避免每个 label 同时存两种类型。
- 组件 JSON 无 primary/accent 等色值。真实项目继承项目主题；主色、辅助色由现有语义 token 分工。
- 演示仍使用原演示配色，由展示中心的演示主题上下文提供；不把演示配色带入用户组件。展示中心的演示配色故障需独立检查 token 传递链。
- 动画样式用组件现有 recipe；AI 的内容编辑不需要生成动画实现。需要旁白对齐时另提交时间绑定，按稳定节点/消息 ID 与实测时间关联。
- 删除或重排项目时，保留未变 ID 的时间绑定；新增未对齐项目标为待对齐，失效目标报错。数量变化后重新检查场景时长，末帧至少保留 1 秒，不能机械拉长全部动画。

## 9. 验收：什么条件才算“可视化和 JSON 不冲突”

每个组件至少完成以下实际往返，不只做构建：

1. JSON 应用→表单/画布显示→修改一个叶子→JSON 再读出：结构与其他字段不丢失。
2. 重排、改名、删除并更新关系：ID 和有效动画目标保持正确；悬空引用准确拒绝。
3. 无效 JSON、超过数量、超深层级、未知字段、重复 ID、非法枚举：保留最后有效内容，一次应用/撤销完整原子化。
4. 数量最小、最大与最大+1；子列表最小/最大，联合密度上限，与可选字段全开组合。
5. 中文、英文、混合文字，长不可断英文单词、最大预算文案；实际字体的换行、图标占位与裁切检查。
6. 登记支持的布局/比例与主题：至少横版图、卡片、海报；竖版只有验证过才能声明支持，不能缩小横版冒充可读竖版。
7. 有关系的组件专测：泳道同槽冲突；pipeline 环/深度/并行密度；架构跨层与悬空边；时序最右自消息；状态自环/回跳；胶囊全部候选边界；象限/曲线边缘碰撞。
8. 首帧、每次出现后的阶段、末帧、正反向 seek 与导出抽帧：内容、连线、动画身份相同，所有声明可编辑文字可见。
9. 旧项目 migration：原文字、图标、关系、数值、手动布局与时间绑定不丢失；不把旧样例关系错误当成用户明确意图。有歧义的旧引用显示迁移诊断。
10. AI 读取→提交→得到具体错误→修正→成功；不额外操作 GUI，不依赖隐藏演示默认值。

最大数量只有在上述检查通过后才能标为该组件当前布局的正式上限。若边界组合不好看，减少登记上限或增加布局适配，不放宽校验掩盖问题。

## 10. 最小实施顺序

1. 在现有 registry/data contract 上增加完整内容对象定义，共用解析器、validator、serializer；提供旧 rows/vars 导入适配。无需新增数据库、服务或第二套编辑器。
2. 先串通 architecture 与 swimlane：完整对象、ID 引用、表单/JSON 往返、同一保存/撤销、结构与几何拒绝。这两个能检验核心困难。
3. 依照本稿逐个登记其余 33 个的 schema、显示字段与布局限制，补 capsule/bowtie/stat/scurve 当前缺口；保留固定拓扑边界。
4. AI 只接现有真实可调用通道的 read/set；把现有 AI 格式化说明对齐到该接口，规则与 schema 同源。
5. 完成 35 个的边界预览与往返验收后冻结正式上限，再接展示中心的双语、演示主题和点击播放核验。

## 11. 本次核对的源码位置

- 原组件契约与变量：`examples/stage-diagrams/engine/specs.js`
- 数据映射、base 合并、动画绑定：`examples/stage-diagrams/engine/component.js`
- 系统/流程渲染：`examples/stage-diagrams/engine/systems.js`
- 框架渲染：`examples/stage-diagrams/engine/frameworks.js`
- 核心卡片与文字排版：`examples/stage-diagrams/engine/core.js`
- 数值、圈层等渲染：`examples/stage-diagrams/engine/hero.js`
- 原生文本转换：`examples/stage-diagrams/engine/native.js`
- 现有 Studio JSON rows 解析：`vendor/hyperframes/packages/core/src/registry/componentData.ts`
- 现有组件表单：`vendor/hyperframes/packages/studio/src/components/editor/BlockParamsPanel.tsx`

上述路径已纳入 iPolloWork 仓库；历史审查中的缺口由以下实施记录逐项说明。


## 12. 已实现：共享内容、旁白卡点与四种镜头

35 个组件全部从 `examples/stage-diagrams` 作者源码构建为 4.0.0。完整/卡片布局的默认、最少、最多条目由构建实际检查；海报和其他语言的全部边界组合仍以实际预检结果为准。保留原四种风格及项目主题。

### 1. AI 一次提交的结构

AI 只需要理解四个顶层块，四块都可部分提交：

```json
{
  "content": { "...": "组件内容，见第 5 节与前述方案第 6 节" },
  "copy":    { "eyebrow": "眉标", "title": "标题", "subtitle": "副标题", "note": "卡片底部说明" },
  "timing":  { "<条目 id>": 1.2, "<条目 id>": 3.5, "resolve": 9.5 },
  "look":    { "layout": "full", "skin": "keynote", "camera": "auto" }
}
```

| 块 | 作用 | 省略时 |
|---|---|---|
| `content` | 图里讲什么（条目、关系、标签） | 保留当前内容 |
| `copy` | 卡片和海报外框上的文案，和动画无关 | 用组件名称和描述；某个字段写 `""` 表示隐藏这一行 |
| `timing` | 每个条目什么时候出现，对齐旁白 | 用默认节拍 |
| `look` | 布局、皮肤、镜头 | 完整布局、Keynote、自动镜头 |

不要让 AI 提供颜色、像素、字号、动画曲线：颜色跟项目主题，排版和动画由组件负责。

**和现有变量的对应**（适配层负责转换，AI 不需要知道）：

| JSON | 现有变量 |
|---|---|
| `content` 主数组 | 主列表变量（`items`、`layers`、`states` 等，表格 JSON） |
| `content` 其他字段 | 各组件的单字段变量；关系型字段（`transitions`、`links`）是 JSON 变量 |
| `copy.eyebrow/title/subtitle/note` | `copyEyebrow` / `copyTitle` / `copySubtitle` / `copyNote` |
| `timing` | `motionCueTimes` |
| `look.layout/skin/camera` | `layout` / `skin` / `camera` |

### 1.5 已实现：AI 编辑接口

唯一源码：HyperFrames 核心 `registry/componentContent.ts`；`hyperframes/ai-adapter.mjs` 是作者工具生成的独立分发版本（构建后在 `dist/hyperframes/stage-diagrams-ai-adapter.mjs`），纯函数，无 DOM，Studio、AI 工具和测试共用。每个组件的 `registry-item.json` 里 `visualComponent.ai` 带有：

| 字段 | 内容 |
|---|---|
| `guide` | 几行中文规则：主列表、数量、节拍、结论、可用镜头、关系规则 |
| `schema` | 这个组件的 JSON Schema（含数量上下限、文字建议长度、枚举、图标表） |
| `example` | 一个真实完整的示例对象（就是组件的默认内容） |
| `model` | 转换用的组件模型（字段路径、类型、默认值） |

AI 的工作流只有三步：读 `guide` + `schema` + `example` → 提交一个对象 → 有错按路径改一次。

```js
import { fromJSON, toJSON } from './stage-diagrams-ai-adapter.mjs';
const { model } = registryItem.visualComponent.ai;
const { values, errors, warnings } = fromJSON(model, aiObject, currentValues); // 无 errors 时写入 values
const obj = toJSON(model, currentValues);                                     // 读出给 AI 或 JSON 页签
```

**内容形状就是图本身的自然结构**：嵌套用数组（架构的一层是 `{label, nodes: [{label, icon}]}`），不用 `node1/node1Icon` 这类拍平字段；字段名用完整单词（`highlighted`、`subtitle`、`description`），布尔值用 true/false，列表用数组。转换器根据组件已有的字段映射双向转换，表单、画布、JSON 永远一致。35 个组件都通过“变量 → JSON → 变量”的往返测试。

**合并语义**：只提交要改的字段，未提交的保持原样；提交的数组整体替换（可以增删、重排）。这样 AI 改一个标题不需要重发整张图。

**条目 id**：示例里的 id 是有含义的英文短名（`project-kickoff`、`access-layer`）；有“代号”的组件（状态、泳道、流水线）id 就是代号，关系和 timing 都用它。

**报错与提醒**：

- 错误（不应用）：结构、类型、数量、未知字段、重复 id、引用不存在、枚举不合法、文字超过字段预算，或实际字体下出现裁切、文字重叠、越界。
- 不再静默裁切或放行超宽文字；保留旧预览与草稿，缩短文字或拆成另一场景后再应用。
- 每条都有 `path`（JSON 指针）、`code`、`message`，数量和长度类还有 `actual` / `expected`。

```json
{"path": "/content/layers/0/nodes", "code": "too_many_items", "message": "At most 4 here; 5 given.", "actual": 5, "expected": {"max": 4}}
{"path": "/content/items/1/current", "code": "not_boolean", "message": "Use true or false.", "actual": "yes"}
{"path": "/look/camera", "code": "invalid_value", "message": "look.camera must be one of auto, steady, overhead, dimension.", "actual": "focus"}
```

节拍的先后、间隔和结尾留白，以及关系引用（状态转移、泳道连线）的检查由组件本身完成，报错文字同第 2.2 节和第 5.2 节。

### 2. 卡点：什么时候出现什么

#### 2.1 一个组件的固定叙事

每个组件都走同一条时间线：

1. **骨架**（开场约 1 秒内）：坐标轴、泳道、中心、主轴等结构。见第 5 节“骨架”列。
2. **逐项讲解**：主数组的每一项是一拍，按数组顺序出现。一项里的所有部分（节点、名称、说明、图标、指向它的连线）作为一组在这一拍出现，内部先后压缩在 1 秒内。
3. **结论**（有的组件才有）：最后一项之后出现。比如漏斗的产出、矩阵的合计、韦恩的交集。见第 5 节“结论”列。
4. **全景停留**：至少 1 秒，所有内容完整可读。
5. **淡出**。

AI 只需要决定：**数组的顺序**（讲解顺序），以及可选的 **timing**（对齐旁白）。不需要也不能指定单个元素的出场。

穿过多项的线（时间线主轴、增长曲线、低谷曲线）会随着各项的节拍一段段画出。

#### 2.2 timing 的写法

```json
{ "kickoff": 1.2, "beta": 3.5, "launch": 6.0, "resolve": 9.5 }
```

- 键用**条目 id**。重排数组后，时间跟着条目走，不会错位。旧写法 `step-1`、`step-2`（按位置）继续兼容。
- `resolve` 是结论出现的时间，只对有结论的组件生效。
- 只写需要对齐旁白的条目即可。没写的条目自动均匀排在前后两个已设定的条目之间；排在最后一个设定之后的，每项间隔一拍（1.4 秒）。
- 不写 timing：第 1 项 0.6 秒，之后每项间隔 1.4 秒。

**约束**（超出会报错，组件保留上一次有效的结果，绝不拉伸动画来凑时间）：

| 规则 | 说明 |
|---|---|
| 单位 | 秒，非负数 |
| 顺序 | 按数组顺序递增 |
| 间隔 | 相邻两项至少 1.4 秒 |
| 结尾 | 最后一项的时间 + 1.4 秒 ≤ 场景时长 − 1 秒（留全景） |
| resolve | 介于“最后一项 + 0.7 秒”和“场景时长 − 1.6 秒”之间 |
| 键 | 必须是当前存在的条目 id 或 step-N；同一项不能设两次 |

实际报错示例（已实现）：

```text
motionCueTimes.nope names no current row; use a row id or step-1…step-6.
Row 2 (row-2) at 1s does not fit: rows need 1.4s each, in order, and 1s of full view before 13s. Shorten the narration gaps or the row count; motion is never stretched.
motionCueTimes.resolve must fall between 9.7s (after the last row) and 10.4s.
```

场景时长：多数组件 10 秒，条目多的组件 12～13 秒（见第 5 节）。条目数 × 1.4 秒 + 2 秒放不下时，要么缩短条目数，要么分镜，不能压缩动画。

### 3. 海报与卡片

#### 3.1 布局

| layout | 画面 | 文案 |
|---|---|---|
| `full` | 图占满画面 | 不显示 copy |
| `card` | 图缩小，上方标题、副标题，底部说明 | `title`、`subtitle`、`note` |
| `poster` | 左栏文字，右侧图 | `eyebrow`、`title`、`subtitle` |

#### 3.2 copy 字段

| 字段 | 用在 | 预算（全角字） | 省略时 |
|---|---|---|---|
| `eyebrow` | 海报左上眉标（等宽小字） | 12 | 组件英文名 |
| `title` | 卡片标题、海报大标题 | 14 | 组件中文名 |
| `subtitle` | 卡片副标题、海报副标题 | 60 | 组件描述 |
| `note` | 卡片底部说明 | 40 | 不显示 |

- 卡片和海报共用一套文案，AI 不需要重复填写。
- `""` 表示隐藏这一行。
- 英文按同样的视觉宽度计算，拉丁字符约占半个全角宽度。

#### 3.3 海报左栏的联动（不需要 AI 提供）

海报左栏除了 copy，还有三样内容，全部由组件根据 `content` 和节拍自动生成：

- **当前项**：每一拍切换成正在讲的那一项。显示它的名称（主数组的名称字段），以及它最长的一个说明字段（例如时间线的“说明”）。
- **汇总**：最后一项讲完后，当前项淡出，换成所有项名称的汇总。
- **进度图形**：随节拍逐段点亮，样式随皮肤变化。

左栏的分隔线、标题下的线、进度图形都随皮肤变化（Keynote 只靠留白分区；电影感是渐隐光束；点阵是点线；杂志是黑色栏线）。这些都不是可编辑内容。

### 4. 运镜

`look.camera`：

| 值 | 镜头 | 适用 |
|---|---|---|
| `auto` | 组件推荐的镜头 | 全部 |
| `steady` 平稳 | 一段连贯的推进 | 全部 |
| `overhead` 俯视 | 从倾斜升到正面 | 全部 |
| `dimension` 立体 | 转入等轴视角后缓慢环绕 | 全部 |
| `focus` 聚焦 | 推近后按节拍一站站跟随讲解，讲完拉回全景 | 只有 9 种：时间线、用户旅程、路线图、流程、泳道、时序交互、状态流转、低谷、S 曲线 |

- 所有镜头的开场和结尾都是正面完整画面。
- 「聚焦」的落点和推近程度按每一项实际画出的位置和大小计算，保证这一项完整在画面里，图的边缘不露出空白。
- 不适合聚焦的组件（同心圈、韦恩、象限、轨道生态等需要看整体关系的图）不提供 `focus`；JSON / AI 传入时按 schema 明确报错。

### 5. 每个组件的实测规则

#### 5.1 数量、节拍、结论、聚焦

数量：每个组件都在“最少数量、最多数量、最多数量加 1.6 倍长文字”三种情况下，在完整布局和海报布局实测。检查最终画面里文字有没有重叠、出界、截断，并逐张看图确认。表中数量全部通过。

文字预算：以组件示例文字的显示宽度为基准，一般允许到 1.5 倍。实测在 1.6 倍出现截断或碰撞的字段收紧到 1.2 倍：思维导图叶子、鱼骨原因与副标题、增长曲线说明、对比条目、环形生态要点、迭代回路阶段名。最小 4 个全角字。拉丁字符按半个全角计。

| 组件 | 讲解单位（数组） | 数量 | 时长 | 骨架（开场就在） | 结论（resolve） | 聚焦 | 每项字段预算（全角字） |
|---|---|---|---|---|---|---|---|
| 决策流程 `decision` | 分支 `branches` | 2～3 | 10s | 起点、判断问题、4 个列标题 | — | — | 条件 5；行动 15；结果 9 |
| 思维导图 `mindmap` | 分支 `branches` | 2～6 | 10s | 中心 | — | — | 分支主题 4；分支副标题 5；叶子要点 ≤4 项×9 |
| 里程碑时间线 `timeline` | 里程碑 `items` | 2～8 | 13s | 主轴 | — | ✓ | 标题 10；日期 6；说明 18 |
| 交集关系 `venn` | 集合 `sets` | 2 | 10s | — | 交集（名称、要点） | — | 名称 6；副标题 14；要点 ≤3 项×8 |
| 用户旅程 `journey` | 阶段 `stages` | 2～6 | 10s | 行标题 | — | ✓ | 阶段名称 6；体验描述 15；用户行为 14；触点 8 |
| 产品路线图 `roadmap` | 任务 `tasks` | 2～6 | 10s | 4 个周期、当前线 | — | ✓ | 任务 10；负责方 5；备注 6 |
| 定位象限 `quadrant` | 点 `points` | 2～5 | 10s | 坐标轴、4 个象限名 | — | — | 名称 10；副标题 4 |
| 能力对比 `matrix` | 能力行 `items` | 2～6 | 10s | 3 个对比列、图例 | 合计数字 | — | 功能 11；说明 14；第 1 列（2 全部／1 部分／0 不支持，或文字） 4；第 2 列（2 全部／1 部分／0 不支持，或文字） 5；第 3 列（2 全部／1 部分／0 不支持，或文字） 6 |
| 层级结构 `tree` | 分支 `branches` | 2～3 | 10s | 根节点 | — | — | 分支 5；副标题 6；子项 1 6；子项 2 6；子项 3 6 |
| 泳道协作 `swimlane` | 步骤 `steps` | 2～6 | 10s | 3 条泳道 | — | ✓ | 步骤 12；步骤代号（用于连线） 4 |
| 循环飞轮 `cycle` | 阶段 `stages` | 3～5 | 10s | 中心 | — | — | 阶段 4；说明 17 |
| 流水线 / 依赖 `pipeline` | 节点 `nodes` | 2～7 | 12s | 列序号 | — | ✓ | 节点 8；副标题 8；节点代号（用于连线） 5 |
| 汇聚转化 `funnel` | 来源 `inputs` | 3～7 | 12s | 核心引擎、来源/产出标题 | 3 个产出 | — | 来源 7 |
| 鱼骨归因 `fishbone` | 类别 `categories` | 2～6 | 10s | 主骨、问题 | — | — | 类别 4；副标题 8；具体原因 ≤2 项×8 |
| 集成中枢 `hub` | 外围节点 `nodes` | 3～6 | 10s | 核心 | — | — | 名称 6 |
| 平台分层 `stack` | 层 `layers` | 2～4 | 10s | 层板 | — | — | 层名 9；副标题 13；组成部分 ≤3 项×9 |
| 系统架构 `architecture` | 层 `layers` | 2～4 | 10s | — | — | — | 层名 5；组件 1 8；组件 2 11；组件 3 8；组件 4 7 |
| 时序交互 `sequence` | 消息 `messages` | 2～8 | 13s | 5 个参与者 | — | ✓ | 消息 17；发送方 7；接收方 7 |
| 状态流转 `state` | 状态 `states` | 3～6 | 10s | 初始点 | — | ✓ | 状态 6；状态代号（用于流转） 6 |
| 轨道生态 `orbit` | 圈 `rings` | 2～3 | 10s | 核心 | — | — | 圈层名称 6；成员 1 4；成员 2 6；成员 3 7；成员 4 6；成员 5 6；成员 6 6 |
| 增长曲线 `scurve` | 阶段 `phases` | 2～4 | 10s | 坐标轴 | 第二曲线 | ✓ | 阶段 6；说明 15；所在曲线（1 或 2） 4 |
| 同心圈层 `rings` | 圈 `rings` | 2～4 | 10s | — | — | — | 圈层名称 6；副标题 8；说明 30 |
| 数据高光 `stat` | 辅助数据 `notes` | 1～3 | 10s | 主数据 | — | — | 数值 4；单位 4；说明 16 |
| 前后对比 `versus` | 对比侧 `sides` | 2 | 10s | — | — | — | 标题 10；标签 11；要点 ≤5 项×11；数字 4；单位 4；数字说明 9 |
| 立体分区盘 `disc` | 分区 `segments` | 2～8 | 13s | “不是”盘 | — | — | 分区 6 |
| 菱形框架 `diamond` | 外圈 `outer` | 4 | 10s | — | 中心交汇 | — | 条件 6 |
| 关键拐点曲线 `valley` | 时刻 `points` | 4 | 10s | 坐标轴、关键区间 | 两个结局 | ✓ | 时刻 8；心声 14 |
| 胶囊流程 `capsule` | 阶段 `stages` | 5 | 10s | 分组 | — | — | 阶段 6；标注 6；子步骤 1 6；子步骤 2 6；子步骤 3 6 |
| 双核映射 `bridge` | 核心侧 `sides` | 2 | 10s | 中间 3 层 | — | — | 名称 6；副标题 7；条目 1 6；条目 2 6；条目 3 6；条目 4 6 |
| 圈层扩张 `zones` | 区域 `zones` | 4 | 10s | 主轴 | — | — | 区域 5；副标题 7；说明 ≤4 项×11 |
| 环形生态 `radial` | 方向 `keys` | 2～3 | 10s | 中心、标题 | — | — | 方向 4；分组 1 6；分组 1 要点 ≤3 项×6；分组 2 6；分组 2 要点 ≤3 项×5 |
| 汇聚发散 `bowtie` | 侧 `sides` | 2 | 10s | 中心 | — | — | 标题 10；副标题 8；数字 4；数字说明 20；条目 1 8；条目 1 说明 14；条目 2 6；条目 2 说明 11；条目 3 6；条目 3 说明 11；条目 4 6；条目 4 说明 12；条目 5 6；条目 5 说明 11；条目 6 6 |
| 立体象限 `cube` | 格 `cells` | 4 | 10s | 3 条坐标轴 | 附加策略 | — | 名称 4；说明 24 |
| 迭代回路 `loops` | 回路 `phases` | 3 | 10s | 6 个阶段环 | — | — | 回路 4 |
| 嵌套胶囊 `nested` | 层次 `items` | 2～4 | 10s | — | — | — | 名称 4；说明 16 |

| 组件 | 单个字段预算（全角字） |
|---|---|
| 决策流程 `decision` | 起点 6；起点副标题 5；判断问题 12；列标题 1 4；列标题 2 4；列标题 3 4；列标题 4 4 |
| 思维导图 `mindmap` | 中心主题 8 |
| 交集关系 `venn` | 交集名称 10；交集要点 23 |
| 用户旅程 `journey` | 行为行名称 6；触点行名称 4 |
| 产品路线图 `roadmap` | 周期 1 6；周期 2 4；周期 3 4；周期 4 4；当前标记 4 |
| 定位象限 `quadrant` | 横轴名称 5；横轴低端 5；横轴高端 5；纵轴名称 6；纵轴低端 6；纵轴高端 5；象限 1 6；象限 2 6；象限 3 8；象限 4 6 |
| 能力对比 `matrix` | 列 1 名称 10；列 2 名称 5；列 3 名称 5；高亮标签 4；统计说明 8；图例 34 |
| 层级结构 `tree` | 根节点 11；根节点副标题 7 |
| 泳道协作 `swimlane` | 泳道 1 4；泳道 1 副标题 6；泳道 2 6；泳道 2 副标题 5；泳道 3 4；泳道 3 副标题 6 |
| 循环飞轮 `cycle` | 中心标题 11；中心副标题 11 |
| 流水线 / 依赖 `pipeline` | 连线 1～10；场景标题使用 `copy` |
| 汇聚转化 `funnel` | 来源标题 6；产出标题 7；核心名称 6；核心副标题 14；产出 1 11；产出 2 11；产出 3 11 |
| 鱼骨归因 `fishbone` | 问题 9；问题副标题 6 |
| 集成中枢 `hub` | 核心名称 9；核心副标题 13；场景标题使用 `copy` |
| 平台分层 `stack` | 场景标题使用 `copy` |
| 系统架构 `architecture` | 连线 0～12；节点全局唯一 ID；场景标题使用 `copy` |
| 时序交互 `sequence` | 参与方 1 4；参与方 2 7；参与方 3 5；参与方 4 5；参与方 5 5 |
| 轨道生态 `orbit` | 核心名称 7；核心副标题 7 |
| 增长曲线 `scurve` | 横轴名称 4；纵轴名称 6；第二曲线名称 6 |
| 数据高光 `stat` | 眉标 6；主数值 4；主单位 4；主说明 19 |
| 立体分区盘 `disc` | “不是”标题 10；“不是”要点 23；“是”标题 9 |
| 菱形框架 `diamond` | 交叠 1 4；交叠 2 4；交叠 3 4；交叠 4 4；中心 5；角注 1 29；角注 2 29；角注 3 30；角注 4 27 |
| 关键拐点曲线 `valley` | 纵轴名称 8；横轴名称 4；区间名称 8；分支 1 4；分支 1 心声 6；分支 2 4；分支 2 心声 6 |
| 胶囊流程 `capsule` | 阶段组 1 4；阶段组 1 说明 24；阶段组 2 4；阶段组 2 说明 36；阶段组 3 4；阶段组 3 说明 30；回路 1 说明 6；回路 2 说明 6 |
| 双核映射 `bridge` | 中间层 1 5；中间层 1 说明 23；中间层 2 5；中间层 2 说明 18；中间层 3 5；中间层 3 说明 23 |
| 环形生态 `radial` | 标题 9；副标题 15；中心 6；中心副标题 9 |
| 汇聚发散 `bowtie` | 转折点 7；转折点副标题 20 |
| 立体象限 `cube` | Y 轴名称 6；Y 轴低端 4；Y 轴高端 4；X 轴名称 5；X 轴低端 4；X 轴高端 4；Z 轴名称 6；Z 轴低端 4；Z 轴高端 4；附加策略 4；附加策略说明 27 |
| 迭代回路 `loops` | 阶段 1 5；阶段 2 5；阶段 3 4；阶段 4 4；阶段 5 4；阶段 6 5；衔接 1 4；衔接 2 4；衔接 3 4；衔接 4 4；衔接 5 4；衔接 6 4 |

说明：

- “讲解单位”就是 timing 的条目，也是海报左栏“当前项”的来源。
- 固定数量（如韦恩 2、菱形 4、低谷 4、胶囊 5）表示版式就是这些槽位，不能增减。需要更多内容时分镜或换组件。
- 文字超出预算时应报错并给出改写建议，不能靠缩小字号或截断“通过”。当前共享契约已经检查输入硬上限与全角宽度预算，运行时还检查实际字体几何，错误阻止保存。

#### 5.2 关系型组件

关系一律用 `{from, to, label?}` 对象，用 id 引用，改名不影响连接。这一轮已实现两个：

**状态流转 `state`**

```json
{
  "states": [
    {"id": "draft", "label": "草稿", "icon": "pen"},
    {"id": "review", "label": "AI 审校", "icon": "spark"},
    {"id": "done", "label": "已发布", "icon": "rocket", "final": true}
  ],
  "initial": "draft",
  "transitions": [
    {"from": "draft", "to": "review", "label": "提交"},
    {"from": "review", "to": "done", "label": "通过"},
    {"from": "review", "to": "draft", "label": "需修改"},
    {"from": "review", "to": "review", "label": "自动重试"}
  ]
}
```

- 状态 3～6 个；转移 1～10 条；同一方向不重复；每个状态最多一条自循环；`initial` 必须是已有状态。
- 画法自动决定：相邻的下一个状态画直线；跳过中间状态的在上方画弧线；回退的在下方画弧线；自循环在状态上方。弧线按跨度分层，重叠的跨度不共用高度；每个状态的多条进出线分散在圆周上；回退弧线从状态名下方出发，不穿过文字。
- 实测：6 个状态 + 10 条业务转移，标签无遮挡。
- 报错示例：`transitions[0].to "review" is not a state key (todo, doing, done).`

**泳道协作 `swimlane`**

```json
{
  "steps": [
    {"id": "a", "label": "拍照上传作业", "lane": "lane1", "col": 0},
    {"id": "b", "label": "识别 + 逐题批改", "lane": "lane2", "col": 1}
  ],
  "links": [{"from": "a", "to": "b", "label": "上传"}]
}
```

- 泳道用位置编号 `lane1`/`lane2`/`lane3`（从上到下），改泳道名称不会断开；列 0～3；同一泳道同一列只能有一个步骤。
- 连线最多 8 条；不能连自己；同一方向不重复；引用必须存在。

**时序交互 `sequence`**：消息的 `from` / `to` 写 `actor1`～`actor5`（参与者顺序），改参与者名称不影响消息；已实现。

**已开放**：系统架构每层 1～4 个节点，节点有全局唯一 id，连线 0～12 条，允许同层或后续层；改名保留 id 就不会断线。流水线 2～7 个节点，依赖边 1～10 条，拒绝自连、重复、悬空引用和循环。二者都用 `{from, to, label?, highlighted?}`。

### 6. 对前述方案的修订意见

| 前述方案 | 修订 |
|---|---|
| 一个共用 caption `{title, description, eyebrow}` | 改为 `copy {eyebrow, title, subtitle, note}`，卡片和海报共用，预算见 3.2；已实现 |
| 时间绑定“另提交” | 写清楚为 `timing`（条目 id → 秒，`resolve`），约束和报错见第 2 节；已实现 |
| 动画按行号 step-N | 改为按条目 id，step-N 兼容；已实现 |
| 无运镜说明 | 补第 4 节；聚焦只对 9 种图开放；已实现 |
| 状态流转“初版固定 5 状态、7 条转移” | 已开放为 3～6 状态、1～10 条任意业务转移，带分层避让与校验；已实现 |
| 泳道 laneId 引用 | 实现为 `lane1/2/3` 位置编号（槽位固定 3 条），连线开放为 JSON；已实现 |
| 容量“候选值” | 第 5 节数量已实测；文字预算按实测收紧 |
| 文字预算按字段测量 | 同意。下一步把第 5 节预算接入校验，按实际字体测量 |
| 双核映射未列问题 | 实测发现默认数据下两侧文字出界，已修复（核心内收、文字宽度按到画面边缘的距离限制） |

### 7. 给 AI 的最短说明（可直接放进工具描述）

```text
先读取当前对象与 revision，再提交一个 data 对象：content、copy、timing、look 均可部分提交。
- content 按该组件的 schema 填写；主数组的顺序就是讲解顺序。条目用简短英文 id，关系用 {from,to,label} 引用 id。
- 数量和文字长度不要超过组件给出的上限；放不下就缩短文字或分成两个场景，不要截断。
- copy 是卡片/海报的文案；不需要时省略，"" 表示隐藏。
- timing 用条目 id 写出现的秒数，只写需要对齐旁白的条目；结论用 "resolve"。每项至少间隔 1.4 秒，结尾留 1 秒。
- look.camera 用 auto 即可；只有沿路径讲解的图才能用 focus。
- 不要提供颜色、像素、字号、动画参数。
- 只提交要改的字段，未提交的保持原样；提交的数组整体替换。
- 先读该组件的 guide、schema、example；报错时按错误里的路径修改，再提交一次。
```

### 8. Studio 与 AI 接入

- Studio 使用现有参数面板的内容 / JSON 页签。JSON 草稿显式应用，整份对象一次保存、一次撤销；未应用草稿不改变预览。表单、画布和 JSON 共用组件变量。
- 原生 AI 工具 `media.video_component_read` / `media.video_component_write` 读当前内容与 revision，提交自然 JSON。结构、层级、整数、区间、引用、依赖与节拍由共享核心校验；实际字体与节点位置由原生预览校验。
- revision 不匹配或校验期间发生外部写入返回 409；结构或排版失败返回 422，源文件保持原样。已安装组件的模型嵌在自身源码里，组件库更新不改变旧视频规则。
- 35 个组件的默认、最少、最多条目通过实际字体检查；状态机 6 个状态、10 条跳转通过边界检查。列表使用 JSON 数组编码，逗号、中文标点不会被再拆分。
- 未渲染的示例标题、导语、数字和要点不再暴露为可编辑变量；场景标题使用 `copy`。已有旧模板没有共享模型时保留原编辑方式，重新安装当前模板后可使用 JSON。
