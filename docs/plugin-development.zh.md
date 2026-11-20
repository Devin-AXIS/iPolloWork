# iPolloWork 插件开发规范

本文适用于 iPolloWork `1.0.6`（提交 `de22c65016`）和固定的 DeepSeek Harness（DSH）`0.2.2-rc.3`（源码 `39163dd30f70`）。开发时以当前分支的 [iPolloWork 版本](../package.json)、[DSH 版本锁](../integrations/runtime/upstream.json)和[兼容性记录](../integrations/runtime/compatibility.zh.md)为准。

## 选择扩展方式

| 需求 | 扩展方式 | 仓库示例 |
| --- | --- | --- |
| 给智能体增加流程、约定或领域指令 | 使用 `SKILL.md`。需要通过插件管理器分发时，再用小型 DSH Bundle 注册该 Skill | [操作录制的 Skill 导出](../plugins/operation-recorder/README.zh.md) |
| 注册工具、服务、事件或 HTTP 路由 | 使用 Cordis Host 组件，按需注入 DSH 服务 | [数据标注 Host](../plugins/data-annotation/src/host.ts) |
| 添加工作台、导航入口或设置项 | 在 Host Bundle 中增加 Web Client，使用 DSH 原生插槽 | [Stage Client](../plugins/stage/src/client.js) |
| 接入已有 MCP 服务 | 使用 DSH 的 MCP 连接和凭据管理。需要额外界面或平台逻辑时，再增加 Bundle | [服务连接](../plugins/ipollowork-suite/docs/connections.md) |

仓库自有独立插件放在 `plugins/<slug>/`，也支持在独立仓库维护可安装的 Bundle。产品默认组合由 [套件](../plugins/ipollowork-suite/README.zh.md)和 [桌面组合脚本](../integrations/tooling/desktop-composition.mjs)维护。以独立分发为例，数据标注和操作录制单独交付。Stage 是随完整桌面安装包交付的组件。

使用官方 DSH launcher、loader、Plugin Manager 和 Agent 生命周期。产品功能落在插件、组合配置或独立服务中，`.upstream/dsh` 由版本锁管理。需要的扩展点缺失时，记录缺口以及它对实现的影响。产品改动依赖新的 DSH API、事件、插槽或 DOM 约定时，同步更新 [兼容性记录](../integrations/runtime/compatibility.zh.md)的中英文版本，写明代码位置、所用接口和下次升级的复验路径。

历史多引擎版使用 `ipollowork.plugin.json` 和 `.ipollowork-plugin`。移植这些项目时，将能力重新接到 DSH 服务和生命周期，并按下文构建新的 Bundle。

## DSH 架构与界面规范

插件必须遵守固定版本的 DSH 架构和界面设计。实现前先确认宿主是否已有同类工作流，确定其服务、权限和界面由谁负责。

| 范围 | 开发要求 |
| --- | --- |
| 宿主架构 | 通过公开的 Cordis 服务、配置、事件和 slots 扩展。复用 DSH 的安装、会话、工作区、凭据等既有服务。遇到缺失扩展点时记录缺口，优先通过公开接口或独立服务解决。 |
| 界面组成 | 使用原生页面、侧栏、设置和弹层的插槽。优先复用可公开导入的 `ui-primitives`、图标和现有交互模式。参考最接近的原生页面，复用间距、字号、圆角、层级和主题语义 token。 |
| 状态与可访问性 | 使用原生本地化机制。检查键盘操作、焦点可见与恢复、名称和提示。加载、空数据、失败和禁用状态延续宿主交互。菜单和弹层应能关闭并在窄屏和窗口控制区之外使用。 |
| 自有工作台 | 编辑器、画布或独立业务内容可使用产品自己的版式。嵌入宿主的导航、弹层、窗口间距与主题切换仍遵循 DSH。增加的样式应限定在插件范围并可随停用撤销。 |

有 Client 改动时，开发和评审都应阅读固定源码下的 `.upstream/dsh/.agents/skills/dsh-client-ui-ux/SKILL.md`，再按改动查它指向的组件、主题、布局或图标文档。验收在真实宿主页面中完成，检查相邻元素、明暗主题、窄容器、长文本、焦点和受影响的交互状态。记录用到的扩展点和复验路径。

