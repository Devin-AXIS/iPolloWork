# API 实时字段

“添加字段 → 字段类型 → API 实时字段”是独立入口，与普通 JSON 字段并列。选择返回内容类型、本行参数字段，再配置真实接口地址。数字、金额、文本等继续使用已有字段校验和显示组件，不另造一套表格。

接口和参数映射按字段配置一次。新增记录只需填写本行变量，例如“证券代码”“货币代码”或“GitHub 账号”，点击“保存并自动获取”；不需要逐条添加 API。未保存时自动字段显示等待填写或保存后获取，参数改变时显示将按新参数重新获取。接口拒绝查询时保留记录并展示原因，不把权限问题显示为取值路径错误。

点击 API 字段列名，或在数据结构侧栏点击字段名，直接编辑来源、参数字段、取值规则和保存方式。添加和编辑复用同一套字段表单，工具栏不另设 API 配置入口；凭据、精度、刷新间隔等可选项收在“更多设置”。返回值类型保持不变。更换来源、参数或保存方式会清除该列旧结果并重新获取，字段和记录 ID 保留；已有成功值及来源状态写入变更记录。仅修改名称、单位或刷新间隔时保留原值。界面和 AI 使用同一套带结构版本检查的更新服务。

## 获取与保存

| 模式                      | 行为                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| 只读取 · 不保存（`live`） | 读取时调用 API，结果进入本次响应和短期内存缓存，不写入业务字段值。                                 |
| 获取并保存（`snapshot`）  | 成功后把最新值写入原类型的业务列，同时保存来源、获取时间和来源时间。失败保留上次成功值并标注旧值。 |

打开表格、手动更新及 AI 读取都会获取数据；前端只在页面可见且没有打开编辑表单时按间隔刷新。刷新间隔为 5–3600 秒，实际数据时间取决于上游接口。当前没有页面关闭后的定时采集、全量历史行情或全表动态字段统计。

自定义 API 仅在地址包含 `{{value}}` 时要求绑定本表普通文本或数字字段，不能引用另一个 API 字段。固定地址不需要绑定字段，也不要求填写公司或其他变量；参数选择不预设字段。参数被更新时清除依赖字段的旧值和来源状态，避免把另一只证券的价格留在当前记录。API 字段只读，人工、导入和普通自动化不能直接给它赋值。

每表最多 10 个 API 字段，每页最多 50 条记录。相同接口请求共享短缓存与在途请求，服务端网络并发最多 8，单次解析预算 6.5 秒、单个响应最多 1 MB。刷新按钮也有 2 秒最小请求间隔，失败短暂退避；页面不必等待接口才能显示普通字段。

## 三个真实接口示例

首页点击“体验真实 API · 三个示例”，创建一个项目和三张表；所有 API 值从外部接口取得，项目模板只保存公司名称、证券代码等参数。

| 数据表       | 实际来源         | 示例与保存方式                                                               |
| ------------ | ---------------- | ---------------------------------------------------------------------------- |
| 公司股票     | 腾讯公开美股行情 | IBM、TSLA、AAPL 股价与报价日期保存，成交量只读取。每行只填写自己的证券代码。 |
| 人民币汇率   | Frankfurter      | 美元、欧元、港币兑换人民币的参考汇率与来源日期保存。                         |
| 企业开源动态 | GitHub           | 微软、百度、阿里巴巴的公开仓库数与主页保存，关注者只读取。                   |

