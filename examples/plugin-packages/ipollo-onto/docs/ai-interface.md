# AI 结构与数据接口

本项目独立运行，所有模型调用属于 iPolloWork。这里实现的是 AI 可直接调用的数据接口，不要求 Agent 打开浏览器、点击字段或模拟人操作。项目 MCP 可由 iPolloWork 原生 MCP 入口连接，结构和记录操作共用本机 API 的内核。

## 轻量业务探索

业务记录和双向关系仍是唯一数据来源。业务目录与探索结果按需计算，没有新增数据库表、图数据库、索引服务或模型调用。目录、搜索和关系查询不依赖关系图视图扩展启用。

1. `business_catalog({page:1})`：每页最多 30 个表，返回名称、说明、主字段和关系入口；继续读取 `nextPage`。详细字段按需用 `query_context` 获取。
2. `records_find({query:"百度",tableId:"实际表 UUID"})`：名称前缀搜索，最多 20 条。未指定表时项目搜索最多 64 个表；检查 `hasMore` / `tablesLimited`，按目录选表继续。
3. `relation_explore({tableId,recordIds,depth:2,direction:"both",relationIds})`：从同一表的 1–10 条记录出发，选择关系类型、经过的表和方向。`tableIds` 总是包含起点表；空 `relationIds` 表示只读起点。

默认 1 层、100 个节点、200 条边，上限 3 层、200 个节点、400 条边。最多考察 256 类关系定义；达到任何截断上限时返回 `limited:true`，应缩小范围重新查询。深度只是本次探索范围，不代表已经遍历所有业务。

结果保留关系两端的字段 ID、记录 ID、查询条件和读取时间 `observedAt`；不会实时调用 API，不会保存推测关系。共同供应商等结论由返回的路径佐证，并不创建新的业务字段。文档或外部搜索中发现的关系，由 iPolloWork 分析并单独标注未确认；当前没有候选关系写入功能。

`navigation.href` 是相对于 Onto 界面地址的链接，打开后在关系图中重放同一个查询；需要开启关系图视图。链接不保存快照，也不表示自动控制宿主界面。单表 MCP 的链接保留单表限制，项目 MCP 只查当前项目；跨物理库关系仍不支持。

界面复用 `POST /api/tables/:id/graph/explore` 与 MCP 的查询内核，可切换 1–3 层和继续展开节点。探索按层批量读取，使用原有双向关系索引，循环和重复边会去重；每次查询在只读一致性事务中完成。

## 项目与表的 API / MCP

项目管理 →「API / MCP」连接整个项目；表右上角「…」→「API / MCP」连接单张表。两处复用同一个接入面板，可复制 MCP 配置、复制包含实际结构的 AI 说明、下载 OpenAPI。结构说明按打开面板时的实际数据生成；Agent 开始执行前仍需重新读取结构与版本。

| 范围 | MCP 地址                | 结构与 API 文档                                          |
| ---- | ----------------------- | -------------------------------------------------------- |
| 项目 | `/api/projects/:id/mcp` | 同路径前缀下 `/context`、`/openapi.json`、`/integration` |
| 单表 | `/api/tables/:id/mcp`   | 同路径前缀下 `/context`、`/openapi.json`、`/integration` |

MCP 使用官方 TypeScript SDK 的 **Streamable HTTP、无状态 JSON 响应**，直接运行在现有 Node 服务上，没有额外进程、会话存储或数据库表。客户端连接本机 `http://127.0.0.1:5711`（自定义 PORT 时使用实际端口）。支持 initialize、tools/list、tools/call、resources/list 和 resources/read。GET / DELETE 返回 405，不提供 SSE 订阅；客户端配置格式因客户端而异，支持 HTTP MCP 的客户端可直接填写连接 URL。

工具共用现有校验、数据库路由、事务与版本控制：

| 工具                              | 行为                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `data_context`                    | 当前表、字段、关系、版本及可用字段类型 / API 来源；不含记录正文  |
| `records_list`、`record_get`      | 只读已保存的数据；不访问外部 API，不保存快照                     |
| `records_refresh`                 | 显式获取 API 字段，按来源配置保存快照；属于可能写入的操作        |
| `record_create`、`record_update`  | 按字段 ID 写入；更新必须提供记录 version                         |
| `records_import`                  | 按文本键批量导入或更新；每批最多 200 行，requestId 幂等          |
| `field_create`、`field_configure` | 新增字段，或按表版本修改已有 API 字段设置                        |
| `relation_graph`                  | 项目范围、启用关系图插件后提供；读取一跳真实关联，不访问外部 API |
| `schema_preview`、`schema_apply`  | 仅项目范围提供；从结构创建表与关联，project 由地址绑定           |

