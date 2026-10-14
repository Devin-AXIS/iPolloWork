# 独立插件包 v1

## 自定义字段输入

字段包可以同时声明 `shared` 和 `client` 入口。启用扩展时加载字段输入，停用或加载失败时撤销注册；纯视图插件仍在打开视图时加载。宿主只提供通用接口，不内置插件的选项、级数或地区数据。

`shared` 字段定义可提供 `icon`（内核图标 ID）和 `validateOptions(options)`。创建或修改字段时，宿主调用此同步校验并在事务中拒绝无效配置；修改已有值所用的选项仍受原来的记录、查询和自动化保护。API/MCP 沿用相同字段与记录写入入口。

```js
export function activate({ React, fieldEditors, components }) {
  fieldEditors.register({
    id: 'my-field', // 必须在 contributes.fields 中声明
    component: ({ field, value, onChange }) =>
      React.createElement(components.TextField.Root, {
        'aria-label': field.name,
        value: value ?? '',
        onChange: (event) => onChange(event.target.value),
      }),
    // 可选：configure({ options, onChange }) 和 defaultOptions: string[]
  })
}
```

宿主复用 `FieldInput`，所以表格单元格、详情、新增记录、嵌入表格和自动化输入会使用同一个编辑器。字段设置仍存于已有的 `options: string[]`，每项最多 80 字、最多 100 项；`configure` 只改草稿，用户保存后写入。编辑器通过 `onChange` 更新草稿，不直接保存记录。没有注册编辑器的插件沿用原来的通用输入。

`components` 另提供共享的 `ChoiceInput`、`TextField`、`TextArea`；插件使用宿主同一份 React 和主题。`fieldEditors.get(id)` 可复用已声明依赖插件的编辑器，无需打包第二套组件。语言通过 `i18n.useLocale()` 获取；插件自己的文案应放在插件中。

此接口为 v1 的可选能力。需要它的插件应检测 `context.React && !context.fieldEditors` 并提示更新数据工作台，避免旧客户端退化成不合适的普通输入。插件内动态导入其他 JS 文件时，要继承 `import.meta.url` 的查询参数，以保留资源摘要校验。扩展属于受信任本地代码，与现有加载器的信任边界相同。

字段和视图可放在独立目录，由数据服务发现、浏览器按需加载。无需改主程序入口或重新构建前端。内置示例是 `extensions/percentage`、`extensions/cards`、`extensions/relations`。

本协议借鉴 DeepSeek Harness 的注册与可撤销生命周期，不直接运行 DSH 或 iPolloWork 的插件包。当前只执行可信本地代码，没有沙箱、远程市场或签名验证。

## 最小包

```json
{
  "name": "@example/my-field",
  "version": "1.0.0",
  "type": "module",
  "ipolloData": {
    "id": "my-field",
    "name": "我的字段",
    "description": "业务字段说明",
    "protocol": 1,
    "categories": ["fields"],
    "dependencies": ["core"],
    "contributes": { "fields": ["my-field"] },
    "entrypoints": { "shared": "shared.js" }
  }
}
```

```js
export function activate({ fields }) {
  fields.register({
    id: 'my-field',
    label: '我的字段',
    category: 'extended',
    storage: 'numeric',
    input: 'number',
    validate: (value) => fields.get('number').validate(value),
    format: (value) => String(value ?? ''),
  })
}
```

字段 `shared` 入口在服务端与浏览器执行，必须为无环境依赖的纯定义。支持内核已有的 text、numeric、boolean、date、jsonb 存储类型，编辑器沿用 `FieldType.input`。不可在校验器内访问网络、启动定时器或调用模型。自定义输入与字段设置可通过可选的 `fieldEditors` 接口注册，见下文。

视图使用 `categories: ["views"]`、`contributes.views` 和 `entrypoints.client`。导出 `activate(context)`，通过 `context.views.register({ id, name, description, icon, component })` 注册。`component` 的参数复用 `ViewProps`：`data`、`onOpen`、`onAdd`、`onAddField`、可选 `onEditField` 与 `onOpenLinked(tableId, recordId)`。操作由宿主回调保存，插件不另存记录。

