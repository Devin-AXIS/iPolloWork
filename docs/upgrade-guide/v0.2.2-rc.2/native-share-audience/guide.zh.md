---
kind: upgrade-guide
description: "iPolloWork 分享改用原生弹窗，账号服务数据库升级到版本七。"
---

# iPolloWork 原生分享

[English](guide.md) | 中文

## 变更

iPolloWork 的接收对象选择现位于 DSH 原生分享弹窗，套件独立的分享弹窗已移除。账号服务按每次分享保存链接、团队、部门或成员权限，新分享不再必须绑定项目。已有分享保留项目权限。公开链接允许匿名访问，且只出现在分享者自己的列表中。

## 迁移

1. 在 `services/ipollowork` 中运行 `npm run backup` 备份账号服务。下次启动将数据库迁移到版本七；旧服务程序无法打开升级后的数据库。
2. 从同一检出一起更新账号服务、`@ipollo/dsh-suite` 和 `@deepseek-ai/dsh-experimental-liveshare`。原生插件提供可选的 `liveshare.share.audience` 插槽。配置项和 Session 文件无需修改。
3. 打开会话的原生分享入口，确认接收对象包含链接、团队、部门和成员，且保留原生会话权限及分叉控制。团队接收者需要登录；链接无需登录即可打开。移除套件后，接收对象选择随之移除，原生分享仍可用。