`records_list` 每页 50 条，`query` 是标题前缀，不是全文检索或任意筛选。`record_get` 使用 recordId。单表工具省略 tableId，项目中操作某张表时提供 tableId。API 字段只读，不能通过普通写入覆盖。MCP 成功返回 `structuredContent.result` 以及兼容文本；业务失败使用 `isError: true`，错误体包含 status，版本冲突为 409。工具注解标识读写、幂等和是否访问外部系统。

相同操作也可通过 `POST /api/projects/:id/operations/:工具名` 或 `/api/tables/:id/operations/:工具名` 调用，JSON 请求体与 MCP 参数相同。REST 成功直接返回业务结果。完整参数由 OpenAPI 从同一份工具定义生成，无需另维护一套接口。

范围内才可沿关联读取和修改：单表接入隐藏指向其他表的关联；项目接入保留本项目内的关联，隐藏跨项目关联。两种接入均拒绝范围外的表、字段与建表关联目标。跨表分析应使用项目接入，再根据返回的关联记录 ID 读取目标记录。独立数据库项目自动路由到已绑定的库。

**范围绑定不是身份认证。** 当前仍为受信任的本机单实例，原有内部 API 也继续可用；不应把这里的范围地址当作多用户权限隔离。尚未实现令牌授权、远程访问、行级权限或宿主自动注册。iPolloWork 原生 MCP 接入已联调，自动安装宿主插件和选择上下文同步尚未实现；本项目不调用任何模型。

