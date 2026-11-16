---
kind: upgrade-guide
description: "iPolloWork 套件默认连接生产账号服务，生成的输出文件默认留在本地。"
---

# iPolloWork 账号与输出默认设置

[English](guide.md) | 中文

## 变更

iPolloWork 套件的默认地址由 `http://localhost:4785` 改为 `https://work.ipollo.net`。保存的登录凭据仍绑定原有服务。原生 `present` 事件不再自动上传输出文件，除非部署明确启用 `automaticOutputArchive`。

## 迁移

1. 使用本机账号服务时，在 profile 补丁的 `ipollowork-suite` 条目中保留 `accountOrigin: http://localhost:4785`。生产安装可省略该设置，或使用 `https://work.ipollo.net`。
2. 登录所选服务。运维迁移已有数据库时，先保留身份验证密钥和账号数据，再切换客户端连接；不要将登录凭据用于无关服务。
3. 在项目文件页上传选定的输出，已上传的历史版本仍可访问。仍需自动上传展示文件的部署可设置 `automaticOutputArchive: true`，项目的上传权限仍然生效。
4. 生成输出，确认文件在明确上传前留在本地。在账号页核对服务地址及身份。
5. 使用 Design 分享网页时，部署账号服务的发布接口，并将 `PUBLICATION_ORIGIN` 设置为独立 HTTPS 来源。生产代理还需要 `PUBLICATION_DOMAIN`，详见[部署配置](../../../../services/ipollowork/deploy/README.zh.md)。同时升级 Design 插件和套件，让编辑器使用统一发布服务。
