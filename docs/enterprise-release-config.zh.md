# iPolloWork 企业发行配置手册

在仓库根目录编辑 `ipollowork.release.json`。文件最少只需一项，其他字段省略时沿用现有发行预设或软件默认值。需要配置哪项，就在对应的对象里加上那项。也可以从[完整示例](../ipollowork.release.example.json)复制需要的部分。

```json
{
  "version": 1
}
```

`version` 是配置文件格式版本，目前填数字 `1`。安装包的软件版本仍由原有打包流程决定。文件使用标准 JSON，属性名和字符串用双引号，布尔值用 `true` 或 `false`，数字直接写。省略不需要的字段即可，空字符串、`null`、注释和尾逗号都不能代替省略。

相对路径以配置文件所在目录为起点。Windows 可以写 `C:/company/branding/app.ico`。图标、插件归档、补丁和 CA 证书的路径都应指向实际存在的文件。

可以把配置放在仓库之外，也可以为测试和生产各保存一份。打包和部署时通过环境变量选择本次使用的文件。

```powershell
$env:IPOLLOWORK_RELEASE_CONFIG = 'C:/company/ipollowork.release.json'
```

## 桌面端 `desktop`

| 字段 | 控制什么 | 省略时 | 填写示例 |
| --- | --- | --- | --- |
| `name` | 系统识别的应用名称，如应用列表、快捷方式和关于窗口 | `iPollo` | `"星河工作台"` |
| `appId` | 桌面安装身份 | 使用对应发行预设的 `DSH_DESKTOP_APP_ID` | `"com.example.work"` |
| `dataDirectoryName` | 系统应用数据目录下的文件夹。默认 Harness 配置、登录状态和已安装插件在该目录的 `harness` 中 | `iPolloWork Desktop` | `"Example Work Desktop"` |
| `protocol` | 从浏览器等外部入口打开应用所使用的协议 | `dsh` | `"example-work"`，对应 `example-work://open` |
| `installerName` | 打包后的安装包文件名 | 现有 `iPollo` 命名规则和构建模式后缀 | `"ExampleWork-${version}-${os}-${arch}.${ext}"` |
| `accountOrigin` | 此桌面安装包要连接的企业账号服务 | 优先继承 `server.origin`，然后依次使用原发行预设和 Suite 默认地址 `https://cloud.ipollo.net` | `"https://accounts.example.com"` |
| `update` | 普通自动更新的安装包目录和渠道 | 沿用现有发行预设 | 见下节 |
| `icons` | 各平台应用图标和 Windows 托盘图标 | 对应平台的原图标 | 见下表 |
| `plugins` | 打包时追加预装的 DSH 插件 | 沿用现有预装组合。`[]` 表示没有额外预装项 | 见下节 |

应用 ID 使用反向域名格式。公司版要和官方版并装时，为 `name`、`appId`、`dataDirectoryName` 和 `protocol` 分别选用独立值，后续升级沿用同一组。修改数据目录名会读到另一个目录，如有旧数据需要迁移，应先按原安装版本备份。

应用名称和安装包文件名可以分别修改。文件名模板支持 `${version}`、`${os}`、`${arch}`、`${ext}`，并且要以 `.${ext}` 结尾。用上表的模板打 Windows x64 发行包，软件版本为 `1.0.19` 时，文件名示例是 `ExampleWork-1.0.19-win-x64.exe`。未签名构建会自动加上 `-unsigned`。

桌面账号地址按以下顺序选择。生产填 HTTPS 源地址，如 `https://accounts.example.com`，可以带端口，但不能带 API 路径、查询参数或账号密码。本机调试可以使用 `http://localhost:4785` 等回环地址。指定另一个账号服务后，需要在新的服务上登录。

1. 单次构建环境变量 `PACKAGE_ACCOUNT_ORIGIN`。
2. `desktop.accountOrigin`。
3. `server.origin`。
4. 选中的 Windows、macOS 或发行预设里的 `DSH_DESKTOP_ACCOUNT_ORIGIN`。
5. Suite 的默认账号地址 `https://cloud.ipollo.net`。

### 自动更新 `desktop.update`

