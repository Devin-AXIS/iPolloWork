# 能力 HTTP API

[English](capabilities.md) | 中文

账号服务通过 HTTP 提供模型能力。iPolloWork 原生工具和外部应用共用授权、供应商路由、实际用量计费和调用回执。供应商 Key 保存在服务端配置中；外部访问 Key 不授予账号管理或文件访问权限。

## 查询和描述

在**服务中心 → API 接入**中创建访问 Key，完整内容只显示一次。请求使用 `Authorization: Bearer <key>` 或 `X-API-Key: <key>`；原有账号会话 Token 仍可使用。`GET /api/v1/capabilities` 返回简短能力列表，`?kind=image` 按类型过滤。API 支持 `chat`、`image`、`video`、`speech`、`transcription`、`embedding` 和 `rerank`。列表只包含已启用、已授权、已定价且具备受支持协议和调用路由的服务；API 支持某种类型不代表当前部署已有可用模型。

`GET /api/v1/capabilities/:id` 返回输入 JSON Schema、模型 ID、限制和调用地址。模型列表默认每页 25 项，可使用 `offset`、`limit`（最多 100）和返回的 `nextOffset`；`?model=<id>` 查看单个模型。输入描述任务而非供应商接口：图片和视频使用 `prompt`，语音合成使用 `text`、`voice`，识别使用 `audio`，向量使用 `texts`，重排使用 `query`、`documents`。完整参数以接口返回的当前 schema 为准。

当服务包含多个创建路由时，模型必须配置 `invocationPath`，或具有已核对的供应商预设映射。路径必须匹配该服务配置的 POST 路由，不会根据新模型名称猜测接口。模型可选的 `inputModalities` 声明输入类型；只有模型元数据或维护的供应商目录声明支持图片时，原生聊天才启用图片输入。音频理解和语音识别是不同能力。

## 调用和读取结果

向 `POST /api/v1/capabilities/:id/invoke` 提交 JSON：`{ "requestId": "<UUID>", "model": "<模型 ID>", "input": { ... } }`。省略 `model` 时选择第一个推荐且可用的模型，否则选择第一个可用模型。重复同一请求时保持 `requestId` 不变，同一 ID 搭配不同请求内容会被拒绝。服务端构造供应商请求，调用者不能指定供应商 URL、授权头或任意 HTTP 路径。

~~~sh
curl "$IPOLLOWORK_ORIGIN/api/v1/capabilities" \
  -H "Authorization: Bearer $IPOLLOWORK_ACCESS_KEY"
~~~

响应包含 `requestId`、`kind`、`state` 和 `result`。`result` 保留供应商 JSON，包括输出 URL 和用量；二进制响应返回 MIME 类型及 Base64 数据。`pending` 响应包含 `task` 地址。查询 `GET /api/v1/capability-tasks/:requestId` 时，服务端检查回执所有权并刷新供应商任务，不会再次提交生成请求；已经保存的完成结果直接复用。结果沿用执行回执的保留期限，同步结果过期返回 HTTP 410。`unknown` 表示结果待确认，应查询或核对，不能换新 ID 盲目重提。

调用沿用原有套餐权限和实际用量结算：付费计量任务要求正余额，结算后允许欠额，下一次付费调用前需要补充余额。固定价格服务保留原计费方式。此 API 不增加按账号并发限制，模型限制和运营者明确配置的限制仍然生效。

## 访问 Key 和原生工具

`GET`、`POST`、`DELETE /api/v1/access-keys[/<id>]` 用于查询、创建和撤销当前用户的 Key。创建接受 `name` 和可选的有效秒数 `expiresIn`。管理 Key 必须使用普通账号会话，访问 Key 不能继续创建其他 Key。Better Auth 负责 Key 哈希、有效期、所有权及 `apikey` 表。启动通过现有迁移流程执行插件新增的认证表迁移，部署前应备份 PostgreSQL 和认证密钥。业务 `service_schema` 和原有回执格式保持不变，不另建任务表或计费表。

原生工具为 `ipollo_capabilities`、`ipollo_capability_describe`、`ipollo_capability_invoke` 和 `ipollo_capability_task`。工具描述先提供发现入口，再按需加载模型参数。调用根据原生 Session 和工具调用标识生成稳定回执 ID，传递取消信号，并拒绝只读会话执行。注册随套件生命周期释放，独立调用可以并行。账号未配置时明确报告，不回退到未配置的供应商。
