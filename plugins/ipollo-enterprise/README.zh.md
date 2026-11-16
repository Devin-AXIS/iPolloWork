# DSH 的 iPolloOS 企业连接器

[English](README.md) | 中文

用于加入 iPolloOS 或 iPollo Enterprise Server 托管的已有企业的原生 DeepSeek Harness 插件。公司管理员在 OS 创建企业；员工使用企业 URL、加入码和自己的 iPollo Account 通过本插件加入。

插件在原生侧栏添加 **加入企业 / Join enterprise**。它验证企业地址，通过明确显示的账号提供方登录，绑定返回的企业成员身份，并分页显示成员与部门目录。账号提供方 URL 支持私有部署配置，默认值为 `https://i.ipollo.ai`。插件拒绝公网 HTTP 企业接口，支持内网 HTTP 接口和 HTTPS 反向代理路径前缀。管理员提供旧版 HTTP 账号服务时，员工必须明确确认未加密登录。HTTPS 请求失败后，插件不会自动降级。

企业凭据通过 DSH 原生凭据记录服务保存在 Host。账号密码、账号登录令牌和身份令牌不持久化。浏览器响应只包含连接元数据。企业凭据过期后需要重新登录；受保护操作前会向企业服务检查成员状态和角色变化。**Disconnect this device** 仅移除本插件保存的连接，保留企业成员身份和已有会话。

**Start a session in the enterprise workspace** 为当前企业与成员创建或复用普通本地 DSH 工作区。它不会上传会话、提供远程执行或授予同事原生会话日志访问权。现有本地企业管理原型、其他插件、DSH 设置和原始上游源码均独立于本软件包。

## 安装

这是独立插件包，不是替代 DSH 的构建。将其安装在临时开发 worktree（工作树）之外的持久路径：

```sh
dsh plugin --profile desktop add link:/absolute/path/to/ipollo-enterprise
```

如果包管理器未启用该包，在 profile 的 `dsh.profile.bundles` 中启用 `@ipollo/dsh-enterprise-connector`。原生 profile 重组通过 `cordis.patch.yml` 和包的 `dsh.client` manifest（元数据清单）加载 Host 与浏览器两端，无需编辑任何上游 DSH 文件。安装后使用现有浏览器/profile 生命周期重组 profile。

在 OS 中，从企业成员管理设置复制当前生效的企业 URL 和加入码。在 DSH 打开 **加入企业**，粘贴信息或分别填写字段，验证企业，再通过该企业配置的账号提供方登录。企业接口必须已能从员工设备访问；桌面控制地址和管理员/SSH 凭据不是企业连接信息。

启用自定义侧栏时，打开 **Plugins → Installed → Join enterprise**，通过 **Open enterprise connection** 进入同一个原生面板。

## 验证

```sh
pnpm check
IPOLLO_OS_SOURCE=/absolute/path/to/iPolloOS pnpm check
```

第二条命令需要 OS 的 `pnpm bundle:enterprise` 输出。它测试真实打包的 OS 企业处理程序、PGlite 迁移、签名身份验证、受邀成员加入、目录、连接器状态持久化、实时角色变化和已停用成员拒绝。仅替换测试账号提供方与原生凭据提供方 fixture（测试前置数据）；不使用真实用户账号或已有企业数据。

将 `DSH_NATIVE_PROOF_HOME` 设置为隔离运行中的 DSH profile 的 home，可额外验证实际插件 HTTP 路由、原生凭据提供方、所有者 Cookie 认证和原生工作区创建。其 `server.log` 必须包含 `dsh --profile enterprise-join --port 0 --no-open` 打印的认证启动 URL。此路径仅用于临时测试数据，不能使用用户的 DSH home。