| 字段 | 控制什么 | 省略时 |
| --- | --- | --- |
| `feedUrl` | 更新清单和对应安装包所在的 HTTPS 目录。可用 `${target}` 为各平台和架构展开路径 | 使用原发行预设的更新源 |
| `channel` | 更新渠道，填 `stable` 或 `nightly` | 使用原渠道，缺省为 `nightly` |

```json
{
  "version": 1,
  "desktop": {
    "update": {
      "feedUrl": "https://updates.example.com/ipollowork/${target}/",
      "channel": "stable"
    }
  }
}
```

`${target}` 会展开为 `win-x64`、`mac-arm64` 或 `mac-x64`。Windows 把生成的 `stable.yml`、安装包和对应的块映射放进自己的目录。macOS 把 `stable-mac.yml`、更新 ZIP 和块映射按架构放入各自目录。使用 `nightly` 时，清单文件名相应变为 `nightly.yml` 和 `nightly-mac.yml`。保留打包生成的清单文件名和清单引用的产物文件名。更新源填目录地址，前缀可以带路径，URL 里不要放凭证、查询参数或单个 `.exe`、`.dmg` 链接。

更新配置会写入新安装包，需要重新打包才能切换已安装客户端的更新源。Windows 和签名 macOS 发行包支持该更新源，Linux AppImage 继续使用手动更新。企业自托管目录由企业自己的发布流程上传。签名、强制更新策略和下载页仍按原发行配置管理。

### 图标 `desktop.icons`

| 字段 | 支持格式 | 填写示例 | 省略时 |
| --- | --- | --- | --- |
| `windows` | `.ico`、`.png` | `"./branding/app.ico"` | 官方 Windows 图标 |
| `macos` | `.icns`、`.png` | `"./branding/app.icns"` | 官方 macOS 图标 |
| `linux` | `.png` | `"./branding/app-linux.png"` | 原 Linux 打包使用的图标 |
| `tray` | `.ico`、`.png` | `"./branding/tray.ico"` | Windows 优先复用自定义 `icons.windows`，否则使用原托盘图标 |

### 预装插件 `desktop.plugins`

每个插件填一项。使用 npm 包时填 `package` 和精确 `version`。使用本地归档时填 `archive`，可额外填写 `package` 或 `version` 以核对归档里的身份。

```json
{
  "version": 1,
  "desktop": {
    "plugins": [
      { "package": "@example/report-tool", "version": "1.2.3" },
      { "archive": "./plugins/workspace-tools-2.0.0.tgz" },
      {
        "archive": "./plugins/company-export-1.0.0.tgz",
        "patch": "./plugins/company-export.patch.yml"
      }
    ]
  }
}
```

一般只需要指定插件包。打包器读取包内 `package.json` 声明的 `dsh.bundle.patch`。需要提供自己的补丁时加 `patch`，补丁使用 Cordis 的 `insert` 新增条目，组件 ID 要唯一，插件声明的 DSH 版本要求须与桌面包匹配。使用私有 npm 仓库时，仓库地址仍填在原发行预设的 `DSH_DESKTOP_NPM_REGISTRY`，权限和 Token 由打包机的 npm 配置提供。

## 服务端 `server`

| 字段 | 控制什么 | 省略时 | 填写示例 |
| --- | --- | --- | --- |
| `origin` | 企业账号服务的对外 HTTPS 地址，映射到 `SERVICE_ORIGIN`，也能作为桌面端的账号地址 | 服务端沿用现有 `SERVICE_ORIGIN`。桌面端仍按自己的发行配置取值 | `"https://accounts.example.com"` |
| `publicationOrigin` | 网站发布使用的独立域名，映射到 `PUBLICATION_ORIGIN` | 使用现有环境值，默认不配置 | `"https://sites.example.com"` |
| `https` | 外部数据库 Compose 部署是否带上 Caddy HTTPS 入口 | `false` | `true` |
| `database` | 企业服务连接的外部 PostgreSQL 或 RDS | 外部数据库部署继续读取环境里的 `DATABASE_URL` | 见下表 |

