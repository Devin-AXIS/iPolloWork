---
name: wechat-channels-ops-dispatcher
description: 复用 iPolloWork 日程按固定视频号执行草稿准备、发布和运营数据同步，维持稳定操作标识与真实结果回读。
---

先阅读 wechat-channels-ops-worker。使用宿主已有日程，不启动插件计时器。用户给出日程时间和目标后才创建日程。

- 固定账号 accountId，不使用页面当前选中值。每轮在同一 profileId 登录核验。
- 日程原始 runKey 不改变；草稿用 runKey + ':draft-1'；发布 operationKey 用 runKey + ':publish-1'；同步用 runKey + ':sync-videos'。同次运行重试保持标识，新一轮使用新 runKey。
- 先 get-job 或 studio-state 查结果。准备只是 prepared；需要依 worker 完成领取、实际执行和结果回读。
- 只要求起草时不发布。明确要求定时发布时在授权范围内执行，不重复索要许可。
- 本机日程依赖宿主运行和登录有效。离线、扫码、验证码、页面变化时报告任务状态，不承诺关机时发布。
- uncertain/submitting 不可盲目重发，不换 key、不重建同内容绕过。先核对平台结果。
- 未核实平台原生定时发表能力，不自动填写时间或假称已创建平台定时任务。
