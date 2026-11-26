# iPollo Onto

从多引擎分支 `ipollo-onto` 0.1.7 移植的 DSH 原生插件。通过 iPolloWork 市场或原生插件管理器安装 .tgz，选择已有工作区后打开工作台。凭据由原生 Host 凭据提供方保存，保留旧版本地业务数据。停用或卸载释放工具、Skill、路由和子服务，保留用户文件。

运行 `npm run build`、`npm run check`、`npm run pack:check`。各能力的验收与限制见仓库迁移清单。

Onto 桌面版默认使用 SQLite，独立项目数据库使用 PostgreSQL。已有瀚高项目仍会列出，并显示迁移提示。恢复使用前，请备份数据库并将项目数据迁移到 PostgreSQL。
