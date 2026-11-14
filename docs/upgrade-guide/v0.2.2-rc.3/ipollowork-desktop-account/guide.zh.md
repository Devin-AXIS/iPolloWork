---
kind: upgrade-guide
description: iPolloWork 套件 0.1.10 需要更新后的 DSH Connection 与 YAML API。
---

# iPolloWork 桌面账户

[English](guide.md) | 中文

## 变更

iPolloWork 专用桌面版内置套件 0.1.10，需要 DSH 0.2.2-rc.3 或 0.2.2 版本线中更高的版本。套件使用当前的 Connection 请求准入和 YAML 解析 API，旧版 DSH 不能加载此套件版本。原生欢迎页保留既有流程，并提供 iPolloWork 邮箱密码登录和注册。

账号渠道显示后台渠道名称。未配置个人 API Key 时，桌面版会选择可用的账号渠道。个人 API Key 提供方仍可选择；账号积分不足与密钥错误分别报告。

套件同时更新 IM 的上下文访问，并提供补齐编辑器鉴权依赖的 Design/Video `1.0.0-beta.19.ipollo.1`。既有 Studio 文档和渠道凭据格式保持不变。

## 迁移

1. 安装套件 0.1.10 时使用内置的 iPolloWork 桌面运行时，或先将已有 DSH 运行时升级到兼容版本。
2. 打开桌面应用并选择“登录”，然后登录或注册账号。注册需要昵称、邮箱和至少 10 位密码。
3. 在 iPolloWork 市场中，将已有 Design 或 Video 更新到内置的 `1.0.0-beta.19.ipollo.1` 版本。
4. 确认页面中出现 iPolloWork 账户和总助手入口。专用桌面版固定启用套件，已有会话与账户记录不需要格式转换。
