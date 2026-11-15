# iPolloWork

[English](README.md) | [中文](README.zh.md)

基于官方 DeepSeek Harness 运行时的 AI 工作平台。本仓库维护 iPolloWork 插件、账户服务、桌面外壳和发行打包，不内置或修改 DSH Agent 运行时源码。

## 开发

使用 Node.js 24.9 或更新版本及 Git。在新检出的仓库执行 `npm run setup:build`。安装过程下载 [upstream.json](integrations/runtime/upstream.json) 固定的官方源码，校验 SHA-256，按照官方锁文件安装并构建依赖。源码和生成的解析链接均被 Git 忽略。执行 `npm test` 和 `npm run check:upstream` 检查产品与依赖的分离。

[套件](plugins/ipollowork-suite/README.zh.md)以原生 DSH bundle 安装，品牌、账户、企业、市场和任务功能运行在官方客户端中，不另建 Agent 引擎。[桌面外壳](integrations/desktop/README.zh.md)额外维护操作系统品牌、原生登录和安装包。[账户服务](services/ipollowork/README.zh.md)独立部署。

本地打包 macOS 可执行 `npm run package:desktop:mac:arm64 -- --unsigned --dir`。签名和发布沿用专用工作流及机器配置。生成的应用包含运行所需依赖，不包含完整上游源码仓库。

## 官方升级

评估官方发布后，同步修改固定版本、压缩包校验值及声明版本，不自动追踪 `master` 或 `latest`。安装过程拒绝被修改的官方源码。采用新依赖前验证插件行为和完整安装包。

此前 Git 历史仍包含原来的上游源码。当前产品目录将其移出；未重写历史或强制推送。

两种交付方式与插件安装步骤见[交付说明](integrations/delivery.zh.md)。

## 许可证与署名

iPolloWork 自有代码使用原有的 [iPolloWork Source Available License](LICENSE)，属于源码可用软件，不是无限制的 MIT 授权。第三方代码及此前已授予的许可继续适用原条款，详见[第三方声明](THIRD_PARTY_NOTICES.md)。从当前目录移除上游文件不会删除 Git 历史和原作者记录。