## 包结构与入口

| 文件或字段 | 约定 |
| --- | --- |
| `package.json` | 使用唯一 npm 包名、SemVer 和 `"type": "module"`。仓库自有产品插件常用 `@ipollo/dsh-<slug>`。通过 `engines.dsh` 声明实际支持的 DSH 版本范围，未声明时 DSH 用相关 peer 依赖做兼容检查。 |
| `dsh.bundle.patch` | 指向包内 Cordis patch，通常为 `./cordis.patch.yml`。Patch 的 `insert` 添加组件，`id` 在目标组合中唯一，`name` 解析到包名或其公开子路径。升级时保持已有组件 ID、包名和已承诺的配置键。 |
| `exports["."]` 和可选子路径 | 指向实际发货的 Host 模块。以 ESM 命名导出 `apply(ctx, config)`，按需导出 `name`、`inject` 和 `Config`。使用 `inject` 声明所需服务。 |
| `exports["./client"]`、`dsh.client` | 仅在需要界面时添加。Web 产物使用 DSH Client loader 格式，`platform` 为 `web`，`inject` 列出依赖的 Client 包。复用 `main`、`sidebar.panellist`、`plugins.bundle.config` 等已验证的插槽。 |
| `files`、依赖与构建 | 新代码使用 ESM 和严格 TypeScript。将构建产物、patch、运行所需资源、许可和第三方声明列入发货范围。复用宿主提供的 DSH 包和类型，核对 peer 依赖与固定版本。让 `.tgz` 携带编译后的入口，避免安装时再编译插件。 |
| `skills/<name>/SKILL.md` | 随包提供 Skill 时，验收 frontmatter 的 `name`、`description` 和引用资源。用原生 Skill registry 注册，`resourceBase` 指向包内目录，停用时一并取消注册。 |

配置字段、Host 服务和 Client 模块依赖分别声明。Cordis 组件的启动顺序由服务依赖决定。客户端涉及宿主样式时，使用主题变量并验证明暗主题和窄屏。

## 生命周期、权限与数据

- 通过 `apply` 注册能力。用 `ctx.effect(() => register(...))` 接入返回 disposer 的注册 API，或使用同一插件上下文的原生生命周期 API。关闭时撤销插槽、路由、工具和 Skill，并释放监听器、计时器、请求、服务和子进程。验证连续启停不会累积注册。
- Host 负责身份验证和授权。复用固定运行时的 Connection 准入接口，按现有能力区分所有者、受邀成员、工作区和只读会话。写入前依据宿主当前上下文校验范围，避免把调用方传来的路径、工作区 ID 或角色当成授权。可参考 [Stage Host](../plugins/stage/src/host.ts)和[数据标注 Host](../plugins/data-annotation/src/host.ts)的不同权限模型。
- 凭据通过 DSH 凭据提供方或对应既有服务管理。Client 仅取得展示与交互所需的数据。浏览器存储、模型工具结果、日志、错误消息和安装包均不承载密钥。Host 插件与运行时同进程，权限取决于该进程。需要强隔离的能力使用独立服务、工作区沙箱或操作系统隔离。
- 工具注册采用原生 `ctx.tools.register`，声明参数、输出和读写意图。规则要在 Host 或实际执行服务中生效。涉及已存储状态时，维持旧版数据可读取或提供明确迁移，卸载时保留用户数据，除非用户另行执行清理。

## 最小可安装示例

在临时目录创建下面三个文件。这里直接给出 ESM 发货文件，方便验证 Bundle 入口。

`package.json`

```json
{
  "name": "dsh-example-hello",
  "version": "0.1.0",
  "description": "Minimal DSH Host bundle for local verification.",
  "type": "module",
  "engines": { "dsh": ">=0.2.2-rc.3 <0.2.3-0" },
  "exports": { ".": "./host.js" },
  "files": ["host.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`

```yaml
- insert:
    - id: example-hello
      name: dsh-example-hello
```

`host.js`

```js
export const name = 'example-hello'

export function apply() {
  console.info('[example-hello] ready')
}
```

