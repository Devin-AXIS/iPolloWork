# Official DSH dependency

[English](README.md) | 中文

`upstream.json` 固定官方源码版本、压缩包 SHA-256 和 npm 发布身份。当前基准为 **0.2.3-alpha.2**，要求 Node.js **^24.22.3 或 >=26.13.1** 和 pnpm **11.28.5**。品牌客户端从该版本构建，SDK 与 Cordis 依赖同步匹配。

在产品仓库根目录执行 `npm run setup:build`。源码下载至 `.upstream/dsh`；忽略的本地链接支持 TypeScript 与构建导入。安装过程不向 Git 跟踪的产品目录复制官方源码，也不修改官方源码。Git 元数据仅位于缓存中，使官方构建独立识别自己的版本，不依赖产品历史。

已有开发检出若在 `apps` 或 `packages` 中保留旧版用户文件，准备时附加 `--staged`，再用 `integrations/desktop/scripts/start-local-hot.ps1 -Restart` 启动原开发配置。这会保留那些目录，在被 Git 忽略的源码暂存目录构建产品外壳。新检出及 Release CI 仍使用正常解析链接。

已有 pin 更新时，关闭开发版后执行 `npm run setup:build -- --upgrade-upstream`。安装先核验旧源码、暂存新版本，再保留旧缓存以供恢复；拒绝静默替换和修改过的官方源码。账号配置、凭据、会话和工作区文件位于缓存外。Windows 使用核验过的 Git 检出及受管理的配置副本，无需文件符号链接权限。便携运行时通过临时短路径目录联接执行检查，避免 MAX_PATH 误报；运行时内容和官方检查保持完整。

执行 `npm test` 和 `npm run check:upstream` 后，还应在隔离 profile 中安装真实归档验证。运行时契约会核对桌面 Host 身份、插件已复核的 engines 和官方 SDK 版本。除产品源码外，还应复核 Design、Video 归档；仅修改兼容版本范围不能证明兼容。

Design 和 Video 按 `studios.json` 记录的外部不可变源码重新构建。克隆该仓库并检出精确的 `sourceRevision` 后，在此执行 `npm run prepare:studios -- --source <检出目录>`。工具先检查源码干净状态、运行时 pin 和 `studio-alpha2.patch` 校验值，再应用已复核的 SDK 元数据及锁文件适配。在外部检出目录执行 `npm ci`、`npm run check`、`npm run pack:plugins` 及独立／组合原生安装验证。用 Suite 目录导入工具登记真实归档，再运行 `check:upstream`；归档哈希和来源凭据均属于发布输入。不要修改官方 DSH 缓存。

`npm run check:upstream` 校验原始源码哈希并拒绝跟踪上游实现目录。在本目录执行 `node check-pin.mjs` 校验已下载的源码。现有文件和会话不存放在依赖缓存中。

[DSH 兼容记录](compatibility.zh.md)列出产品对上游接口的依赖和升级验证步骤。

可在本目录执行 `npm ci --ignore-scripts` 单独检查官方 npm 发布包，不用它混合或替换源码构建的桌面依赖图中的单个包。
