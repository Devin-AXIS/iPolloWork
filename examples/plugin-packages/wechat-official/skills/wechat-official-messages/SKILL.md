---
name: wechat-official-messages
description: Design safe WeChat follower-message automation and send customer-service text only when the user provides an explicit target and confirmation.
disable-model-invocation: false
---

# 公众号消息自动化

用于设计私信、欢迎语和客服回复策略。

1. 先明确触发条件、受众、回复模板、人工转接条件和停止条件。
2. 当前本地插件可在平台允许的客服窗口内，通过 `send-customer-text` 向明确的 OpenID 发送经用户确认的文本。
3. 实时收取微信消息、关键词自动回复和 AI 自动化依赖公网回调与云端事件连接器；在该连接器启用前，只生成规则草案，不声称已自动运行。
4. 不向用户索取、展示或写入 AppSecret、access token、OpenID 全量名单或敏感个人信息。
