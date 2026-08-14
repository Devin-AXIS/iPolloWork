---
name: deepseek-harness
description: Delegate code review, development, and research tasks to DeepSeek Harness.
disable-model-invocation: false
---

# DeepSeek Harness 协作智能体

使用 `ipollowork_extension_call` 调用扩展 `deepseek-harness`。Windows 和 macOS 版软件已经内置官方 DSH 运行环境，不要自行下载或安装系统级 DSH。

默认只向用户说明 DeepSeek Harness 正在协作完成任务，不主动解释隔离副本、主代理、OpenCode 桥接等实现细节；只有用户明确询问安全或技术实现时才说明。

1. 委派前先调用 `capabilities`。只有 `available: true` 且 `serviceStatus: "ready"` 时才调用 `start`。
2. 如果 `serviceStatus` 是 `unavailable` 或 `unresponsive`，明确告诉用户“DSH 服务状态异常”并附上 `message`，不要假装任务已经开始。
3. 代码审查、架构分析和第二意见使用 `review`；需要 DSH 产出修改时使用 `code`；其他任务使用 `standard`。
4. 调用 `start` 后保存 `jobId`，再调用 `status` 直到状态变为 `completed`、`failed` 或 `cancelled`。长任务不要频繁轮询。
5. 如果任务失败，必须向用户说明返回的错误；错误包含 `DSH_SERVICE_UNRESPONSIVE` 或 `DSH_SERVICE_UNAVAILABLE` 时，提示“DSH 服务状态异常”。
6. `deepseek-official` 使用插件加密授权或 `DEEPSEEK_API_KEY`；`ipollowork` provider 可复用 iPolloWork API key 和推理地址。不要把凭据写进提示词或项目文件。
7. DSH 始终在插件私有的 Git 隔离副本中运行。它返回的 patch 只是候选修改；检查报告和 patch 后，再由当前主代理决定是否应用到原工作区。
8. patch 超过单次返回上限时，按 `patchOffset` 连续读取；用户取消任务时调用 `cancel`。
9. 仅当 `capabilities.runtimeManagement.supported` 为 `true` 时使用 `runtime_install`、`runtime_update` 或 `runtime_remove`；Windows 和 macOS bundled runtime 不需要这些操作。

DSH 子代理不能自动继承当前 OpenCode 会话里的 OAuth 凭据或主代理专属工具。除非 `capabilities` 明确报告对应桥接已可用，否则不要声称它能直接操作 Design Studio、Video Studio 或其他主代理工具。
