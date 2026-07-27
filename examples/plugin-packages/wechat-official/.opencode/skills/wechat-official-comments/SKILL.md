---
name: wechat-official-comments
description: Triage WeChat article comments, prepare safe reply drafts, and only reply, feature, delete, or change comment state with explicit user intent.
disable-model-invocation: false
---

# 公众号评论运营

用于处理已发布文章的评论。

1. 用 `list-comments` 读取指定文章评论，并分为待回复、可精选、垃圾/攻击性、敏感和不确定五类。
2. 对需要回复的评论，先提供简短、礼貌且不虚构事实的回复草案。
3. 只有用户明确要求后才调用 `reply-comment`、`set-comment-featured`、`delete-comment` 或 `set-comment-state`。
4. 删除、关闭评论和自动发送回复属于高影响操作；对敏感、投诉、法律、医疗、财务或人身安全话题默认转人工。

当前版本可以协助准备自动化规则，但不会在没有明确启用规则和云端事件连接器时自动回复新评论。