在示例目录运行 `npm pack --dry-run`，核对入口和 patch，随后运行 `npm pack`。回到 iPolloWork 根目录，确保 Node.js 24.15+、pnpm 11 和已构建的固定 DSH 可用。首次准备运行 `npm run setup:build`。在专用 PowerShell 窗口中执行，替换 `$archive` 为生成包的实际绝对路径。

```powershell
$archive = 'C:\path\to\dsh-example-hello-0.1.0.tgz'
$testDir = Join-Path ([IO.Path]::GetTempPath()) "ipollo-plugin-qa-$([guid]::NewGuid())"
$env:DSH_HOME = (New-Item -ItemType Directory -Path $testDir).FullName
$dsh = '.upstream/dsh/apps/cli/lib/bin.js'
node $dsh plugin --profile web add $archive
if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed' }
node $dsh --profile web
```

确认启动输出出现 `[example-hello] ready`，从启动输出的本地地址打开客户端，在插件管理页核对包名、版本和组件。停用后确认组件退出，重新启用后确认它能恢复。用完停止本次 Host 并关闭专用终端。改动涉及套件提供的扩展时，在同样隔离的环境中用 `npm run build` 和 `npm start -- --profile web` 验证 iPolloWork 组合。

迭代源码可在同一个临时 profile 用 `node $dsh plugin --profile web add 'link:C:/absolute/path/to/plugin'`。链接包仍需先构建。若未启用 HMR 或 DSH 提示重启，重启该 profile 以加载新的 Host 产物。交付前另装实际 `.tgz`，检查包内文件和依赖解析。

## 分发与验收

- **独立交付**。在目标包目录执行该包声明的检查命令（通常为 `npm run check`、`npm run pack:check`）和 `npm pack`。保存 `.tgz`、版本、SHA-256、目标 DSH 版本与验收记录。在仓库根目录运行 `npm test`、`npm run check:upstream` 与 `git diff --check`。根目录的 `npm run package:plugin` 专用于 `@ipollo/dsh-suite`，会生成套件包和 `dist/plugin-release.json`。
- **上架精选市场**。在 [format-1 目录](../plugins/ipollowork-suite/catalog/index.json)中写入包名、显示信息和具体版本，`engines.dsh` 与包一致。npm 来源解析为指定版本，Git 来源固定提交与包所在子目录。只有选择随默认目录分发包时，才同步维护 [bundled-releases.json](../plugins/ipollowork-suite/catalog/bundled-releases.json)的包名、版本、文件、SHA-256 以及套件发货清单。安装确认、状态和启停由原生 Plugin Manager 管理。
- **组织分发**。提交确切的 DSH 包名和版本，由组织管理员审核发布并授予访问。成员从原生管理器检查来源并确认安装，再按需启用。参考[组织资源](../plugins/ipollowork-suite/docs/enterprise-assets.md)。
- **随桌面安装包分发**。仅对产品明确要求内置的能力调整[桌面打包](../integrations/desktop/scripts/pack-local-packages.ts)和组合，随后验证已打包客户端。npm、市场、组织和桌面发版分别按目标渠道执行，上传或公开发布须有用户授权。

| 验收项 | 通过条件 |
| --- | --- |
| 安装、启停和卸载 | 隔离环境从实际 `.tgz` 安装，原生管理页能识别。反复启停行为一致，卸载后已注册能力被撤销。 |
| 功能和权限 | 从真实入口完成主流程，按功能验证未登录、无权限、只读或跨工作区的拒绝结果。 |
| 升级和兼容 | 更新已有版本后确认配置、数据和用户工作仍可用。记录测试过的 DSH 版本和平台，按实际结果声明兼容。 |
| 界面或原生系统能力 | 在目标 Web 或 Electron 客户端验证重开、主题和窄屏。用到文件、录制或原生 helper 时，在目标系统上验收。 |

记录实际执行的命令和结果。包检查、单元测试、真实客户端验收分别提供对应范围的证据。

在项目中使用 AI 开发、修改、迁移、评审、打包或集成插件时，[仓库指令](../AGENTS.md)要求先读取并遵守 [插件开发 Skill](../.agents/skills/ipollowork-plugin-development/SKILL.md)。人工开发和评审按同一规范验收。