`server.origin` 和 `server.publicationOrigin` 在此文件中使用 HTTPS 源地址。启用 `server.https` 时，两项都需要有效值，可以从文件或现有环境变量读取。使用两个不同的域名、默认 HTTPS 端口，并将 DNS 指向部署入口。已有宿主机 Nginx 或 Ingress 时，可以保留默认的 `false`。自带 PostgreSQL 的模式继续使用原来的 `compose.yml` 和 `POSTGRES_PASSWORD`。

### 外部数据库 `server.database`

PostgreSQL 的加密连接使用 `postgresql://` 和 TLS。阿里云 RDS 推荐填 `tls.mode: "verify-full"` 与 `tls.caFile`，同时校验 CA 和数据库域名。`server.https` 控制的是用户访问企业服务的 HTTPS 入口，两者可分别启用。标准 RDS 密码连接所需的主机、端口、库名、用户名、密码、Schema、TLS 和 CA 都可通过下面的字段设置。

| 字段 | 控制什么 | 省略时 | 填写示例 |
| --- | --- | --- | --- |
| `host` | 数据库主机名或 IP。RDS 开启证书校验时填证书匹配的数据库域名 | 从指定的环境变量或 `DATABASE_URL` 取完整连接串 | `"pg.example.internal"` |
| `port` | PostgreSQL 端口，配合 `host` 使用 | `5432` | `5432` |
| `name` | PostgreSQL 库名，配合 `host` 使用 | `ipollowork` | `"work_production"` |
| `user` | PostgreSQL 用户名，配合 `host` 使用 | `ipollowork` | `"work_app"` |
| `passwordFromEnv` | 保存数据库密码的**环境变量名**，配合 `host` 使用 | `IPOLLOWORK_DB_PASSWORD` | `"WORK_RDS_PASSWORD"` |
| `urlFromEnv` | 保存完整 PostgreSQL URL 的**环境变量名** | 使用原有 `DATABASE_URL` | `"WORK_DATABASE_URL"` |
| `schema` | PostgreSQL Schema，映射到 `DATABASE_SCHEMA` | 原环境值，缺省 `public` | `"work"` |
| `poolSize` | 每个服务进程的连接池上限，范围 1 至 100 | 原环境值，缺省 `20` | `12` |
| `connectionTimeoutMs` | 建立连接的等待上限，范围 100 至 30000 毫秒 | 原环境值，缺省 `3000` | `5000` |
| `statementTimeoutMs` | 单条 SQL 的执行上限，范围 100 至 60000 毫秒 | 原环境值，缺省 `15000` | `20000` |
| `lockTimeoutMs` | 等待数据库锁的上限，范围 100 至 30000 毫秒 | 原环境值，缺省 `3000` | `3000` |
| `queueLimit` | 等待连接的排队上限，范围 1 至 2000 | 原环境值，缺省 `128` | `64` |
| `tls.mode` | 连接串的 `sslmode`，支持 `verify-full`、`verify-ca`、`require`、`disable` | 配置 CA 时使用 `verify-full`，否则保留连接串本身的行为 | `"verify-full"` |
| `tls.caFile` | PostgreSQL 服务端 CA 文件，部署时只读挂载 | 可从环境变量 `DATABASE_CA_FILE` 读取。两处均省略时不额外挂载 CA | `"./certificates/rds-ca.pem"` |

连接方式二选一。填 `host` 时，由工具合成 URL，自动编码用户名和密码中的保留字符。已有完整连接串时，填写 `urlFromEnv` 或直接沿用环境变量 `DATABASE_URL`。这时库名、用户名、端口和密码都写在私密连接串里。Schema 和连接池参数可以配合任一方式使用。自定义 Schema 需要提前在目标库创建，并给应用账号授予相应权限。Schema 名以小写字母开头，其余字符用小写字母、数字和下划线，最长 63 字符。

下面的配置给企业包指定了独立身份、Windows 图标和账号地址，同时复用已有连接串部署外部 RDS。把示例域名、环境变量名和本地文件路径换成实际值即可。

