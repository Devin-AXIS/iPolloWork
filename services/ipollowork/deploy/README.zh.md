# 阿里云部署

[English](README.md) | 中文

在独立 ECS 实例上部署账号、组织和项目服务。原生 DSH 会话和本地预览保留在各自的电脑上。不要把单个 DSH 用户的 Web 配置作为多人服务器开放。

使用 Ubuntu 24.04、Docker Engine 和 Compose v2。在 `services/ipollowork` 中创建私有 `.env`，填写以下配置，并生成仅含 URL 安全字符的随机数据库密码。迁移时保留原有身份验证密钥、设置和数据库。

~~~dotenv
SERVICE_DOMAIN=cloud.ipollo.net
SERVICE_ORIGIN=https://cloud.ipollo.net
PUBLICATION_DOMAIN=publish.ipollo.net
PUBLICATION_ORIGIN=https://publish.ipollo.net
POSTGRES_PASSWORD=replace-with-a-random-secret
OSS_RAM_ROLE=ipollowork-storage
OSS_INTERNAL=true
~~~

使用 `oss-role-trust.json` 和 `oss-role-policy.json` 创建并绑定 ECS 角色。策略仅允许读写和删除指定发布 Bucket 内的对象；其他部署需替换资源名称。在服务的统一 OSS 设置中填写地域和 Bucket。官方 SDK 通过 IMDSv2 获取并续期临时凭证，无需长期 AccessKey。在 ECS 之外使用已保存的密钥时，将 `OSS_RAM_ROLE` 留空。

对启用或暂停版本控制的 Bucket，启用永久删除前需要为对应 Bucket 配置 `oss:ListObjectVersions`，并为对象配置 `oss:DeleteObjectVersion`。使用包含历史版本的临时对象验证。权限或保留策略阻止清理时，任务保持在清理中。

~~~sh
chmod 600 .env
docker compose -p ipollowork -f compose.yml -f deploy/compose.production.yml up -d --build
curl --fail http://127.0.0.1:4785/api/health
~~~

本地健康检查通过后，将域名指向 ECS 公网 IP。代理开放 HTTP 和 HTTPS 并管理证书。服务端口仅绑定回环地址，PostgreSQL 不发布端口。`PROXY_IP` 和 `SERVICE_SUBNET` 可覆盖 Compose 私有网络；IP 必须位于该网段内。代理覆盖客户端 IP 请求头，不启用请求路径日志。原生分享 WebSocket 使用同一域名。

将发布域名指向同一个 IP。它必须与账号服务来源不同：发布域名只提供已发布的文件，账号接口仍位于服务域名。草稿文件不能被浏览。完整发布保留资源相对路径，支持 HTML、CSS、JavaScript 和媒体文件的分段读取；OSS 中的对象仍保持私有。

修改客户端 `accountOrigin` 前，验证 HTTPS 健康检查、原有账号登录、组织访问和授权 OSS 上传下载。保留旧 DNS 值以便回退。迁移和备份参见[存储](../docs/storage.md)。数据库备份使用独立目的地；发布 Bucket 只保存明确发布的内容。

替换容器前，备份 PostgreSQL、身份验证密钥和设置。重复部署时沿用同一 Compose 项目名及所有数据和证书卷。已有部署不得执行 `down -v`。只有兼容已安装数据库版本的应用代码才可回退。

百人内测的配置与已验证边界见[容量说明](../docs/capacity.zh.md)。可选的 `-f deploy/compose.beta-2c4g.yml` 增加同机内存预算；应用到已有部署会重启 PostgreSQL，应在备份后安排维护窗口并先演练。`/api/health` 检查进程存活，`/api/ready` 检查数据库可用性。应用停机前会排空请求，Compose 留有 40 秒宽限期。仍需站外可用性监测和异机备份。

`deploy/update-existing.sh` 为现有 Compose 安装暂存精确源码提交，切换前备份 PostgreSQL、认证密钥及配置。目标数据库版本从候选镜像导出的 `SERVICE_SCHEMA_VERSION` 读取，并检查对应 SQL 已打包；构建也按同一版本复制迁移文件。向前迁移后禁止自动回退仅支持旧数据库版本的代码。Docker Hub 不可达时，运维可通过 `ROLLOUT_NODE_IMAGE` 选用服务器上已信任且带有 Node 24.22.3 的现有服务镜像；构建和运行阶段仍重新安装本次锁定依赖并替换编译产物，不复用旧服务代码。

切换时仅停止应用写入，备份账号数据库、单独配置的应用数据数据库、`/data`、认证密钥及所有生效的 Compose 配置层。两份数据库归档均须通过 `pg_restore -l`。备份失败会重新启动原应用；PostgreSQL、代理及数据卷保留。这些私有备份仅留在服务器，不打印内容，也不附加到 Release。
