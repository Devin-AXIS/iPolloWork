# DSH 加入企业插件

[English](README.md) | 中文

管理员在 iPolloOS 创建企业，员工使用本插件加入已有企业。企业身份、成员、部门和权限由 OS 的企业服务管理，员工无需安装 OS。插件通过 DSH 原生的插件、界面插槽、凭据和工作区接口接入，无需修改官方源码。

## 安装与使用

```sh
dsh plugin --profile desktop add link:/absolute/path/to/ipollo-enterprise
```

确认该包已加入桌面 profile 的 `dsh.profile.bundles`。DSH 启用热重载时会重新组合插件；未启用时需重启应用。管理员在 OS 企业管理设置中复制当前生效的企业地址与加入码，员工在 DSH 侧边栏打开「加入企业」，粘贴邀请信息、验证企业地址，再登录自己的 iPollo Account。

使用 DS Bot 等自定义侧栏时，可从「插件 → 已安装 → 加入企业」详情点击「打开加入企业」，进入同一个原生面板。

企业地址需要能够从员工设备访问。局域网可使用 HTTP，公网企业服务需使用 HTTPS。账号服务默认是 `https://i.ipollo.ai`，私有部署可在「账号服务设置」中填写企业配置的账号服务地址。旧账号服务使用 HTTP 时，需由员工明确确认未加密传输；插件不会自动将 HTTPS 降级为 HTTP。控制台地址、SSH 登录信息和管理员凭据不能作为员工企业连接信息。

## 当前能力

- 加入已有企业、保存企业登录状态，并读取成员和部门目录。
- 在访问目录和创建工作区前重新检查成员身份，遵循 OS 中生效的角色和停用状态。
- 在本机创建或复用企业成员对应的 DSH 原生工作区。
- 「断开此设备」仅移除本机连接，保留企业成员与已有会话。

企业登录凭证通过 DSH Host 的原生凭据服务保存，不发给浏览器。密码、账号登录令牌与身份令牌不持久化；企业登录过期后需重新登录。

当前工作区与会话保存在员工本机。本插件尚未实现原始会话上传、多人实时共享、远程执行或企业会话所有权管理。原有本地「企业空间」插件独立保留。

## 验证

在插件目录运行 `pnpm check`。设置 `IPOLLO_OS_SOURCE=/absolute/path/to/iPolloOS` 后可运行真实 OS 企业接口、PGlite 数据库与签名身份验证的集成测试，需要先构建 OS 的 enterprise runtime。真实 DSH Host 的额外验证方式见 [English verification instructions](README.md#verification)。测试使用隔离数据，不操作已有企业或真实员工账号。
