# 服务端配置文件

服务、迁移、管理员、备份和 SQLite 导入使用同一加载器：默认读取 `.env`，也可在启动进程前设置 `IPOLLO_CONFIG_FILE` 指定私密 dotenv。进程/容器环境变量优先。显式文件不存在时，在连接数据库前失败。更改后重启服务。

`DATABASE_URL` / `DATABASE_SCHEMA` 配置账号库；`APP_DATA_DATABASE_URL` / `APP_DATA_DATABASE_SCHEMA` 配置可选的独立应用数据库，不能同时指向同一数据库和同一 Schema。URL 密码中的保留字符需要编码。连接串不下发浏览器。

Schema 默认 `public`。自定义 Schema 要先由数据库管理员创建，并授予运行账号所有权/访问权限，再执行应用迁移；改配置不会自动创建或复制客户数据。

其他部署地址包括 `SERVICE_ORIGIN`、`HOST`、`PORT`、`PUBLICATION_ORIGIN`、`MAIL_WEBHOOK_URL`。平台管理员通过设置页管理 OSS 地域/Bucket、云执行网关与 Stage；供应商及业务空间地址通过服务中心管理。此类设置加密保存在数据库中，与桌面打包配置分开。

接外部 PostgreSQL 使用 `deploy/compose.external.yml`，默认读取服务目录 `.env`。更换宿主机文件时，将**宿主机**变量 `IPOLLO_ENV_FILE` 设为绝对路径，并把同一个文件传给 Compose `--env-file`。自带数据库的 Compose 则构造本地容器数据库连接串。若使用容器内的 IPOLLO_CONFIG_FILE，需要额外挂载相应文件。

新增云端网关表单默认关闭；保存时检查 HTTPS/回环来源、租约范围，启用前必须有至少 32 字符的已保存密钥。密钥留空或保留掩码不会清除已保存值。网页表单不会改变账号来源或数据库连接。

启动、备份、恢复和验收见[交接手册](../HANDOFF.zh.md)。
