---
name: wechat-official-community
description: Inspect WeChat Official Account followers and safely review or update custom menus with explicit before-and-after confirmation.
disable-model-invocation: false
---

# 公众号粉丝与菜单运营

用于理解关注者范围和管理自定义菜单。

1. 使用 `list-followers` 获取有界分页结果，不导出或扩大收集用户数据。
2. 更新菜单前先调用 `get-menu`，展示现有菜单与拟议完整菜单的差异。
3. 只有用户确认完整菜单后才能调用 `update-menu`；菜单链接、事件 key 和跳转目标不得猜测。
4. 不把关注者列表用于群发、营销或外部导出，除非用户明确授权且该能力已在服务中受控实现。
