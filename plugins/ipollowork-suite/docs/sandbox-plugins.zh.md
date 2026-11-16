# 阿里云沙箱插件

iPolloWork 包含可选执行工具 Cordis 插件 `@ipollo/dsh-suite/aliyun-sandbox`，复用已有的阿里云 Agent Sandbox 适配器及执行生命周期。DSH 负责智能体执行、工具调度和会话记录，不新增智能体或修改官方源码。OpenSandbox 暂缓交付，不导出其入口、不安装其 SDK，也不包含旧构建文件。

组件在 `cordis.patch.yml` 中默认关闭，安装 iPolloWork 不会创建云资源。云端 Agent 预设或专用云端 Host 可启用该组件；本地项目继续使用原有工具和配置。只读会话会拒绝沙箱操作。远端文件系统的隔离由沙箱和挂载权限保证，不等同于 DSH 本地 `workspace-write` 路径限制。

## 配置

部署人员通过官方 `dsh` profile 启动器和配置补丁启用插件。密钥仅在 Host 环境变量中，不写入配置文件、模型参数或浏览器存储。用户不填写端点、密钥或 OSS 参数。[完整 YAML 示例和参数](sandbox-plugins.md#operator-configuration)。

配置行使用 `id: ipollowork-aliyun-sandbox`、`disabled: false`，以及 `apiUrl`、`domain`、`apiKeyEnv`、`template` 和 `releaseAfterTurn`。端点与模板以部署账号控制台为准。E2B SDK 固定为已有适配器测试的 2.31.0，不替代 DSH。

插件提供 `sandbox_exec`、`sandbox_read_file`、`sandbox_write_file` 和 `sandbox_release`，结果通过 DSH 原生工具卡片展示并写入会话。首次调用才创建沙箱；取消或失败后释放环境，释放失败的环境不得复用；关闭插件会释放资源并等待已接收操作结束。远端释放无法确认时，由提供方 TTL 兜底。

## 持久化与移动端

未绑定项目时文件属于临时沙箱，启用 `releaseAfterTurn` 会在回合完成后连文件一起删除。持久化模式需配置 `project: { serviceUrl, projectId, tokenEnv }` 和 `storage: { bucket, endpoint, roleArn }`。后台必须在每次操作前通过 `GET /api/v1/projects/:id/runtime` 授权，返回已有项目卷格式。授权失效或响应无效时停止执行并释放保留的沙箱，不退回临时目录。

阿里云将获授权的项目标识映射到 OSS 的 `/ipollowork/<volume-identity>/`，挂载到 `/mnt/project`。模板必须提供 `mountpoint`；挂载验证失败会释放沙箱并中止任务。生产使用前仍需验证 RAM 权限与真实存储行为，不能仅凭挂载配置宣称租户隔离。

当前 PostgreSQL 服务已增加项目卷授权与云端启动接口。可选云端项目组件在阿里云沙箱中启动完整官方 DSH profile，因此普通 DSH 终端与文件工具在云端执行，不通过 `sandbox_*` 工具替换本地工具。配置、资源归属、验证范围和限制见[云端项目](cloud-projects.zh.md)。旧 SQLite 服务和本机子进程启动器不合入。

## 验证

`npm run check` 构建插件入口、执行类型检查和测试，覆盖真实 E2B SDK 的本地 HTTP 交互、官方 DSH Agent 循环调用、只读权限拒绝、项目授权和资源清理。工具定义快照位于 `tests/expected/sandbox-tools.schemas.json`。这些测试不创建付费云资源，也不代表真实阿里云和 OSS 已联调通过。

发布包不依赖相邻工作目录，也不包含 DSH 上游实现。[阿里云 SDK 文档](https://www.alibabacloud.com/help/en/functioncompute/using-the-cloud-sandbox-via-the-sdk)、[OSS 动态挂载文档](https://www.alibabacloud.com/help/en/agent-sandbox/mount-oss-dynamically-1)。
