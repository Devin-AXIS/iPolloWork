# 发行版与服务端地址配置

[English](deployment-configuration.md) | 中文

## Electron 的账号服务

默认地址统一保存在 [`plugins/ipollowork-suite/deployment.json`](../plugins/ipollowork-suite/deployment.json)。该文件只有公开地址，不放密码或 Token：

```json
{"accountOrigin":"https://accounts.example.com"}
```

修改后重新构建或打包。Desktop 组合脚本将选中的地址写入安装包的 `@ipollo/desktop-host/application.yml`，Suite 桌面模式保留传入的地址，不会再强制改回 `cloud.ipollo.net`。只有缺省配置使用 deployment.json 的默认值。其他企业域名与显式填写的旧官方域名也不再自动改写。

发行构建可在 `integrations/desktop/.env.windows`、`.env.macos` 或选中的 `presets/test.env` / `presets/production.env` 中填写：

```dotenv
DSH_DESKTOP_ACCOUNT_ORIGIN=https://accounts.example.com
```

单次构建用 `PACKAGE_ACCOUNT_ORIGIN` 显式覆盖，支持 Windows、macOS 和 Linux/未签名构建：

```powershell
$env:PACKAGE_ACCOUNT_ORIGIN = 'https://accounts.example.com'
npm run package:desktop:win:x64
Remove-Item Env:PACKAGE_ACCOUNT_ORIGIN
```

优先级为：**单次 `PACKAGE_ACCOUNT_ORIGIN` → 选中的平台/发行配置文件 → deployment.json**。普通构建 shell 中残留的 `DSH_DESKTOP_ACCOUNT_ORIGIN` 不覆盖选中的发行文件。`PACKAGE_ACCOUNT_ORIGIN` 也会进入实际打包子进程，随后生成原生应用配置。普通 DSH 的显式 Suite profile 配置继续生效；桌面包中的默认配置以该次发行快照为准。

账号地址必须是无路径、查询、用户名或密码的 HTTPS 来源；本地调试允许 `http://localhost:端口`、`http://127.0.0.1:端口` 和 IPv6 回环地址。改变来源不会把另一个来源的已存登录 Token 发到新服务，需要在新服务登录。历史项目关联的官方域名比较仅用于识别旧记录，不会改写实际请求地址。

## 服务端的数据库与其他地址

服务端使用私密 dotenv 配置文件。默认读取当前工作目录的 `.env`，也可明确选择一份文件：

```powershell
$env:IPOLLO_CONFIG_FILE = 'C:\company-config\ipollowork.env'
npm start
# 同一个选择也适用于 npm run migrate、admin、backup、import:sqlite。
```

`IPOLLO_CONFIG_FILE` 必须在启动进程前设置；不要依靠在尚未读取的文件里设置它来递归选择另一份文件。显式文件不存在会在连接数据库前失败，不回退到其他配置。已有进程/容器环境变量优先于文件；更换配置后需重启服务，不在请求过程中热切换数据库。

| 地址 | 配置入口 | 使用范围 |
| --- | --- | --- |
| 账号、组织和计费数据库 | `DATABASE_URL`、`DATABASE_SCHEMA` | API、管理员、迁移、备份、SQLite 导入 |
| 应用数据数据库 | `APP_DATA_DATABASE_URL`、`APP_DATA_DATABASE_SCHEMA` | 独立应用数据存储；未配置则关闭 |
| 服务对外来源 | `SERVICE_ORIGIN` | 登录、Cookie、邀请、邮件回调及服务链接 |
| 监听地址 | `HOST`、`PORT` | Node HTTP 服务；容器示例固定内部端口 4785 |
| 网站发布来源 | `PUBLICATION_ORIGIN` | 与账号来源隔离的公开页面 |
| 公司邮件桥接 | `MAIL_WEBHOOK_URL`、`MAIL_WEBHOOK_TOKEN` | 服务端邮件投递；不下发浏览器 |
| 私有 OSS | 平台后台「设置 → 阿里云 OSS」；ECS 身份见 `OSS_RAM_ROLE` | 地域、Bucket、存储身份 |
| 云执行网关 | 平台后台「设置 → 云端执行网关」 | 地址、密钥与租约；保存前校验，默认关闭 |
| Stage | 平台后台「设置 → Stage 官方通道与计费」 | 启用、来源与计费规则 |
| 模型接口 | 平台后台「服务中心」 | 供应商连接、业务空间地址、模型及价格 |
| Electron 更新源 | `DSH_DESKTOP_UPDATE_URL`、对应 mandatory-update 配置 | 与账号服务独立，不随账号地址自动切换 |
| 云执行器自身 | Suite `deploy/cloud` 的独立配置 | Sandbox API、OSS endpoint、角色、模板、账号地址 |

支付和语音等供应商 SDK 的正式/沙箱协议端点以及价格文档链接是供应商协议默认值，不是公司数据库或账号部署地址。它们不应被统一替换为账号域名；当前已支持的供应商连接仍由服务中心和支付设置管理。

## Docker 的配置边界

连接 RDS/公司数据库使用 `services/ipollowork/deploy/compose.external.yml`，它将选中的 dotenv 传入应用，`DATABASE_URL` 和 `APP_DATA_DATABASE_URL` 保持配置值。自带 PostgreSQL 的 `compose.yml` 则构造本地容器连接串并依赖本地数据库；不要用它接入外部 RDS 后再误以为 `.env` 的 DATABASE_URL 生效。

外部部署默认读取服务目录的 `.env`。需要选择另一份宿主机文件时，使用绝对路径：

```powershell
$env:IPOLLO_ENV_FILE = 'C:\company-config\ipollowork.env'
docker compose --env-file $env:IPOLLO_ENV_FILE -f deploy/compose.external.yml config --quiet
docker compose --env-file $env:IPOLLO_ENV_FILE -f deploy/compose.external.yml up -d --build
```

Compose 的 `--env-file` 决定变量插值；`IPOLLO_ENV_FILE` 决定传进容器的文件，二者使用同一份文件。原生 `docker run --env-file ...` 也可直接注入全部变量。若使用容器内 `IPOLLO_CONFIG_FILE`，必须额外挂载该路径。数据库密码、AUTH_SECRET、邮件 Token 和供应商 Key 不进入镜像或桌面配置文件。

数据库密码中的保留字符需要 URL 编码；应用数据与账号库不能同时使用同一数据库和同一 Schema。升级必须保留原 AUTH_SECRET 与数据卷。完整运维流程见 [服务端交接手册](../services/ipollowork/HANDOFF.zh.md)。
