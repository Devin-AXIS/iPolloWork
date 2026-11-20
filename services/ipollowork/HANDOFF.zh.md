# iPolloWork 服务端开发与部署交接

[English](HANDOFF.md) | 中文

本目录是可独立构建的账号、组织、项目协作、模型网关及管理页面服务。服务包版本见 `package.json`，业务数据库当前版本为 19。交付包的 `VERSION.json` 和 `SHA256SUMS.txt` 记录实际源码快照和校验值；存在未提交修改时会明确标记。不要把旧的 2026-11-19 交付包与当前源码混用。

## 范围与入口

| 目录 | 维护内容 |
| --- | --- |
| `web/` | React 管理页面、登录、注册、邮件找回、组织与项目管理 |
| `src/app.ts`、`src/http-server.ts` | HTTP 路由组装、鉴权、就绪检查、请求排空与 WebSocket |
| `src/auth.ts` | Better Auth 身份、会话与邮件投递 |
| `src/database.ts`、`src/migration-pg-*.sql` | PostgreSQL 事务与顺序迁移 |
| `src/execution.ts`、`src/payments.ts` | 模型调用、用量结算与支付确认 |
| `src/storage*.ts`、`src/oss-client.ts` | 服务拥有的文件、配额、OSS 与保留规则 |
| `src/cli/` | 编译进生产镜像的管理员、迁移、备份、SQLite 导入命令 |
| `deploy/` | 自带 PostgreSQL、外部 RDS、Caddy 与既有环境升级参考 |
| `tests/` | 真实 PostgreSQL 独立 Schema 测试；不允许使用客户数据库 |

镜像包含 API 和已构建页面。PostgreSQL、OSS、邮件、支付和模型供应商是外部依赖。云端项目执行器是另一项可选服务，不会因启动此镜像自动出现。原生会话分享要求来源电脑在线，本版服务只部署一个实例；不支持直接增加多个中继副本。

## 新环境部署

要求 Docker Engine、Compose v2，以及能访问依赖仓库的构建环境。源码方式要求 Node >=24.15，PostgreSQL >=15；运行完整测试另需同版本或更新的 `pg_dump`/`pg_restore`。默认运维镜像提供 PostgreSQL 18 工具。恢复目标建议使用相同大版本，禁止直接升级已有数据库镜像标签。

在**新环境**复制 `.env.example` 为 `.env`，至少填写：

| 配置 | 说明 |
| --- | --- |
| `SERVICE_ORIGIN` | 对外账号服务的 HTTPS 来源，不带路径；本机测试可用 `http://localhost:4785` |
| `DATABASE_URL` | 独立 PostgreSQL/RDS 连接串，密码中的保留字符必须 URL 编码；容器里不能用宿主机的 `127.0.0.1` |
| `AUTH_SECRET` | 新环境生成至少 32 字符的随机密钥；已有环境必须沿用原密钥 |
| `PUBLICATION_ORIGIN` | 可选网站发布来源，必须与账号域名隔离 |
| `APP_DATA_DATABASE_URL` | 可选应用数据数据库；不填则该功能关闭 |

`.env` 只留在部署环境，设为仅部署账号可读。运行环境使用的 `AUTH_SECRET` 优先于 `/data/auth.secret`；为空时会在持久卷中生成并保留密钥。**升级不能随意新生成密钥**，否则已加密的供应商设置无法解密。

外部 RDS（独立配置，无本地 PostgreSQL 依赖）：

```sh
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml build work
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml run --rm --no-deps work npm run migrate
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml run --rm --no-deps -e ADMIN_PASSWORD work npm run admin -- admin@example.com 管理员
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml up -d work
```

执行管理员命令前，在当前终端私密设置 `ADMIN_PASSWORD`；不要写入命令行参数、脚本、Git 或工单。命令也可使用公司 Secret 注入方式。新密码至少 10 字符，执行后清除终端环境变量。同一管理员重复执行不会改密码。若邮箱已注册为普通用户，增加 `--promote-existing` 明确提升权限并保留其原密码、账号和数据；这需要受信任的服务器运维权限。