设计参考了 [Teable 的表级 AI 文档入口](https://community.teable.ai/t/mcp-server-for-cuppyclaw/221)、[官方 Agent Skills](https://github.com/teableio/agent-skills)、[NocoBase MCP](https://docs.nocobase.com/ai/mcp/)、[Notion MCP](https://developers.notion.com/guides/mcp/overview) 和 [官方 MCP SDK](https://ts.sdk.modelcontextprotocol.io/server)。借鉴结构发现、范围上下文与统一工具的做法，没有引入这些产品的应用内核。Teable 链接中的 MCP 状态是其 2026-04-30 回复时的状态，不作为其当前功能结论。

## iPolloWork 本机接入

在宿主的 MCP 设置里添加远程 MCP，URL 使用项目或单表的连接地址，关闭 OAuth。例如：

```json
{
  "type": "remote",
  "url": "http://127.0.0.1:5711/api/projects/项目UUID/mcp",
  "enabled": true,
  "oauth": false
}
```

iPolloWork 的配置对象与通用客户端的 `mcpServers` 外层不同，应使用宿主原生 MCP 设置。本机 MCP 协议接入已验证；实际模型对话的完整验收仍需在用户自己的模型配置下进行。

[下载安装 iPolloWork 插件](ipollowork-plugin.md) 后，可使用结构构建、关联分析和文档更新工作流。插件采用声明式 Skill 包；本地服务仍独立启动，项目 MCP 通过宿主原生设置连接一次。插件不会自动启动数据库、注册本机 HTTP MCP 或同步当前选中记录。

关系查询顺序：先 `data_context` 发现表和关联，再用 `records_list` 找到记录 ID，最后调用 `relation_graph({tableId, recordId})`。边上的 `sourceField` 和 `targetField` 给出两端确切字段，节点 `fields` 是最多四个已存储属性的有界摘要，不含文档正文，也不代表实时 API 刷新结果。沿返回的其他节点继续查询时，保存已访问集合、限制总跳数和节点数。答案应说明访问过的表、记录和关联字段；这些是数据依据，不是隐藏思维链或因果证明。

## 发现与执行

先读取 `GET /api/capabilities`，取得当前命令的 JSON Schema、已安装扩展和限制；读取 `/api/field-types` 取得可用字段类型。统一入口是 `POST /api/commands`，请求头使用 `Content-Type: application/json`。当前只允许受信任的本机环境，不提供企业成员认证；不得直接暴露到公网。

| action              | 其他参数                                                                 | 实际能力                          |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| `project.create`    | `input`                                                                  | 创建默认或独立数据库项目          |
| `schema.preview`    | `input`                                                                  | 校验并预览整批新结构，不落库      |
| `schema.apply`      | `input`                                                                  | 一次创建项目、表、字段和双向关联  |
| `schema.get`        | `projectId`                                                              | 读取稳定 ID、字段、关系与结构版本 |
| `field.create`      | `tableId`, `input`                                                       | 向已有表添加普通、API 或关系字段  |
| `field.configure`   | `tableId`, `fieldId`, `input.tableVersion`, `input.name`, `input.source` | 修改已有 API 字段的共享来源配置   |
| `records.list`      | `tableId`, 可选 `page`, `query`                                          | 分页读取记录，query 是名称前缀    |
| `record.create`     | `tableId`, `input.values`                                                | 使用字段 UUID 写入新记录          |
| `record.update`     | `tableId`, `recordId`, `input.version`, `input.values`                   | 按版本更新，未提供字段保持不变    |
| `records.import`    | `tableId`, `input`                                                       | 按指定匹配键导入或更新一批记录    |
| `automation.create` | `tableId`, `input`                                                       | 创建新记录后自动填入空字段的规则  |

表格、API 和 AI 指令复用同一套校验、关联与事务服务。错误返回 HTTP 400/404/409；输入结构错误同时返回 `issues` 的字段路径，供 AI 修正。409 表示数据状态或依赖冲突，需重新读取，不能盲目覆盖。

## 项目与存储

`POST /api/projects` 与 `project.create` 使用同一输入，包含 `name`、可选 `description`、`color` 和 `database`。省略 database 等同 `{ "mode": "default" }`；独立连接为 `{ "mode": "independent", "connection": { "engine": "postgres", "host": "127.0.0.1", "port": 5432, "database": "sales_data", "user": "project_user", "password": "由受信任配置入口提供", "ssl": "verify-full" } }`。engine 也接受 highgo，表示待实机验证的 PostgreSQL 兼容连接。可选 ca 为 PEM 证书，缺省使用系统信任根。

凭据只由受信任的配置入口传给服务端；宿主对话、模型输入和日志应使用项目 ID，不携带明文密码。响应返回项目与连接摘要，永不返回密码或证书。项目创建当前没有 requestId 幂等协议；响应不确定时先查项目列表，避免盲目重复创建。独立库初始化中断保留待完成路由，同一绑定后续连接时可恢复。

先创建独立项目，再以 `project: { "id": "该项目 UUID" }` 调用 schema.preview/apply，即会在该库构建。结构输入里直接使用项目名称创建的新项目仍进入默认库。记录与表 API 根据稳定 ID 自动路由，不需要传密码或数据库地址。跨物理数据库的直接关联会拒绝。

- `GET /api/projects/:id/database`：连接摘要与当前状态。
- `POST /api/projects/:id/database/test`：重新检查已保存连接。
- `POST /api/databases/test`：测试新连接；仅执行读取，不建库、不建表。
- `PATCH /api/projects/:id`：更新名称、描述和颜色；不接受数据库重绑定。
- `/api/extensions`、`/api/field-types`、`/api/capabilities` 可加 `?projectId=UUID` 读取所在数据库的能力；扩展启停也使用此参数。不提供时使用默认数据库。

## 一次创建业务结构

以下是完整请求；实际调用时生成自己的 `requestId`。把 `action` 改为 `schema.preview` 即可先预览。预览返回的 UUID 是临时值，不可用于记录写入；正式创建的结果会返回真实 ID 映射。

```json
{
  "action": "schema.apply",
  "input": {
    "schemaVersion": 1,
    "requestId": "d17aa55f-c050-48f4-a809-04778896170c",
    "project": { "name": "销售管理" },
    "tables": [
      {
        "key": "customers",
        "name": "客户",
        "fields": [
          { "key": "name", "name": "客户名称", "type": "text", "required": true },
          { "key": "tags", "name": "标签", "type": "tags" }
        ]
      },
      {
        "key": "deals",
        "name": "商机",
        "fields": [
          { "key": "name", "name": "商机名称", "type": "text" },
          { "key": "amount", "name": "预计金额", "type": "currency" },
          {
            "key": "status",
            "name": "阶段",
            "type": "select",
            "options": ["待跟进", "进行中", "已完成"]
          }
        ]
      }
    ],
    "relations": [
      {
        "from": "deals",
        "to": "customers",
        "key": "customer",
        "name": "客户",
        "reverseName": "商机",
        "multiple": false,
        "inverseMultiple": true
      }
    ]
  }
}
```

`project` 也可以是 `{ "id": "现有项目 UUID" }`，表示向该项目新增表。首字段固定为文本标题；每张表的结构键和字段结构键不能重复。一次最多 20 张表、每表总计 100 个字段、50 条关系。关系会增加反向字段，因此同样计入目标表字段上限。

关联已有表时，`to` 使用目标表 UUID，并提供读取结构时取得的 `targetVersion`；支持当前同一物理数据库中的跨项目目标。版本变化会拒绝整批操作。此接口只新增，遇到同名表不会猜测覆盖或合并；向已有表加字段使用 `field.create`。

相同 `requestId` 与相同内容重复提交返回首次结果，不重复建表；同一标识不同内容返回冲突。回执属于项目生命周期，项目删除后不再保证历史请求的幂等。一次调用中任一字段或关系失败，整批 DDL 与元数据一起回滚。

## 字段值格式

| 类型                                               | 值示例                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| text / longtext / email / phone / url              | 字符串；邮箱、电话、链接有对应校验                         |
| number / currency / percentage / progress / rating | 十进制字符串；百分比和进度 0–100，评分为 0–5 整数          |
| boolean                                            | `true` 或 `false`                                          |
| select                                             | 选项字符串                                                 |
| multiselect / tags                                 | `["销售", "服务"]`；多选必须来自字段选项，标签允许自由内容 |
| date / time                                        | `"2026-09-10"` / `"14:30"`                                 |
| datetime                                           | `"2026-09-10T14:30:00+08:00"`；必须带时区，保存为 UTC      |
| daterange                                          | `{ "start": "2026-09-10", "end": "2026-09-20" }`           |
| image / file                                       | 已有文件的 HTTP(S) URL，不是上传接口                       |
| json                                               | JSON 值                                                    |
| relation                                           | 写入记录 UUID 数组；单条关系同样使用数组，清空使用 `[]`    |

普通可空字段清空使用 `null`。创建记录必须满足必填约束。关系在读取时返回包含 ID、标题和目标表 ID 的对象数组；更新时只传 UUID，不把展示对象直接原样写回。

## 导入和最小自动化

`records.import` 的 input 为 `{ "requestId": "UUID", "keyFieldId": "匹配字段 UUID", "rows": [{ "字段 UUID": "值" }] }`。匹配字段必须是文本类，常用外部编号；每批最多 200 行，精确匹配，不进行模糊名称关联。一个键对应多条现存记录时整批拒绝；已有记录只更新本次提供的字段。同一个请求可安全重试。外部服务可以通过它主动推送数据，当前没有轮询 CRM 的连接器。

先启用轻量自动化扩展，再调用 `automation.create`，input 为 `{ "name": "默认阶段", "fieldId": "阶段字段 UUID", "value": "待跟进" }`。新记录创建后字段为空才写入，已有值保留。规则从创建时开始处理新事件，暂停期间保留积压，重启或重新启用后继续；运行需要本项目服务在线，浏览器可以关闭。

API 实时字段已实现，入口与普通 JSON 字段独立，具体配置和读取/保存语义见 [API 字段](api-fields.md)。结构蓝图中的 `source.inputFieldId` 可以用本表普通字段的结构键引用，构建时解析为稳定 UUID。`records.list` 解析 API 值并执行字段保存策略；API 字段不可被普通写入、导入或填值规则覆盖。

当前没有任意定时任务、外部 HTTP 自动化动作或 AI 自动化执行。后续通过相同能力声明增加动作，模型调用始终交给 iPolloWork。

## 展示配置与顺序

项目、表的创建参数可传 `icon`（枚举见 `src/core/icons.ts`）；已有项目在项目更新请求中传入 `icon`。`PATCH /api/tables/:id` 支持单独提交 `{icon, version}`，返回更新后的表。

- `PATCH /api/projects/:id/tables/order`：`{ids, previousIds}`，两个数组都包含该项目的完整表 ID；原顺序不一致返回 409。
- `PATCH /api/tables/:id/fields/order`：`{ids, version}`，完整字段 ID 与当前表版本；成功返回 `{table, fields}`，过期版本或不同字段集合返回 409。

顺序接口使用所属项目的数据库。字段返回 `isPrimary` 指定记录标题；移动列不改变标题身份、字段 ID、API 变量绑定或关系。上述展示配置目前通过 REST 提供，未增加专门的 MCP 排序工具。

## 记录文档与 AI 局部更新

文档独立于字段和记录版本。项目/表的 API 与 MCP 提供 `documents_list`、`document_get`、`document_create`、`document_update`、`document_link`、`document_unlink`、`document_table`。项目级调用携带 `tableId`；表级调用省略它。先读取元数据，再按需读取正文和文档 `version`。同项目跨表关联只增加记录绑定，共享同一份正文。

例如，`document_update` 的项目级参数：

```json
{
  "tableId": "数据表 UUID",
  "recordId": "记录 UUID",
  "documentId": "文档 UUID",
  "input": {
    "version": 3,
    "operations": [
      {
        "op": "replace",
        "blockId": "从正文 attrs.id 读取的块 ID",
        "block": {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "更新后的研究结论。" }]
        }
      },
      {
        "op": "append",
        "blocks": [{ "type": "paragraph", "content": [{ "type": "text", "text": "新增依据。" }] }]
      }
    ]
  }
}
```

`replace` 保留目标块 ID，`remove` 接收 `blockId`，`append` 接收块数组。也可传完整 `content`，但不能与 `operations` 同时传。版本冲突返回 409；重新读文档后再判断如何合并，不能盲目覆盖。块结构为受限的 Tiptap JSON，拒绝任意 HTML、脚本链接、重复块 ID 和超限正文。AI 写入与手工编辑走同一验证/版本路径。新建时可传客户端 UUID，相同创建参数可恢复不确定的创建结果。

REST 基础路径为 `/api/tables/:tableId/records/:recordId/documents`：GET 列表、POST 新建；`/:documentId` 支持 GET/PATCH；`/:documentId/link` 支持 POST 关联和 DELETE 解除关联；`/table` POST 分页读取引用表；`/:documentId/version` GET 只查版本；`/:documentId/images` POST 上传图片；`/:documentId/export` GET 默认下载 HTML，`?format=docx` 下载原生可编辑 Word。导出只读取当前文档正文，不包含记录详情、关联标签页或其他文档；正文中的 `dataTable` 按现有范围导出数据快照。前端导出前会保存当前草稿，PDF 使用隔离的正文预览与浏览器“另存为 PDF”，不引入服务端办公转换进程。Word 内嵌本地 PNG/JPEG/GIF，外部图片和视频保留链接，其他媒体保留原文查看提示。`GET /api/projects/:projectId/documents?q=&page=1` 返回项目文档元数据。

引用表块使用 `type: "dataTable"`，其 `attrs` 为 `{tableId, viewId?}`，或 `{tableId, selection?}`，或 `{tableId, recordId, relationFieldId?}`。三种筛选来源互斥；稳定 ID 可保证文档在其他记录打开时仍引用同一来源。读取只返回已保存值，不触发外部 API。

文档编辑器的 `/table` 请求可传 `interactive: true`，返回完整字段与分页记录，直接复用主表的编辑、字段新增、排序和列宽组件。新增和编辑仍走原表的记录/字段 API，不把业务数据复制进文档，也不增加文档版本。关联引用额外返回 `createValues`，包含反向关联字段的默认记录 ID；创建记录时一并提交，由原有事务维护双向关联。未传 `interactive` 时（包括 MCP 与导出），仍保留最多 6 个简要字段、每页 50 条的读取方式。同一文档中的多个引用在写入后一起更新；点击记录沿用右侧详情和返回路径。

本轮已验证文档 HTTP/MCP 操作与版本冲突；未验证 iPolloWork 中实际模型对话生成文档的完整流程。当前没有额外模型服务、公开分享托管、OSS 实现或全文检索索引。表格查询路径不加载文档正文。

### 对话与可见操作

0.1.4 的操作输入支持可选顶层 `workbench: {id: "工作台返回的 UUID"}`，由当前 Workspace App 的 `onto_status` 返回。`onto_bind({projectId})` 仅设置当前对话默认项目，不改变数据工具范围。未携带该参数的旧调用仍有效；携带后，成功活动通知只向对应工作台提供定位，数据更新仍通知共享项目。

AI 直接创建表、分批写记录、按块改文档；UI 在提交后显示真实结果，并定位表、记录页或文档块。用户正在编辑时自动暂停，手动恢复。`onto_navigate` 供明确导航请求或旧服务回退使用，不应在每次写入后强制调用。页面上下文只提供定位信息，记录和文档正文仍需通过原工具读取。

正文也支持 `video`（`attrs.src` 为直链或本地上传地址）以及 `table` / `tableRow` / `tableCell` / `tableHeader`。普通表格属于文档正文；业务数据表继续使用 `dataTable` 引用。普通表格最多 100 行、每行 30 个单元格，单元格包含段落等文本块。视频上传使用 `POST .../:documentId/media`，请求为 `{data: "Base64"}`，支持 MP4/WebM、最大 25 MB；返回的项目文件地址支持 Range 请求。图片仍使用 images 接口，最大 5 MB。HTML 正文块暂缓，本轮没有开放该类型。
