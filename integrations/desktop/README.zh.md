# iPolloWork desktop

[English](README.md) | 中文

本地批量维护插件时可运行 `start-local-hot.ps1 -Restart -NoNativeHmr`，临时停用自动生成的原生 HMR 条目，插件仍由原生管理器安装并提示重启生效。完成后运行 `start-local-hot.ps1 -Restart` 应用变更并恢复 HMR，保留原配置、账号和插件数据。

本包维护 iPolloWork 的 Electron 外壳、邮箱登录、品牌界面与发行打包，通过[桌面宿主](../desktop-host/README.zh.md)启动官方 DSH profile。Agent 循环、工具、会话和凭据仍由官方 DSH 服务管理。产品账户、首次引导、分享及必需插件策略位于[套件](../../plugins/ipollowork-suite/README.zh.md)。

用户看到的都是 iPolloWork：菜单、关于面板、托盘、对话框、应用和托盘图标（白底黑色标志）、版权、链接协议名和 Windows 快捷方式。宿主启动期间，外壳送出的 DSH 启动页和网页以 iPolloWork 的标题、标志和名称替换 DSH 字标。打包后的应用包、可执行文件、辅助进程和 Windows 安装目录都以 iPolloWork 命名（`iPollo.app`、`iPollo.exe`），macOS 菜单栏和活动监视器也显示 iPolloWork。安装包和更新文件沿用 `iPollo-<版本>-<系统>-<架构>` 文件名，因为固定版本的 DSH 发布工具按这个名字查找文件。

DSH 依赖从[运行时固定记录](../runtime/upstream.json)指定的官方源码版本构建，不修改 `packages/` 或 `apps/`。同版本号的 npm 发布包早于源码中的认证 API，因此不能混入桌面版。沿用官方 ASAR 布局：JavaScript 和资源位于 `app.asar/dsh`，仅原生可执行文件及需要物理路径的资源放在归档外。CLI、Host 和运行验证使用同一布局。

本地生成未签名的 macOS 应用目录时，在仓库根目录执行 `node integrations/tooling/setup.mjs --plugins` 安装依赖，再运行 `node integrations/desktop/run.mjs package-target.ts mac-arm64 --dir --unsigned`。输出位于 `.desktop-build/`。正式签名发行还需配置对应平台的签名环境。

不提供旧版 iPolloWork profile 转换或降级层。文件和账户凭据仍由配置的 DSH home 管理。`LICENSE` 保留原 DeepSeek Harness MIT 许可证；产品修改独立维护于本目录，不进入官方应用源码树。

Windows 本机已准备好的 Jovan 开发版，可用 `powershell -NoProfile -File integrations/desktop/scripts/start-local-hot.ps1` 启动。第一次请让开发版保持运行，以便启动器记录原有配置。启动器默认使用开发版自带的 Node.js，也可以通过 `-NodeExecutable` 指定。复用窗口前会验证固定 DSH 源码，并核对当前外壳、Host 和账号组合的源码指纹；有变化时先在忽略目录构建新产物，成功后才替换旧进程，保留旧目录、原 DSH home 和 Electron 用户目录。每次启动构建 Work 套件，运行时保存源码则自动重建，由 DSH 原生热重载接手。传入 `-Restart` 也会重启源码未变的开发版，否则会激活已确认产物为最新的热更新窗口。外壳或 Host 源码有变化后，重新运行启动器即可。

在对应平台的构建机上，从仓库根目录执行 `node integrations/tooling/setup.mjs --plugins`，再运行下表命令。打包命令负责构建和验证固定版本的运行时及产品。

| 目标 | 命令 | 官网识别的文件 |
| --- | --- | --- |
| Windows x64 | `npm run package:desktop:win:x64` | `ipollowork-win-x64-<版本>.exe` |
| macOS Apple 芯片 | `npm run package:desktop:mac:arm64` | `ipollowork-mac-arm64-<版本>.dmg` |
| macOS Intel | `npm run package:desktop:mac:x64` | `ipollowork-mac-x64-<版本>.dmg` |
| Linux x64 | `npm run package:desktop:linux:x64` | `ipollowork-linux-x86_64-<版本>.AppImage` |

官网安装包位于打包输出的 `website-installers/` 目录。Windows 命令可附加 `-- --unsigned`，此时文件名保留 `-unsigned`。macOS 下载包须完成公证。Linux AppImage 使用当前固定版本的 iPollo 运行时，可独立分发。

## 产品版本

通用设置和关于界面显示 Electron 安装包版本。正式打包时，这个版本由发行标签决定。内置 DSH 运行时独立跟随 `integrations/runtime/upstream.json` 中固定的版本。

在目标提交上建一个纯数字版本的草稿，例如 `v1.0.5`，然后运行 `ipollo-release-packages.yml`。工作流验证打包后的运行时，并为每个平台附上一份安装包，同时上传 macOS 更新 ZIP、blockmap 和 macOS 构建记录。运行 `ipollo-publish.yml` 校验文件、生成稳定版更新清单和校验和，再发布草稿。已配置国内存储时可开启镜像选项。

iPollo 签名发行设置 `DSH_DESKTOP_UPDATE_URL=https://github.com/Devin-AXIS/iPolloWork/releases/latest/download` 和 `DSH_DESKTOP_UPDATE_CHANNEL=stable`。安装包中的更新器不得指向上游 DSH 下载服务；两个 Mac 架构共用包含各自 ZIP 条目的更新清单。

Design 和 Video 由用户在插件市场按需安装。套件携带经过校验的插件市场归档，供安装时使用。各插件在自己的源码仓库构建，桌面发行无需单独附加这些归档。

macOS 打包前执行 `node integrations/desktop/run.mjs prepare-cua-helper.ts`，校验官方提供方归档与运行时锁文件的 SHA-512、准确 SDK 版本和完整辅助程序源码摘要，再对官方已发布的两个架构重新签名、公证，并在当前宿主架构运行官方协议回归。缺失或摘要不符时禁止打包。桌面启动时，仅当独立目录缺少模型文件，才从共享 `~/.dsh` 缓存复用 SHA-256 校验通过的 SenseVoice 模型；不会覆盖已有模型。

Windows 打包需要 .NET SDK 10 编译固定版本的电脑操作辅助程序；完整独立运行输出随提供方打包，并放在应用归档外。发行工作流会安装该 SDK。

## 账号服务配置

默认账号地址位于 [Suite deployment.json](../../plugins/ipollowork-suite/deployment.json)。平台 dotenv 文件和选中的发行预设支持 `DSH_DESKTOP_ACCOUNT_ORIGIN`；单次构建可通过 `PACKAGE_ACCOUNT_ORIGIN` 显式覆盖，包含未签名和 Linux 构建。打包子进程将地址写入原生应用组合，Suite 运行时保留该值。账号地址与更新源分别配置。优先级、服务端数据库文件和地址清单见[配置说明](../../docs/deployment-configuration.zh.md)。
