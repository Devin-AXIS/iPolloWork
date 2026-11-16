---
kind: upgrade-guide
description: "省略 accountOrigin 时，iPolloWork 套件使用本机账号服务。"
---

# iPolloWork 账号服务地址

[English](guide.md) | 中文

## 变更

iPolloWork 套件的默认 `accountOrigin` 从 `https://i.ipollo.ai` 改为 `http://localhost:4785`。未在 profile 中显式覆盖地址的安装会连接另行启动的本机账号服务；安装套件不会自动启动该服务。显式配置的地址保持不变，已有账号令牌不会转发到其他来源，此变更也不会迁移账号或余额。

## 迁移

1. 本机使用时，以 `SERVICE_ORIGIN=http://localhost:4785` 和 `PORT=4785` 启动[账号服务](../../../../services/ipollowork/README.zh.md)。
2. 使用线上服务时，在 profile 的 `cordis.patch.yml` 中，将 `ipollowork-suite` 行的 `config.accountOrigin` 设置为该服务的 HTTPS 来源。只有仍打算使用旧部署时，才显式填写原地址。
3. 重新加载 profile 并刷新浏览器。打开 iPolloWork 账号设置，确认显示的服务地址。在该服务上注册或登录账号；其他模型凭据保持不变。
