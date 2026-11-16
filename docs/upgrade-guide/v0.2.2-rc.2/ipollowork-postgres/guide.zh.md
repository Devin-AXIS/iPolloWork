---
kind: upgrade-guide
description: iPolloWork 账号服务改用 PostgreSQL，并按所有者管理输出保留期限。
---

# iPolloWork PostgreSQL 与输出存储

[English](guide.md) | 中文

## 变更

可选的 iPolloWork 账号服务使用 PostgreSQL 替代 SQLite 运行时，必须设置 `DATABASE_URL`。DSH 套件为已关联项目保存原生呈现的输出，不自动上传输入文件。个人未发布输出七天后到期，已发布输出及组织输出持续保留；这些规则不删除本地工作区文件。已导入云端文件保留原生命周期。

## 迁移

1. 停止旧账号服务，备份数据库、私有文件及认证密钥。
2. 创建空 PostgreSQL 数据库，设置 `DATABASE_URL`，保持 `DATA_DIR`、密钥和服务主机名。在 `services/ipollowork` 中运行 `npm run import:sqlite -- /absolute/path/work.sqlite`，原 SQLite 文件不变。详见[存储部署](../../../../services/ipollowork/docs/storage.md)。
3. 公网部署配置私有 OSS，检查 `.env.example` 中的所有者配额与保留规则，在管理界面调整独立容量。
4. 构建并重启服务，通过原生插件管理器安装新版套件并重启配置。验证 `/api/health`、原账号访问及关联项目输出下载。需要时可在项目文件设置中关闭输出归档。

不改变原生 DSH Session 格式或默认智能体预设。停用套件会移除其归档和项目记忆扩展。
