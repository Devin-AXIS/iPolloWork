# iPollo Onto

**iPollo 业务本体 · AI 原生企业业务底座**

本目录是 iPolloWork 插件源码集合中的完整 Onto 应用，基于 [Devin-AXIS/iPollo-Onto](https://github.com/Devin-AXIS/iPollo-Onto/tree/c209c8b8ebdb36773232632e83a02de52360882f) 导入。当前分发版本 **0.1.6**。原作者、品牌、版权和 [LICENSE](LICENSE) 保留；修改内容记录在 [NOTICE](NOTICE)。

## 用户安装

从 iPolloWork 公开插件市场下载后，在个人插件页启用并打开 **iPollo Onto**。完整包包含网页、数据服务、字段与视图扩展、工作台桥接和工作流 Skill。

需要本分支 **0.50.18+ 客户端**，以支持按资源声明的表单、下载与打印沙箱权限。默认复用主软件已有的 SQLite 运行时，自动建立插件专属数据库，**无需安装 PostgreSQL、Node.js 或 pnpm**。数据库不使用主软件的聊天表。打开后直接创建项目、表格、关联和文档。项目 MCP 仍须在项目「API / MCP」页面获取真实 URL，添加到宿主 MCP 设置；不会自动扩大 AI 的访问范围。

高级用户可以为新项目选择独立 PostgreSQL 兼容数据库。这是可选能力，需要自行准备远端数据库；本次没有远端测试凭据，未重新验证该连接路径。

## 保留的功能

- 项目、业务表、类型化字段、双向关联、关系图和多步关系探索。
- 条件筛选、精确数字排序、保存视图、列与导航顺序。
- 文档、媒体附件、业务表嵌入、Word 下载和 PDF 打印预览。
- 项目/表范围 REST 与 MCP、幂等批量导入、乐观版本冲突检查。
- 对话绑定、AI 已提交操作跟随、编辑时暂停刷新、可导入字段/视图扩展、基础自动化。
- 中英文和亮暗主题。模型调用与 AI 执行继续由 iPolloWork 提供。

## 数据与更新

生产服务只监听本机 127.0.0.1:5711。主软件通过通用插件存储目录提供数据位置，Onto 在其中保存 onto.sqlite、document-files/、database.key 和 extensions/。这些文件不在安装制品内，更新不会覆盖它们；卸载时是否删除数据遵循宿主的明确选择。备份应在服务关闭后一起复制上述数据文件。

SQLite 使用 WAL、外键、写事务串行化和数据库版本检查。金额按十进制文本保存，最多 14 位整数和 4 位小数；筛选排序以精确的 64 位定点整数执行，不经过浮点数。没有自动迁移旧 PostgreSQL 数据；已有用户可保留原 PostgreSQL 部署或显式连接独立项目。

该版本面向可信本机使用，不提供多人身份认证。SQLite 与 PostgreSQL 的全文大小写行为可能随字符集不同，本版本验证了中文与英文常见查询。

## 源码开发与打包

在此宿主仓库根目录运行：

```powershell
pnpm --dir examples/plugin-packages/ipollo-onto install --ignore-workspace --frozen-lockfile --ignore-scripts
pnpm --dir examples/plugin-packages/ipollo-onto build
pnpm --dir examples/plugin-packages/ipollo-onto test
bun test examples/plugin-packages/ipollo-onto/service/workbench.test.ts
```

build 生成 dist/package/；服务端及依赖代码封装成单一模块，复用 scripts/sqlite-runtime.mjs，前端保留原有按功能分块。第三方许可随包保存。云端制品由宿主 scripts/package-plugin-collection.mjs 和 package-plugin.mjs 统一签名，私钥不进入源码或插件包。

本地开发可在本目录运行 pnpm dev。默认创建 .data/onto.sqlite；也可指定 ONTO_SQLITE_PATH。要使用 PostgreSQL 开发模式，清除 ONTO_SQLITE_PATH 并提供 DATABASE_URL。测试请将数据库、文档和密钥位置指向隔离目录，勿使用业务数据。

原始设计、API 与扩展契约见 docs/。上游源码下载和发布脚本已由宿主的统一打包流程替代，不保留重复清单或签名实现。
