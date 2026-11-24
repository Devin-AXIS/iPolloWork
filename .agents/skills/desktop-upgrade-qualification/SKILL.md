---
name: desktop-upgrade-qualification
description: 验收 iPolloWork 桌面客户端覆盖更新和内置 DSH 升级，记录四项测试证据并准备正式发布要求的验收记录。适用于桌面发版、DSH 更换固定版本和升级回归。
---

# iPolloWork 桌面升级验收

在发布候选安装包完成后执行。取候选源码提交、`integrations/runtime/upstream.json` 中的 DSH 版本和源码修订、候选文件名与 SHA-256。使用独立系统账号、VM 或验收机器、专用数据目录和测试账号。Windows 测试环境不得与日用安装共用安装注册。需要故障注入时只影响测试 feed 和进程。

## 四项验收

| 项目 | 必须核对 |
| --- | --- |
| 覆盖安装 | 每个更新目标分别从当前发行版和一个更早仍使用的版本，通过软件内更新安装同一个候选包。保存旧会话、项目文件、设置和插件状态，安装后核对真实进程路径、版本、自动重启及旧数据。Windows 复用 [已安装更新流程](../../../integrations/desktop/tests/installed-update/README.zh.md)。候选 ZIP 或 EXE 必须与待发字节相同。 |
| 主要功能 | 使用已登录的测试账号完成对话、旧会话和项目打开、一次自动化任务及一次真实 MCP 调用。核对适用的分享权限和撤权、Office 或工作台导出。保存可定位的运行证据。 |
| 插件兼容 | 检查已启用受管插件迁移、已停用插件状态、第三方或本地插件不兼容时的拦截，以及单个归档失败后的工作区启动和重试。至少安装一个用户自制工作台，验证覆盖更新后可以打开界面、调用工具、读取升级前的数据，源目录与启用状态仍在。强更时用一个不兼容的本地链接复测拦截，验证能从强更页打开源目录、修复后重试。 |
| 失败恢复 | 分别验证下载断开、磁盘不足、安装器启动失败。核对用户可见的重试反馈、旧工作区恢复、未误安装以及「稍后更新」后的缓存复用。 |

先运行 `npm test`、`npm run check:upstream` 和相关套件测试，再通过 `integrations/desktop/scripts/test-local-updater.mjs` 复测真实 Electron 更新交互。拦截安装器、解包运行、模拟账号或 MCP 的证据可以记录为部分覆盖。只有完成表中要求时才把该项标为 `pass`。

## 记录和发布

生成 `desktop-upgrade-qualification.json`。根字段为 `schemaVersion: 1`、`version`、`commit`、`dsh` 和 `targets`。`dsh` 包含 `version` 与 `revision`。每个目标条目包含以下字段。

```json
{
  "artifacts": { "<exact filename>": "<SHA-256 hex>" },
  "upgrade": {
    "previous": { "from": "1.0.16", "result": "pending", "evidence": "" },
    "legacy": { "from": "1.0.10", "result": "pending", "evidence": "" }
  },
  "core": { "result": "pending", "evidence": "" },
  "plugins": { "result": "pending", "evidence": "" },
  "recovery": { "result": "pending", "evidence": "" }
}
```

证据用无凭据、无查询参数、无片段的 HTTPS 地址，例如验收 Actions 运行或已脱敏的验收记录。记录通过前核对各链接的内容与候选包一致。公开草稿附件仅写可公开的引用，详细日志和账号资料留在验收存储。

- **GitHub** 将记录附到候选草稿。`targets` 须覆盖 `win-x64` 和两个 macOS 架构 `mac-arm64`、`mac-x64`。Windows 记录更新 EXE，macOS 记录更新 ZIP 和对应 DMG。`previous.from` 使用当前 Latest 的版本。Linux AppImage 使用独立下载流程。
- **COS** 将记录放到原打包产物目录，CI 发布时放到原机器的留存批次目录。填写该发布目标的候选文件哈希。生产预检会检查记录，测试渠道可用于收集记录。

测试遇到问题时保留证据及未通过项。修复后重新打包，并用新包复验。发布工作流执行校验的源码在 [desktop-upgrade-qualification.mjs](../../../integrations/tooling/desktop-upgrade-qualification.mjs)。
