---
name: wechat-official-publishing
description: Manage WeChat Official Account drafts and publication with explicit preview, confirmation, and post-publication status checks.
disable-model-invocation: false
---

# 公众号草稿与发布

用于管理公众号草稿和正式发布。

1. 先用 `get-draft` 或 `list-drafts` 确认当前草稿状态；更新前必须读取目标草稿。
2. 使用 `create-draft` 或 `update-draft` 写入内容。草稿箱是可审阅状态，不代表已发布。
3. 调用 `submit-publish` 前，展示文章标题、草稿 ID 和将要公开发布的影响，并取得用户明确确认。
4. 发布后调用 `get-publish-status`；只报告接口返回的状态和链接，不猜测审核或传播结果。

账号没有发布权限时，保留草稿并说明限制；不得改用群发或其他未声明接口规避限制。