自带 PostgreSQL：设置 URL-safe 的 `POSTGRES_PASSWORD`，使用原有 `compose.yml`；它会生成容器内数据库连接串，不使用 `.env` 中的 `DATABASE_URL`。首次执行 `docker compose up -d --build`，再用 `docker compose exec -e ADMIN_PASSWORD work npm run admin -- admin@example.com 管理员`。需要 HTTPS 入口时叠加 `deploy/compose.production.yml` 并填写两个域名，详见 [阿里云部署](deploy/README.zh.md)。现有服务器继续沿用原 Compose 项目名和卷，禁止 `down -v`。

`deploy/compose.beta-2c4g.yml` 是生产配置的资源限制覆盖层，必须与 `compose.yml`、`deploy/compose.production.yml` 三个文件一起使用；不能只叠加到基础文件上。

## 镜像构建、导出与离线加载

```sh
docker build --target runtime -t ipollowork-services:handoff .
docker build --target operations -t ipollowork-services-ops:handoff .
docker save -o ipollowork-services-images.tar ipollowork-services:handoff ipollowork-services-ops:handoff
# 接收方
docker load -i ipollowork-services-images.tar
```

`runtime` 不包含 `tsx`，但管理员、迁移和导入命令均为编译后的 JS，可直接执行。`operations` 额外包含 `pg_dump`/`pg_restore`，用于备份。默认 `docker build .` 仍生成应用镜像。`npm run package:handoff` 生成独立源码、Docker 配置、说明、锁文件和校验值，不打包 `.env`、数据、依赖、构建缓存或桌面运行时；**源码归档不是已构建的镜像**。

运维工具应与数据库大版本匹配。例如 PostgreSQL 17 使用 `docker build --target operations --build-arg POSTGRES_TOOLS_IMAGE=postgres:17-bookworm -t ipollowork-services-ops:handoff .`。工具不能比数据库更旧，不应假设较新版工具生成的备份一定能恢复到旧版数据库。`deploy/update-existing.sh` 是既有 cloud.ipollo.net 环境的历史专用脚本，不是新环境通用入口。

## 页面与功能配置

用平台管理员登录服务来源。普通用户、组织管理员和平台管理员权限不同。

- 平台「设置 → 阿里云 OSS」填写地域、Bucket；ECS 角色通过 `OSS_RAM_ROLE` 配置，也可由管理员保存 AccessKey。Bucket 保持私有，角色只授予该服务需要的对象范围。公网来源默认要求 OSS。
- 「服务中心」配置模型供应商 Key，确认地域、模型、真实价格及启用状态。未配置、停用或未定价的服务不能调用；不会自动切换付费渠道。
- 试用可不配邮件，注册和登录仍能用；找回密码会清楚提示未配置。生产接入 `MAIL_WEBHOOK_URL` 和 `MAIL_WEBHOOK_TOKEN`：服务发出带 `Authorization: Bearer <token>` 的 JSON POST，正文为 `{to, template, url}`，template 为 `reset-password` 或 `verify-email`。公司接口负责转换为自己的发信格式，2xx 表示接收成功，超时 15 秒；此邮件接口没有持久重试队列。不要记录正文中的重置链接。
- 支付需要配置供应商凭据、验签与正式回调地址并完成真实环境验收；客户端支付成功提示不作为结算依据。未配置支付时渠道不可用。
- `/api/health` 检查进程存活；`/api/ready` 同时检查账号和已配置的应用数据数据库，部署探针使用后者。未知错误只记录请求 ID、类型和安全错误码，`X-Request-Id` 用于关联排查。

## 备份与恢复

数据库、认证密钥、DATA_DIR、私有 OSS 对象和部署配置必须一起纳入备份策略。建议数据库使用 RDS 自动备份；DATA_DIR 每天至少一次、保留 30 天并保存到独立加密私有存储；密钥另存公司密码库，轮换前后各保留对应版本。每次迁移前额外备份，每月至少一次恢复演练。

本地配套备份必须先停止全部应用写入，保持数据库运行。以下以外部 RDS 的 Compose 为例：

```sh
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml stop work
# 一次性运维容器，复用相同 .env 和数据卷；备份输出位于临时容器的 /tmp，不在 DATA_DIR 内。
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml run --name ipw-backup-once --no-deps \
  --entrypoint node work dist/server/cli/backup.js /tmp/backup
```

