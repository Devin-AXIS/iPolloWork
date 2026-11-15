---
kind: upgrade-guide
description: iPolloWork 服务数据库版本九不能由旧版服务读取。
---
# iPolloWork 企业数据分析

[English](guide.md) | 中文

## 变更

独立 iPolloWork 账户服务将 PostgreSQL 业务数据库迁移至版本九，旧版服务会拒绝读取。控制台新增企业服务用量和关联项目的元数据活动统计，未标记归属的历史服务调用不计入。

## 迁移

1. 按照[服务部署说明](../../../../services/ipollowork/docs/storage.md)备份 PostgreSQL 和服务认证密钥。
2. 先部署更新后的账户服务，再更新 iPolloWork 套件。服务启动在事务内迁移；在配置的 schema 中验证 `SELECT MAX(version) FROM service_schema` 返回 `9`。
3. 更新套件并重启 DSH 配置。企业管理员可打开“控制台 → 数据分析”。在套件的 `cordis.patch.yml` 配置中设置 `enterpriseUsageReporting: false` 可关闭项目活动上报；服务网关用量仍会记录。
4. 回退时同时恢复数据库备份与旧版服务，不要让旧版服务读取版本九。