交互视图还可使用 `onCreateRecord(initialValues)` 打开带默认值的新建抽屉，以及 `onUpdateRecord(record, values)` 更新记录。后者返回 Promise，使用原记录 `version` 防止覆盖并发修改；只提交变化字段，失败必须提示用户。两个接口为可选能力，旧客户端应降级为只读。`data.records` 是当前筛选、当前页的记录，分组数量不能标成整表统计。

清单可选 `ipolloData.icon` 使用 `src/core/icons.ts` 的稳定图标 ID（如 `dashboard`），用于懒加载视图的页签。共享组件增加 `Select`、`DropdownMenu`、`IconButton`，图标提供 `plus`、`more`、`settings`。它们均来自 Onto 自身，独立插件无需依赖 iPolloWork，也不应额外打包 React 或组件库。

浏览器上下文提供同一份 `React`、`components.FieldValue`、`components.FieldTypeIcon`、`components.EntityIcon`、`components.Button`、卡片/关联图图标，以及 `services.graph(tableId, {page, recordId, seedIds})`、`services.graphRecords(anchorTableId, {query, tableId?})`。`await services.graphCanvas()` 按需加载共享的 React Flow 画布组件与样式，仅图形视图使用；普通表格不加载图形运行时。完整可运行示例见三个包的源码。TS/JSX 可提前构建为原生 ESM；当前包只接收平铺文件，示例无需额外构建或 React 副本。

浏览器上下文还提供 `i18n.useLocale()`、`i18n.getLocale()` 和 `i18n.translate(source, values?, englishMessages?)`。视图组件调用 `useLocale()` 订阅中英文切换；参数使用 `{0}`、`{1}`，通过 `values` 传入，业务数据不参与翻译。外部插件可随入口携带自己的英文文案表作为第三个参数，未知文案保留原文。视图颜色使用 `--data-*` 或 Radix 语义变量，自动适配浅色、深色与跟随系统；选中背景与文字分别使用 `--data-accent`、`--data-on-accent`。

## 安装与生命周期

在界面打开「扩展」，点击顶部「导入插件」，选择 ZIP 包。确认名称、版本和类型后，点击「导入并启用」即可使用，无需重启或重新构建。

ZIP 的根目录或一层插件文件夹内应包含 `package.json` 和已构建的入口文件。包内最多 64 个平铺文件，压缩前后均不得超过 5 MB；忽略 macOS 的 `.DS_Store` 和 `__MACOSX` 元数据。预览只检查文件和声明，确认导入后才执行可信插件代码。当前只支持本项目 v1 字段、视图插件包，不能直接导入 DSH 或 iPolloWork 包。

导入文件保存在 `.local/plugins/<id>`，由整个应用共享；启用状态仅写入当前数据库，同库项目共享该状态。其他独立数据库需自行在扩展面板添加/启用；导入包不会因为重启自动在其他数据库启用。重复导入完全相同的包只会启用已有插件，不产生副本。同一 ID 的不同内容不覆盖原包，升级仍按下方流程处理。校验或服务端激活失败会清理本次未完成的导入；视图客户端代码仍在首次打开时加载。

开发时也可使用目录安装命令：

```sh
pnpm plugin:add /绝对路径/已构建插件包
# 重启数据服务，打开「扩展」并添加/启用。
```

安装器校验声明、入口、重复 ID、文件路径与 5 MB 大小限制，将文件复制到 `.local/plugins/<id>`。可通过 `DATA_PLUGIN_DIR` 指定其他本地插件目录。目录安装不接受软链接或子目录。v1 入口为 `.js` / `.mjs` 文件，推荐构建为单入口包。需要额外平铺资源时，必须将文件列入 `files`，并在动态导入或样式 URL 中继承入口 `import.meta.url` 的版本查询参数；无版本的相对导入不受支持。关系图包提供了完整示例。

插件按依赖顺序激活，只能通过注册接口登记自己声明的能力。重复 ID 被拒绝；激活失败撤销已注册能力与清理函数。无效目录记入服务日志，有效清单的加载失败显示在扩展页。某个包失败不终止其他包的加载。

使用 `context.effect(cleanup)` 登记样式、订阅等清理函数。浏览器停用、切换数据库或加载新版本时，按相反顺序撤销注册并清理；清理失败仍继续处理其他清理函数。视图代码仅在首次打开时加载，渲染错误限于该视图。字段被使用时仍禁止停用/卸载，保护已有数据。

