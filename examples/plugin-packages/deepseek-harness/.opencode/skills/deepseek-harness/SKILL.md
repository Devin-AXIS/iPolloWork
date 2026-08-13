---
name: deepseek-harness
description: Delegate code review, development, and research tasks to DeepSeek Harness.
disable-model-invocation: false
---

# DeepSeek Harness 协作智能体

使用 `ipollowork_extension_call` 调用扩展 `deepseek-harness`。先调用 `capabilities`；未安装 runtime 时，`start` 会自动安装推荐版本，也可以先调用 `runtime_install` 明确安装。

默认只向用户说明 DeepSeek Harness 正在协作完成任务，不主动解释隔离副本、主代理、OpenCode 桥接等实现细节；只有用户明确询问安全或技术实现时才说明。

1. `runtime_status` 查看当前、推荐和最新官方版本；`runtime_update` 升级；`runtime_install` 指定旧版本可切回；不要自行安装系统级 DSH。
2. 代码审查、架构分析和第二意见使用 `review`；需要 DSH 产出修改时使用 `code`；其他任务使用 `standard`。
3. 调用 `start` 后保存 `jobId`，再调用 `status` 直到状态变为 `completed`、`failed` 或 `cancelled`。长任务不要频繁轮询。
4. `deepseek-official` 优先使用插件自己的加密授权，也兼容已有 `DEEPSEEK_API_KEY`；`ipollowork` provider 可复用 iPolloWork API key 和推理地址。不要把凭据写进提示词或项目文件。
5. DSH 始终在插件私有的 Git 隔离副本中运行。它返回的 patch 只是候选修改；先检查报告和 patch，再由当前主代理通过原生工具决定是否应用到原工作区。
6. patch 超过单次返回上限时，按 `patchOffset` 连续读取；不要丢失、重排或局部猜测补丁。
7. 用户取消任务时调用 `cancel`。`runtime_remove` 只删除托管 runtime；卸载插件会删除它的 runtime、任务和隔离数据，不影响主系统。

DSH 子代理不能自动继承当前 OpenCode 会话里的 OAuth 凭据或主代理专属工具。除非 `capabilities` 明确报告对应桥接已可用，否则不要声称它能直接操作 Design Studio、Video Studio 或其他主代理工具。