股票示例缓存时间为一分钟，其余为一小时，页面可手动更新。它们不承诺相同的数据更新频率。股票报价日期、汇率来源日期直接来自响应；GitHub 计数未提供对应观测时间，只展示实际获取时间。来源：[腾讯股票页面](https://gu.qq.com/usTSLA)、[汇率接口](https://frankfurter.dev/)、[GitHub 公开资料](https://docs.github.com/en/rest/users/users#get-a-user)。

“腾讯公开美股行情”是固定来源的轻量适配器，支持股价、前收盘价、成交量和报价日期。输入代码自动去除首尾空格并转大写；从 `https://qt.gtimg.cn/q=usTSLA` 这样的地址读取公开数据。按 GB18030 解码并校验响应所属证券，仅解析数据，绝不执行返回的脚本包装。来源日期按日展示；`observedAt` 使用该日 UTC 零点表示日期精度，不代表该时刻成交，`fetchedAt` 单独记录真实获取时间。公开来源不承诺商业服务稳定性、覆盖全部证券或交易所实时授权。

旧预览的模拟来源已停用，不能新增，旧项目和已经保存的值保留并显示来源不可用；不会继续生成模拟数据。

## 连接真实接口

选择“自定义 API”可连接返回 JSON 的 HTTP GET 接口。地址中的 `{{value}}` 自动替换为本行参数值并进行编码；结果路径使用 JSON Pointer，例如 `/data/price`。来源时间路径可选；配置后必须返回可解析的时间字符串。每个需要变量的字段可绑定一个本行变量，在 URL 中复用多次；没有占位符时 `inputFieldId` 可省略，所有记录共享该固定请求；同一请求的多个结果字段会合并实际请求。多个命名变量、POST 请求和全局连接配置库尚未实现。

数字和金额字段当前最多保存 14 位整数、4 位小数。默认保持原值并严格校验；可在“数字精度”中明确选择四舍五入为 0–4 位小数（`source.decimalPlaces`）。转换使用十进制字符串计算，避免大数经过浮点转换；汇率示例统一配置四位小数，超出精度的原始值不会被静默当作精确值保存。

服务端 `.env` 配置允许访问的完整来源，例如：

```dotenv
DATA_API_ALLOWED_ORIGINS=https://api.example.com
DATA_API_CREDENTIALS={"market-data":{"origin":"https://api.example.com","header":"Authorization","value":"Bearer replace-with-your-key"}}
```

字段配置只填写 `market-data`，不填写密钥。凭据绑定来源，支持授权请求头或查询参数其中一种；不跟随 HTTP 重定向。外部接口仍需自行取得授权。配置更改后重启数据服务。

Alpha Vantage、Frankfurter 和 GitHub 的上述 API 来源已在允许列表中。可配置其 `apikey` 查询参数凭据，接口示例为 `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={{value}}`，价格路径 `/Global Quote/05. price`，来源日期路径 `/Global Quote/07. latest trading day`。报价频率和实时数据权限取决于其服务方案，不能把本地刷新频率当作交易所实时行情。[官方接口说明](https://www.alphavantage.co/documentation/#latestprice)

## AI 与 API 契约

`GET /api/field-providers` 返回提供者、来源配置 JSON Schema 和获准来源。`/api/capabilities` 同时包含这些信息。创建字段仍使用统一的 `field.create` 或字段 REST 接口，`type` 表示返回值类型，`source` 表示 API 来源；UI 中的“API 实时字段”不改变这两个维度。

```json
{
  "name": "股价",
  "type": "currency",
  "source": {
    "provider": "json-api",
    "inputFieldId": "证券代码字段的 UUID",
    "url": "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={{value}}",
    "valuePath": "/Global Quote/05. price",
    "observedAtPath": "/Global Quote/07. latest trading day",
    "credential": "market-data",
    "storage": "snapshot",
    "ttlSeconds": 30,
    "unit": "USD"
  }
}
```

结构蓝图中 `source.inputFieldId` 可以引用同表字段的 `key`；构建时先创建普通字段，再解析 API 参数引用。预览只校验配置与结构，不访问外部接口，也不保存记录。

- `GET /api/tables/:id/records` 和 `records.list`：解析 API 值，按字段保存策略保存最新成功值。
- `GET /api/tables/:id/records?dynamic=defer`：仅返回已保存值，不调用外部接口；只读取模式的业务值为 `null`。
- `GET /api/tables/:id/records?refresh=1`：请求更新接口结果，仍遵守最小间隔和失败退避。
- `PATCH /api/tables/:id/fields/:fieldId` 或 `field.configure`：传入 `tableVersion`、`name`、完整 `source`，更新已有 API 字段；过期结构版本返回 409。AI 命令另传 `tableId` 和 `fieldId`。

公开美股来源配置为 `{ "provider": "tencent-stock", "metric": "price", "inputFieldId": "证券代码字段 UUID", "storage": "snapshot", "ttlSeconds": 60, "unit": "USD" }`。`metric` 可选 `price`、`previousClose`、`volume`、`date`；日期指标要求日期类型，其余要求数字或金额类型。

每条记录的 `dynamic` 按字段 UUID 返回 `status`、`source`、`simulated` 以及可用的 `fetchedAt`、`observedAt`、`expiresAt`、`error`。业务字段值保留在 `values`。`fresh` 表示缓存有效，不保证上游报价实时。客户端应按 `expiresAt` 判断旧值。

网络请求在数据库事务外执行。保存时重新核对表和记录版本，参数或记录已被修改的旧请求不能覆盖新记录。数值变更与 `field.snapshot` 事件在同一事务写入；获取时间可以更新，但相同缓存结果不会重复写库。没有新增数据库表、运行服务或依赖。
