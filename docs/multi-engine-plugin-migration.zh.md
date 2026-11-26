# 多引擎插件迁移至 DSH

来源为远端 `ipollowork-multi-engine` 的 `05f917145cd320a93e514dbd01178133891bc4c6`，共 24 个条目。当前 Jovan 已同步主分支 `4b4dad9b32`（iPolloWork 1.0.14），DSH 继续固定为 `0.2.2-rc.3`。本次未修改官方 DSH 源码、Agent 循环或生产账号服务。

## 对应关系

| 旧条目 | 当前原生包 |
| --- | --- |
| Context7 | `@ipollo/dsh-context7` |
| DeepSeek Harness | `@ipollo/dsh-deepseek-harness`（复用当前宿主） |
| iPollo Design | `deepseek-idesign` |
| 抖音运营台 | `@ipollo/dsh-douyin-ops` |
| Figma | `@ipollo/dsh-figma` |
| GitHub | `@ipollo/dsh-github` |
| iPollo Onto | `@ipollo/dsh-ipollo-onto` |
| Jev 决策引擎 | `@ipollo/dsh-jev-decision-model` |
| 数据标注实训云 | `@ipollo/dsh-data-annotation` |
| Linear | `@ipollo/dsh-linear` |
| 素材工作台 | `@ipollo/dsh-media-studio` |
| Notion | `@ipollo/dsh-notion` |
| 操作录制 | `@ipollo/dsh-operation-recorder` |
| 插件工坊 | `@ipollo/dsh-plugin-workshop` |
| 参考资料 | `@ipollo/dsh-reference-context` |
| Sentry | `@ipollo/dsh-sentry` |
| 短片创作工作台 | `@ipollo/dsh-short-video-studio` |
| Stripe | `@ipollo/dsh-stripe` |
| iPollo Video | `deepseek-ivideo` |
| 视频号运营台 | `@ipollo/dsh-wechat-channels-ops` |
| 微信公众号 | `@ipollo/dsh-wechat-official` |
| 小红书运营台 | `@ipollo/dsh-xiaohongshu-ops` |

默认市场保留 Design、Video 在前，连同原有会话标题共 25 个条目。展示不会自动安装或启用插件。每个迁移包有独立的 Cordis patch、Host/Client 入口和 `.tgz`，由原生 Plugin Manager 安装、启停及卸载。市场随 Suite 携带实际安装包，`catalog/bundled-releases.json` 固定 SHA-256；不会要求安装尚未公开发布的 npm 版本。

## 接入、开发与打包

原有业务源码保存在 `plugins/<slug>/business/`。原生连接层位于 `plugins/ipollowork-suite/src/ported/`，构建时打入各个独立包，不要求先安装另一套业务运行时。Design、Video、操作录制和数据标注复用现有原生实现；Harness 条目只提供当前宿主的使用指引。

```powershell
npm run build:ported-plugins
npm run package:ported-market
npm run build
```

Onto 和小红书使用各自固定的依赖文件构建独立业务资源；首次构建需要 pnpm。开发时可通过 `IPW_PORT_BUILD_DEPENDENCIES` 指向同一来源版本的已有多引擎检出以复用构建依赖，业务代码仍取当前目录。安装后的用户无需旧宿主、编译器或该环境变量。

新插件沿用[插件开发规范](plugin-development.zh.md)：使用 `package.json` 的 `exports`、`engines.dsh` 和 `dsh.bundle.patch`，Host 注册工具、凭据、服务和 Skill，Client 注册原生插槽。原生管理器继续支持 npm、固定 Git 来源和本地 `.tgz`。旧 `.ipollowork-plugin` 是另一种包格式，需要迁移后重新打包。

插件工坊通过 Skill 引导制作、检查和导出原生 Bundle，再用原生管理器安装验证；不继续调用旧宿主的工坊编辑器。MCP 类型插件使用 `mcpManager.register` 和原生连接授权；Figma 本地 MCP 仍需要用户启动对应服务。

## 数据与权限

保留原插件 ID 及 `~/.ipollowork/plugin-data/<id>` 业务目录。不会删除旧账号、草稿、浏览器资料或项目文件。已有原生数据标注、操作录制继续沿用各自 README 中的工作区数据约定；其他位置的旧记录不自动搬移。

账号密钥使用原生凭据提供方的插件独立记录。旧宿主加密授权库不会被绕过或明文复制，需要在新工作台重新连接对应账号。界面只读取连接状态；密钥不进入浏览器存储、模型工具输出或安装包。本地业务服务的临时访问令牌留在 Host，工作台通过经过所有者认证的同源代理访问。

工具只接受已声明操作及参数 schema，按当前原生会话确定工作区；写操作拒绝只读会话。界面请求核对所有者、来源及工作区内会话归属。停用释放工具、Skill、MCP 注册、HTTP 路由及子服务，卸载保留业务数据。这些保证不隔离任意 shell 命令或同进程 Host 插件。

## 能力与验收范围

当前 DSH pin 没有旧宿主的按账号浏览器资料隔离、自动账号识别和 `ui/open-link` 接口。这些网页自动接入流程尚未完成等价迁移，工作台显示明确提示；不能把登录页打开或本地账号记录当作已授权、已验证。平台 API 授权按各插件声明配置，网页执行需另行配置真实可用的原生浏览器/MCP 能力，不能继续调用不存在的 `ipollowork_browser_*` 工具。小红书当前随市场生成的包包含 Windows x64 的图像处理依赖；其他系统需在目标平台重新构建。

素材和短片工作台通过 Suite 的账号能力服务查询实际授权模型，保留请求 ID 和任务状态，不自动重试结果未知的付费任务。当前服务协议支持文生图、支持参考输入的图生图、文生视频、单首帧视频及语音。旧版的局部蒙版、多参考视频、尾帧、扩展和部分本地视频编辑接口没有对应服务契约，调用时明确拒绝，不伪造成功；可导入已有素材并交给原生 Design/Video 继续编辑。Acme 的 `.example` 地址是原仓库示例，并非可用商业搜索服务。

本地验收使用独立 `DSH_HOME`、业务数据目录及测试工作区。源码和包检查不能证明真实平台授权、发帖、付款、供应商生成或各操作系统原生录制均已通过。公开上架、生产部署及桌面安装器发布需要单独执行。

2026-11-23 在 Windows x64 / Node 24.22.3 上完成以下检查：根目录 16 项测试、Suite 211 项通过（11 项原配置跳过）、操作录制 24 项和数据标注 5 项通过；20 个新包构建及语法检查、Suite 类型检查、上游固定源码校验、文档链接、图标及打包检查通过。最终 Suite `0.1.46` 实际 `.tgz` 与 22 个独立 `.tgz` 均经官方管理器安装并启用，20 个迁移 Host 的所有者及来源校验通过。实际界面覆盖 25 项市场、Onto、抖音、小红书、短片画布保存、数据标注入口及操作录制“已连接”；另验收视频号、公众号和素材入口、明暗主题及 390px 布局。市场安装、停用移除路由、重新启用和卸载在测试配置中验证。

全量 Suite 冷安装使用显式 `--registry=https://registry.npmjs.org`；本机默认镜像曾超时。测试 profile 按固定 DSH 的现有策略，将 `@google/genai` 和 `protobufjs` 的 `allowBuilds` 设为 `false`，未执行其安装脚本，未改全局 npm 配置。安装和启用是不同步骤；安装成功后通过原生管理器启用并核验实际路由，不能仅凭磁盘存在包就判断插件已运行。