上例使用应用镜像时需提供 PostgreSQL 客户端；推荐先构建 `operations`，在该命令前临时设置 `WORK_IMAGE=ipollowork-services-ops:handoff`（PowerShell 用 `$env:WORK_IMAGE=...`），备份命令结束即清除，再恢复应用镜像。随后：

```sh
docker cp ipw-backup-once:/tmp/backup ./backup-new-directory
docker rm ipw-backup-once
docker compose -p ipollowork --env-file .env -f deploy/compose.external.yml start work
```

目的目录须全新且位于 DATA_DIR 外。新格式为 `manifest.json`、`work.dump`、可选 `app-data.dump` 和 `data/`，与旧脚本平铺格式不同。只备份配置的服务 Schema，不复制其他业务 Schema。`data/auth.secret` 始终是实际生效的密钥；OSS 对象不包含在其中。数据库或文件复制失败不会生成最终完成目录。备份输出敏感，应立即转移到受控加密存储。

恢复必须在**隔离的新数据库和新数据卷**进行：

1. 校验备份文件和 manifest，使用 `pg_restore --list work.dump` 检查可读性。准备与 manifest 相同的 Schema 名称，恢复前目标数据库为空；不要先启动服务自动建表。
2. 将连接参数通过 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` 私密注入，执行 `pg_restore --exit-on-error --no-owner --no-acl --dbname=<new-database> work.dump`。如有 `app-data.dump`，恢复到对应的新应用数据数据库。
3. 将备份的 `data/` 内容恢复到新 `/data`，保证 UID 1000 可读写。将 `AUTH_SECRET` 设为备份的 `data/auth.secret` 内容，或清空该变量让服务读取恢复的文件；不能继续使用无关的新密钥。
4. 恢复对应 OSS 对象和部署参数，先运行迁移命令，再启动服务。验证旧账号登录、余额、组织、加密设置可读和私有文件下载。
5. 验收后才切换入口；保留旧环境用于回退。代码回退必须兼容已安装的 Schema，不能用旧镜像强行打开更新的数据库。

## 开发与交付验收

```sh
npm ci
npm run build
# TEST_DATABASE_URL 必须指向专用的空测试数据库；测试会创建和删除其独立 Schema。
TEST_DATABASE_URL=postgresql://test-user@127.0.0.1:5432/ipollowork_test npm run check
npm run smoke -- http://localhost:4785
npm run package:handoff
```

新建迁移必须递增业务版本并带升级测试；不得修改已经交付的历史迁移。操作命令不启动 HTTP 或后台清理任务。Web 构建与 API 在同一镜像，修改页面需重新构建服务镜像，不涉及桌面客户端重新打包。

验收至少覆盖：管理员初始化和重复执行、普通用户无法访问后台、登录与注销、组织成员权限、OSS 私有上传下载、模型调用计费与重复请求、双数据库备份恢复、代理下 WebSocket、无邮件/无模型凭据的明确失败、明暗主题和手机宽度。

本次本地核查环境没有可用的 Docker Engine；源码构建、Compose 配置校验和测试结果不等于 Linux 容器实跑通过。正式交付前必须在目标 Linux 上运行上述两个镜像构建、探针、持久卷重启与恢复验收，并保存镜像 digest。邮件、OSS、模型、支付的真实凭据由接收方提供并验收，不能以本地假数据测试代替。

## 选择配置文件

在启动服务、迁移、管理员、备份或 SQLite 导入前，设置 `IPOLLO_CONFIG_FILE` 选择私密 dotenv；已有进程变量优先，显式文件缺失会提前失败。两个数据库的地址/Schema、SERVICE_ORIGIN、发布来源和邮件桥均可配置。外部 Compose 的 IPOLLO_ENV_FILE 选择宿主机文件，需与 --env-file 一致；自带数据库的 Compose 则有意构造本地连接串，详见[配置说明](docs/configuration.zh.md)。管理页面已补齐云网关设置、无组织个人项目创建；未明确改动批量启停选项时，连接编辑会保留各模型的混合启停状态。