服务端字段定义在进程启动或界面导入时加载，进程内共享；每个数据库的启用状态独立检查。关闭某个项目的扩展不会卸载其他数据库仍使用的定义。服务端不接受插件启动任意后台服务的生命周期契约。

升级时先备份旧包，替换本地目录中的包、递增版本并重启数据服务，再在扩展页升级。声明摘要用于浏览器资源版本隔离。当前不做自动在线升级或字段数据迁移；删除目录前先在所有使用它的数据库里迁移字段并卸载扩展。

数据连接器、自动化仍为内置能力，本次独立包加载器仅支持字段与视图。后续扩展可沿用清单和生命周期，但应定义各自的任务、重试与持久化契约。

## 业务关系图

关系图使用已保存记录与唯一关系边，不新增业务表或图数据库。默认从“选择起点”进入：先显示当前表的名称候选，输入名称开头时查当前项目，也可以指定一张表。同名记录保留独立 ID，并显示所属表。选择记录后才读取它的直接关联；初始查询不拉整张关系图，不触发外部 API，不读取正文或完整字段值。

`GET /api/tables/:id/graph/records?q=...&tableId=...` 以入口表固定数据库和项目范围；不传 tableId 时，空搜索推荐入口表，非空搜索当前项目最多 64 个表。每表至多读取 21 条名称候选，最终返回 20 条及 hasMore、tablesLimited 提示；用户可继续输入缩小范围。名称采用不区分大小写的前缀匹配（非纠错或模糊推断），通配字符按原文处理，80 字输入上限、3 秒查询超时。现有主标题列使用 `lower(title) COLLATE "C", _record_id` 索引，新表创建和幂等迁移共用同一索引定义，不复制业务内容。

每次节点展开只读一跳；原始起点、之前展开的边和节点保留，按记录 ID、唯一边 ID 去重。不同分支遇到同一记录时合并为一个节点；环路不会自动继续请求。界面区分“展开关联”和“以此为中心”，支持撤回上次展开；刷新重置为原起点的一层关系。未关联的记录独立显示，不填充同表其他记录。单次和累计展示均限制 200 个节点、400 条边，达到上限后可更换起点继续。数据修改后重新读取反映变化；探索状态只属于当前页面会话。

通过“查看表关系”仍可打开表关系主干图：当前表标为中心，关联表围绕它排列；同一关联定义按 `relationId` 聚合为一条主线，标签常驻显示中心一侧的关联字段名称、基数和当前范围内的记录关联数。不同字段即使同名也不合并，自关联显示为两个字段之间的回环。标签表达双向关联，不表示流程或因果方向；数量来自本次有界读取，不是全库总数。

点击主线可展开这组记录；通过“记录关系”查看当前范围全部记录，通过“以此为中心”或双击关联表重新读取一跳关系并保留返回路径。表关系仅在浏览器聚合已有数据，不新增持久化关系副本。

记录关系图按数据表分组，以记录卡片展示，连线通过两端字段 ID 精确连接到关联字段行。默认收起较大图的属性，可逐张展开最多四个轻量属性；不会读取长文本正文、文件或原始 JSON，也不会为图触发外部 API。卡片属性文字最多 140 字，标题最多 180 字。反向、自关联和不同字段的平行关联各自使用原始字段 ID。

画布支持字段/连线高亮、搜索定位、缩放、拖动卡片、整理布局、展开画布、逐层探索并返回，以及打开跨表原记录编辑。初始缩放保持可读，完整范围可用“适应画布”查看；拖动布局只保留在当前视图会话，整理、收起属性或切换探索范围会重新布局。表格和图复用同一记录表单、保存事务与版本检测。当前不显示跨项目或跨物理数据库图，也不把用户保存的关系推断为因果关系。

项目 MCP 在启用图插件时提供 `relation_graph`。每条边返回 `sourceField` / `targetField`（字段 ID、名称及是否多值），节点返回有界的 `fields` 属性摘要。AI 可根据返回的 `tableId`、记录 `id` 逐步读取，输出访问路径和来源；数据服务不生成或存储模型思维链。

视图需要记录标题时，使用 `data.fields.find(field => field.isPrimary)`；字段可重排，不能把第一列视为固定标题。`ViewProps.onReorderFields(ids)` 可保存完整字段顺序，宿主统一处理版本冲突。