```json
{
  "version": 1,
  "desktop": {
    "appId": "com.example.work",
    "name": "星河工作台",
    "dataDirectoryName": "Example Work Desktop",
    "protocol": "example-work",
    "installerName": "ExampleWork-${version}-${os}-${arch}.${ext}",
    "icons": { "windows": "./branding/app.ico" }
  },
  "server": {
    "origin": "https://accounts.example.com",
    "publicationOrigin": "https://sites.example.com",
    "https": true,
    "database": {
      "urlFromEnv": "WORK_DATABASE_URL",
      "schema": "public",
      "tls": {
        "mode": "verify-full",
        "caFile": "./certificates/rds-ca.pem"
      }
    }
  }
}
```

在私密环境中设置 `WORK_DATABASE_URL` 的实际值。如果从控制台复制的连接串里带密码，保留它在环境变量或私密 `.env` 中。上面的 Compose 配置会将 CA 挂到容器内的 `/run/ipollowork/db-ca.pem`，并自动设置 `sslmode=verify-full&sslrootcert=/run/ipollowork/db-ca.pem`。K8s 若自己挂载证书，直接把容器内的实际路径写入连接串。

需要双向 TLS 时，客户端证书和私钥仍通过容器的独立挂载和私密连接串设置。独立应用数据数据库继续使用 `APP_DATA_DATABASE_URL`，按该库的实际证书与挂载路径填写。

## 保存后怎么生效

桌面配置在打包时写入新安装包。按目标平台运行已有打包命令，并沿用对应的签名和发行预设。以下命令在仓库根目录执行，Windows 和 macOS 各选实际目标。

```powershell
npm run package:desktop:win:x64
npm run package:desktop:mac:arm64
npm run package:desktop:mac:x64
npm run package:desktop:linux:x64 -- --unsigned
```

外部 PostgreSQL 部署用统一配置入口。可以先校验 Compose 配置，再启动或重建服务。已有部署沿用原 Compose 项目名，以继续使用同一数据卷。

```powershell
node services/ipollowork/deploy/compose-release.mjs -p ipollowork config --quiet
node services/ipollowork/deploy/compose-release.mjs -p ipollowork up -d --build
```

仓库内的部署入口默认读取 `services/ipollowork/.env` 作为私密环境文件，也可用 `IPOLLO_ENV_FILE` 指定。只拿到独立服务源码时，设置 `IPOLLOWORK_RELEASE_CONFIG` 并从服务目录执行 `node deploy/compose-release.mjs -p ipollowork up -d --build`。在 Docker 之外直接运行服务或运维 CLI 时，仍使用进程环境或 `IPOLLO_CONFIG_FILE`。

## 其他设置填在哪里

| 想改什么 | 当前填写位置 |
| --- | --- |
| 强制更新策略、签名证书、私有 npm 仓库 | `integrations/desktop/.env.windows`、`.env.macos` 或选中的发行预设。普通自动更新地址可用上文的 `desktop.update.feedUrl` |
| 认证密钥、邮件、反代信任 IP、服务限流 | 服务进程环境，或服务目录的私密 `.env`。例如 `AUTH_SECRET`、`MAIL_WEBHOOK_URL`、`TRUSTED_PROXY_IPS`。已有部署应沿用原 `AUTH_SECRET` |
| 独立应用数据数据库 | 服务端设置 `APP_DATA_DATABASE_URL` 和 `APP_DATA_DATABASE_SCHEMA`。有自己的 CA 时按该库的实际路径填写 TLS URL |
| OSS 的地域、Bucket 和访问凭证 | 企业服务后台的 OSS 设置。用 ECS 实例角色时通过服务端环境设置 `OSS_RAM_ROLE` |
| 首位平台管理员 | 在生产容器或运维环境传入 `ADMIN_PASSWORD`，执行 `npm run admin -- <邮箱> <名称>` |
| K8s 的域名、连接串和密钥 | 填在部署平台的 Ingress、环境变量和 Secret。统一 JSON 的 Compose 入口不生成 K8s 清单 |

配置文件会拒绝当前未定义的字段。如果要改的项目没有出现在本手册，先按表里的现有入口配置。更多服务端字段请查[服务端配置说明](../services/ipollowork/docs/configuration.zh.md)和[部署交接手册](../services/ipollowork/HANDOFF.zh.md)。
