# iPolloWork desktop

[English](README.md) | 中文

本包维护 iPolloWork 的 Electron 外壳、邮箱登录、品牌界面与发行打包，通过[桌面宿主](../desktop-host/README.zh.md)启动官方 DSH profile。Agent 循环、工具、会话和凭据仍由官方 DSH 服务管理。产品账户、首次引导、分享及必需插件策略位于[套件](../../plugins/ipollowork-suite/README.zh.md)。

用户看到的都是 iPolloWork：菜单、关于面板、托盘、对话框、应用和托盘图标（白底黑色标志）、版权、链接协议名和 Windows 快捷方式。宿主启动期间，外壳送出的 DSH 启动页和网页以 iPolloWork 的标题、标志和名称替换 DSH 字标。打包后的应用包、可执行文件、辅助进程和 Windows 安装目录都以 iPolloWork 命名（`iPolloWork.app`、`iPolloWork.exe`），macOS 菜单栏和活动监视器也显示 iPolloWork。安装包和更新文件沿用 `deepseek-harness-<版本>-<系统>-<架构>` 文件名，因为固定版本的 DSH 发布工具按这个名字查找文件。

DSH 依赖从[运行时固定记录](../runtime/upstream.json)指定的官方源码版本构建，不修改 `packages/` 或 `apps/`。同版本号的 npm 发布包早于源码中的认证 API，因此不能混入桌面版。`Resources/dsh` 保存普通的实体 Node 依赖，DSH 无需产品专用的模块加载修改。

在仓库根目录执行 `npm run setup:build`，然后运行 `node integrations/desktop/run.mjs package-target.ts mac-arm64 --dir --unsigned`。输出位于 `.desktop-build/`。本包使用校验后的官方依赖缓存，不单独执行 npm 安装。正式签名发行还需配置对应平台的签名环境。

不提供旧版 iPolloWork profile 转换或降级层。文件和账户凭据仍由配置的 DSH home 管理。`LICENSE` 保留原 DeepSeek Harness MIT 许可证；产品修改独立维护于本目录，不进入官方应用源码树。

## 产品版本

当前产品发行版为 **iPolloWork 1.0**（安装包元数据为 `1.0.0`）。产品与桌面端清单使用相同版本；内置 DSH 运行时保留 `integrations/runtime/upstream.json` 中固定的版本。后续补丁版本依次使用 `1.0.1`、`1.0.2`，展示名称可写为 `1.0.01`、`1.0.02`。安装包元数据不得使用前导零，因为更新器要求标准语义化版本号。
