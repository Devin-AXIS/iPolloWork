# iPolloWork DSH 集成

[English](README.md) | 中文

`dsh` 分支包含上游 DSH 运行时、iPolloOS 企业连接器、iPolloWork 套件及其独立账号服务。每个应用分别管理自己的依赖、测试和部署生命周期。

| 位置 | 包含的能力 |
| --- | --- |
| `plugins/ipollo-enterprise` | 加入已有的 iPolloOS 企业 |
| `plugins/ipollowork-suite` | 主题、市场、agent（智能体）、协调器、IM、项目协作、原生会话分享和服务连接 |
| `plugins/ipollowork-suite/catalog/packages` | 当前完整的 Design/PPT 和 Video 安装包 |
| `services/ipollowork` | 账号、会员、积分、服务执行、项目授权、变更和原生分享中继 |

按照套件目录中的 README 安装依赖并构建，再通过原生 `dsh plugin` 命令安装。账号服务单独部署，将套件的 `accountOrigin` 指向该部署。DSH 仍负责应用启动和执行。现有上游文件与会话格式保持不变。

`ipollowork.json` 记录所含源码的版本和文件哈希，不包含构建输出目录、凭据、本机会话和已被替代的插件压缩包。Design/Video 源码保留在该文件记录的独立仓库中；市场包含当前完整的可安装包。

iPolloWork 集成工作流分别检查企业连接器、套件和账号服务。运行时兼容性与原生集成检查仍由各自的 README 说明。各目录中的软件包许可证声明和第三方声明分别约束对应目录。

套件内嵌的 IM 源码在 `plugins/ipollowork-suite/vendor/dsh-im` 保留上游措辞与声明。仓库的具体术语检查仅排除这一确切的第三方目录，套件自有代码仍接受检查。
