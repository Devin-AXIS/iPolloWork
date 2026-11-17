# iPolloWork 的 iPollo Stage 插件

这是独立 Stage 服务的轻量原生 DSH 插件。在侧栏打开 **Stage**，首次关联**已有 Stage 账号**，到 Stage 确认授权后刷新面板。之后通过一次性票据自动登录。加载插件不会打开 Stage，也不会启动生成。

对话调用前，用户需要在面板中明确允许当前工作区。`ipollo_stage` 工具支持：

- `catalog`：分页组件列表、指定组件的内容协议、背景、主题和风格。
- `document`：列出、读取 SceneDoc；保存时传入 `projectId`、`doc` 及上次读取的 `expectedRevision`（`updatedAt`）。未明确替换的对话、资料和选择项会保留；并发编辑会拒绝覆盖。
- `source`：通过 `input.path` 上传已启用工作区内的 PDF、PPTX、文本或图片，最大 5 MB。生成时把返回的资料 ID 传入 `documentIds`；更大文件可在 Stage 上传。
- `generate`：`message`，可选 `projectId`、`tier`、`documentIds` 及 Stage 实时场景生成选项。持久深度影片方案在 Stage 编辑器内讨论并确认，沿用原来的工作流与 Work 结算。返回任务后轮询；请求结果不确定时查询原任务，不重新生成。新场景、修改场景和自定义背景遵循 Stage 原有 SceneDoc、组件和背景协议。
- `export`：`projectId`，可选 `resolution`（`720p`/`1080p`）、`narration`、`voice`。用 `task` 和 `kind: "export"` 查询进度；完成后返回需要当前账号权限的下载路径。
- `task`：`taskId`，可选 `kind`（`generation`/`export`）和 `cancel`。
- `download`：将已完成导出任务的 `taskId` 保存到当前工作区的 `stage-exports` 目录，使用唯一文件名，保留已有文件。

凭证只保存在 Work 账号服务和 Stage 服务端加密存储，不进入浏览器存储、工具参数。切换账号后工作区授权失效。只读会话不能生成、上传、写入文档或导出。Stage 独立账号与项目仍然独立。

仅支持管理员配置的平台官方模型。根据可信的实际输入、输出 Token 结算 Work 积分，不冻结余额。账单幂等，使用开始时的价格快照，供应成本和收入进入 Work 现有服务账本。模型未返回完整用量时等待核对；网络结算失败保留持久重试记录。每个 Work 钱包同时仅允许一个生成任务，避免无限并发欠费。实际用量超过剩余积分时记录真实扣费，余额转正后才能开始下一次生成。

Stage 适配插件随完整桌面安装包交付；Stage 服务与编辑器独立部署。其他独立分发插件延续原来的打包规则。

## 运维配置

先备份 PostgreSQL 与两端认证、加密密钥，再配套部署 Stage 关联迁移和 Work 服务。Stage 的私有 `.ipollowork` 加密密钥必须跨版本保留。Stage 的 `ACCOUNT_PUBLIC_URL`、`IPOLLOWORK_ORIGIN` 使用精确 HTTPS 源站地址。Work 的 Stage 设置包含 `enabled`、`origin`、`rates`；`rates` 是 JSON 数组，结构为 `{model,input,output,cacheRead?,inputCostMicros?,outputCostMicros?}`，价格均以每百万 Token 为单位，成本以微货币单位表示。模型 ID 必须与 Stage 的官方模型一致，不能编造默认商业价格。未配置时关闭调用并在界面提示管理员配置。

`npm run check` 运行严格类型检查、所有者/工作区授权/策略测试和构建；`npm run pack:check` 检查发布包。先用仓库根目录 setup 命令准备对应版本的 DSH 和 suite。参见[英文文档](README.md)。
