# iPolloWork 代码优化准备与方案

当前进度：第一批在独立分支 `codex/ponytail-batch-1` 实施；范围、验证记录与第二批详细方案见文末。以下基线数据来自准备阶段，不是本次优化后的性能测量。

检查日期：2026-09-08。基线为本地 `Jovan` 分支的 `6aae245d143613454f99c8b13d70b1db0fddddf8`；检查开始时工作区干净，较已有远程跟踪引用领先 10 个提交，未刷新远程状态。本次完成技能安装、环境准备、基线检查和优化规划，未修改应用实现。

准备期间工作区中有其他工作新增两次提交，结束时 HEAD 为 `520937ac26b66ccd2e9d20e8f85cddc88cb074ae`，领先 12 个提交。已核对这段差异仅涉及 `evals/flows/video-console.flow.mjs`，不涉及本轮类型检查、定向测试和构建所覆盖的应用实现；保留这些提交，正式优化前重新固定当时的 HEAD。

## 已安装的 Ponytail 技能

来源为 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)，固定版本为 `356918eba965ee1eac64bd3a7f0dd02108350de5`。通过 Codex 的 skill-installer 下载，四个文件均与该提交的 Git blob 校验一致。

| 技能 | 本地目录 | 后续用途 |
| --- | --- | --- |
| `ponytail` | `C:\Users\31939\.codex\skills\ponytail` | 编写和重构时优先复用、使用原生能力、减少不必要代码 |
| `ponytail-review` | `C:\Users\31939\.codex\skills\ponytail-review` | 复查一批改动是否引入多余复杂度 |
| `ponytail-audit` | `C:\Users\31939\.codex\skills\ponytail-audit` | 查找仓库中过度设计的候选项，仅报告 |
| `ponytail-debt` | `C:\Users\31939\.codex\skills\ponytail-debt` | 汇总未来代码中的 `ponytail:` 延后处理标记 |

这是技能文件安装；未安装自动运行的插件 hooks，不需要新增 API Key 或后台服务。下一个对话回合可以显式要求使用 `$ponytail`。安装来源、SHA-256 和 Git blob 信息保存在本地 `.ipollowork-dev/ponytail-baseline/installation.json`；原仓库 MIT 许可证保存在同目录的 `PONYTAIL-LICENSE`。

建议使用 `full` 强度，以不改变现有产品行为为前提。Ponytail 的 review/audit 只覆盖复杂度；正确性、性能和边界验证继续遵循仓库的 `.codex/skills/ipollowork-maintainable-code/SKILL.md`。不把技能宣传的代码节省比例作为本项目收益承诺。

## 本地工具与使用方式

| 工具 | 检查结果 |
| --- | --- |
| Node.js | 系统默认 `22.22.1`，符合 Windows 文档的 22+ 要求；已有可用的 bundled Node `24.19.0`，可对齐 `.nvmrc` 的 24 |
| pnpm | `11.4.0`，匹配根目录 `packageManager` |
| Bun | `1.3.14`，已运行前后端定向测试 |
| Git | `2.54.0.windows.1` |
| 项目依赖 | 已有 `node_modules`；类型检查和 UI 构建可运行，没有重装依赖或改动锁文件 |
| Knip | 已有 `6.29.0`；设置 `KNIP_DISABLE_RAW_TRANSFER=1` 后可完成扫描 |

从当前项目根目录执行：

```powershell
. .\.ipollowork-dev\ponytail-env.ps1
node --version
pnpm --version
```

此脚本只对当前 PowerShell 会话设置 Node 24 路径、pnpm 启动函数和 Knip 兼容开关。关闭该终端即结束这些设置，不修改系统默认 Node 或用户配置。脚本使用本机已有工具的绝对路径；换机器需按新环境调整。

Knip 默认模式在本机 Node 22 和 Node 24 都报 `RangeError: Array buffer allocation failed`。项目安装版本在 `knip/dist/typescript/ast-nodes.js` 中提供上述开关，可关闭 OXC 的实验性 raw transfer 路径，无需修改第三方源码。

## 已执行的基线验证

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @ipollowork/app typecheck` | 通过 |
| `pnpm --filter ipollowork-server typecheck` | 通过 |
| `pnpm --filter @ipollowork/desktop typecheck:electron` | 通过 |
| `pnpm --filter ipollowork-orchestrator typecheck` | 通过 |
| App 的侧栏、活动状态、拖拽尺寸相关测试，4 个文件 | 43 通过，0 失败 |
| Server 的导出安全、commands、skills 测试，3 个文件 | 9 通过，0 失败 |
| `pnpm --filter @ipollowork/desktop test` | 147 通过，0 失败，3 跳过 |
| 使用 Node 24 执行 `pnpm --filter @ipollowork/app build` | 通过；Vite 报告构建时间 1m 24s |
| Knip 对 App 执行 production 扫描，兼容模式 | 完成并返回候选项；退出码 1 表示存在报告项，stderr 为空 |
| `node scripts/i18n-audit.mjs --unused` | 执行完成，报告 794 个可能未使用的英文 key |

定向测试的复现命令：

```powershell
pnpm --dir apps/app exec bun test --isolate tests/sidebar-projects.test.ts tests/sidebar-primary-actions.test.ts tests/session-activity-store.test.ts tests/workspace-resize-performance.test.ts
pnpm --dir apps/server exec bun test src/workspace-export-safety.test.ts src/commands.test.ts src/skills.test.ts
```

构建基线：`app-CyWX3UxP.js` 为 **8,966.94 kB，gzip 1,875.48 kB**。这是本次主应用 chunk 的大小，不等于启动耗时或全部网络传输量。后续必须测量相同场景的加载和渲染时间，才能判断用户体验收益。

构建还报告两类分包冲突：`jszip` 以及 `design-system-registry.ts` 同时被静态和动态导入，现有动态导入不能将它们独立拆走；另有两处 `use memo` 指令被忽略的提示。应检查编译链和实际产物后决定处理方式。

Knip 候选项涉及 357 个文件：176 个文件项、453 个导出项、254 个类型项、4 个重复导出项，没有报告未声明或无法解析的依赖。**这些数字不能直接当成可删除数量**：production 模式会排除开发用途，报告中就有仍被包脚本使用的工具；需补全入口、验证动态引用及跨包使用后逐项确认。翻译 key 也须核对动态拼接和插件调用。

原始构建日志、Knip JSON、翻译扫描结果和安装记录保存在 `.ipollowork-dev/ponytail-baseline/`，由现有 `.gitignore` 排除。类型检查和测试结果记录于本次任务输出。本轮没有启动应用交互、访问真实模型或生成 fraimz；纯文档与准备工作按 AGENTS.md 可跳过体验证明，以上结果不代表 UI 端到端已经验证。

## 优化候选项与顺序

| 优先级 | 范围与证据 | 建议动作 | 验收与注意点 |
| --- | --- | --- | --- |
| P1 | `apps/server/src/server.ts:3760`：`commandContents` 的 `async map + Promise.all` 内没有异步操作 | 改为普通 `map`，先做一处小而明确的等价简化 | 导出字段、顺序保持一致；保留前面的技能文件异步读取 |
| P1 | `apps/app/src/app/lib/den.ts:1572`、`ipollowork-server.ts:1039`、`opencode.ts:192` 各有一套 `fetchWithTimeout` | 统一真正相同的超时和资源清理机制，错误翻译、各服务超时策略留在各自边界 | 覆盖成功、超时、调用方取消、已有 signal、fetch 不响应 signal、流式请求；不能直接删除 Promise.race 就宣称等价 |
| P1 | 主应用 chunk 8.97 MB；构建明确提示 JSZip 与设计系统模块的动静态导入冲突 | 追踪入口图，优先使仅在导入、导出、设计面板需要的重功能按需加载 | 比较同一构建命令的主包及加载瀑布，记录首屏和首次打开功能的耗时；PPT/PDF/XLSX 部分依赖已经动态导入，应复用现有边界 |
| P1 | `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx:549` 订阅整个 layout store，`prune` effect 依赖整个 layout；`sidebar-layout-store.ts:167` 序列化三张映射比较 | 缩小订阅和 effect 依赖，检查无变化时能否提前返回 | 用多项目、多会话样本记录渲染次数和 prune 调用；保留顺序持久化、跨项目移动和已有无变化保护，未测量前不宣称卡顿已解决 |
| P2 | PPT 三条导出实现的 `parseColor` / `effectiveOpacity` 相近：`pptx-compatible-export.ts:108`、`pptx-element-export.ts:70`、`pptx-export.ts:121` | 复用同一导出域内的基础逻辑，优先扩展已有 owner | 颜色解析的失败默认值、通道 clamp 有真实差别，先锁定契约；验证透明色、异常色值、继承透明度与实际导出视觉 |
| P2 | `apps/server/src/extensions/media-center.ts:300` 顺序遍历目录，`:1642` 用于媒体资产检查 | 先测目录数量、扫描范围和耗时，优先减少不必要扫描；必要时使用有上限的并发 | 保留 `resolveWorkspaceFile` 路径保护、确定性排序、错误语义；该模块已有 `mapWithConcurrency`，无需引入另一个并发库 |
| P2 | Knip 候选项和 794 个翻译 key | 先修正扫描入口，逐个验证并清理明确失效的导出、旧配置、文案 | 不使用一键删除；保留对插件动态加载、包脚本、国际化拼接和当前受支持兼容模式的覆盖 |
| P2 | 根 `package.json:56` 的 `test:orchestrator` 指向 `test:router`，orchestrator 包没有该脚本 | 明确当前有效的验证入口，修复失效的根命令映射 | 从根目录运行有效检查，避免“命令存在但不验证”的假象；本轮仅确认清单不一致，未修改 |
| P3 | 会话页 5,487 行、session route 3,064 行、设计面板 2,597 行、server 3,936 行、Electron main 4,343 行 | 以重复业务逻辑和职责边界为依据，分批收敛到已有模块 | 文件长只是审查线索，不按行数机械拆文件；不新增通用框架、平行 runtime 或单调用者抽象 |

附加检查：两个 Markdown 渲染器分别位于 `components/markdown/markdown.tsx` 和 `react-app/domains/session/surface/markdown.tsx`，均使用 Shiki/marked。后续可比较纯高亮配置及共用逻辑，但保留各自的消息处理、安全清理和界面差异；不能因为库名相同就整体合并。

## 分批实施方案

1. **小范围试运行**：用 `ponytail full` 完成纯映射简化，作为首个可独立回滚的改动；同步处理验证入口问题时单独成批，避免掩盖逻辑回归。
2. **复用收敛**：请求超时逻辑作为第一项实质重构。先列出现有行为和全部调用方，再提取真正重复的部分。PPT 解析复用另开一批。
3. **性能专项**：先优化入口加载，再根据测量结果处理侧栏订阅和媒体扫描；代码变短和性能变好分别验收。
4. **清理尾项**：校正 Knip 入口后处理确定的死代码与文案，最后再考虑大模块的职责调整。

正式改代码时按仓库要求在独立 worktree/分支进行，明确从哪个本地提交开始；不要从远程默认分支无意丢掉当前基线的本地提交。每批给出行为范围、文件预算、验证命令和结果；默认新增依赖、路由、数据表与状态存储均为零。提取文件仅限已有多个实际消费者且现有 owner 无法清晰承载的场景。

每批完成条件：所属包类型检查、相关行为测试、`git diff --check` 和维护性审计通过；影响可观察行为的改动按 AGENTS.md 生成实际 fraimz 证明。保留输入校验、授权、路径边界、数据防丢失处理、无障碍和当前支持的产品能力。只移除已证明冗余的部分。

后续可直接这样发起：

> 用 $ponytail full，按 docs/code-optimization.md 开始第一批。保持现有行为，先在独立 worktree 中做小范围等价简化，验证后报告 diff 和结果。

## 第一批：工作区命令导出的等价简化

分支：`codex/ponytail-batch-1`。起点：`520937ac26b66ccd2e9d20e8f85cddc88cb074ae`。独立 worktree：`C:\Users\31939\Desktop\ipollo-new\_worktrees\ponytail-batch-1`。原 `Jovan` 工作区保持原样。

在 `apps/server/src/server.ts` 的 `exportWorkspace` 中，原来为每条已经读入内存的 command 创建 Promise，再等待 `Promise.all`。现在在返回对象中使用普通 `map`，显式保留 `name`、`description`、`template` 三个字段。业务实现净减少 8 行；真正需要异步读取的技能文件继续使用原来的异步路径。没有新增依赖、API、状态、业务模块或改变导出格式，不宣称已有可测的启动或网络性能提升。

新增 `evals/flows/workspace-export-commands.flow.mjs`，沿用仓库现有 internal fraimz 模式。它运行真实的本地 HTTP server，使用临时工作区和隔离的 SQLite 文件，完成后关闭服务并清理；没有模拟导出接口或调用真实模型。用一个证明覆盖：

- 空工作区导出空的 commands/skills 数组；无效 token 被拒绝。
- 写入两条命令后，导出顺序与 commands 列表 API 一致；包含和省略 description 的两种情况都保留原行为。
- 中文、多行 template 与技能文件内容完整；agent/model/subtask 等非便携字段不会被意外带入 command 导出。
- 重复导出得到相同的 commands/skills 内容。

验证记录：

| 检查 | 结果 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 新 worktree 依赖安装完成；未下载包、未改变锁文件 |
| `pnpm --filter ipollowork-server typecheck` | 通过 |
| `pnpm --filter ipollowork-server build` | 通过，包含共享 types 与 server 构建 |
| `bun test src/commands.test.ts src/skills.test.ts src/workspace-export-safety.test.ts src/extensions-export.test.ts`（server 目录） | 16 通过、2 失败；两处失败见下文，不能把该测试集合记为全通过 |
| `pnpm fraimz --flow workspace-export-commands` | 真实 HTTP 导出证明通过；最终代码的报告见 `evals/results/ponytail-batch-1/` 下的运行目录 |
| 维护性审计与 `git diff --check` | 通过 |

两个测试失败均发生在 `extensions-export.test.ts` 的非 HTTP `exportExtensions` 用例清理临时 SQLite 目录时，错误为 Windows `EBUSY`。在未修改的原工作区运行 `bun test src/extensions-export.test.ts --test-name-pattern '^exportExtensions'` 同样复现两处失败。现有 HTTP 导出和 bundled plugin tool 用例通过。这是需要单独修复的测试资源清理问题，本批保留记录，不混入业务简化。

此次 fraimz 的验收范围是导出接口契约。没有执行桌面“发送消息 → 回复 → 重开恢复”核心会话流程；不得把接口证明标记为完整桌面体验验收。首次启动 runner 前要完成 server build，因为仓库已有其他 flow 在加载时引用 server 的 dist 产物。

复现最终验证：

```powershell
pnpm --filter ipollowork-server build
pnpm fraimz --flow workspace-export-commands --out evals/results/ponytail-batch-1
node .codex/skills/ipollowork-maintainable-code/scripts/audit-changes.mjs
git diff --check
```

## 第二批：收敛请求超时机制

目标是去掉三套超时机制的重复实现，同时保留现有调用方可观察行为。第二批尚未实施。继续使用 `ponytail full`，从第一批最终提交固定新起点。

### 已核对的实现与策略差别

| 当前 owner | 真实调用路径 | 必须保留的行为 |
| --- | --- | --- |
| `apps/app/src/app/lib/den.ts:1572` | `requestJsonRaw`、`requestBinary` 两处调用 | 默认 12 秒，可由请求覆盖；超时英文错误；其他异常直接向上传递；保留 credentials 和组织路由 |
| `apps/app/src/app/lib/ipollowork-server.ts:1039` | `requestJson`、`requestMultipartRaw`、`requestBinary`、`requestRawJson` 四处调用 | 默认 10 秒，health 3 秒、导入/导出 30 秒、二进制 60 秒等已有分级；图片/视频请求特例保持；保留中文超时提示与 `serviceErrorMessage` |
| `apps/app/src/app/lib/opencode.ts:192` | 桌面 Request 分支、桌面 URL 分支、浏览器 SDK fetch，共三处调用 | 普通默认 10 秒；OAuth 至少 5 分钟、MCP auth 至少 90 秒；session command/prompt_async/summarize 关闭该层超时；保留流式原生 fetch 与现有 URL 策略优先级 |

共同部分是：检查是否启用超时 → 设置 timer/可用的 controller → `Promise.race` → `finally` 清理 timer。

需要特别保护两条边界：

1. `desktop.ts:297` 的非 loopback `desktopFetch` 通过 Electron IPC 转发 method/headers/body，没有传递 AbortSignal；因此仅换成 `AbortSignal.timeout()` 不能替代现有 Promise 截止机制。第二批保留 `Promise.race`，不新增 IPC 取消协议。
2. 现有 helper 在 fetch 返回 Response 后就清理 timer，正文读取位于 helper 外；将超时扩大到响应正文会改变下载和流式语义，本批不做。既有 `init.signal`、`Request.signal` 与超时 controller 的组合还需特征测试确认，不把取消行为修复伪装成等价提取。

### 具体实施步骤与文件预算

1. 先用现有 Bun 测试方式记录三处适配层的行为，覆盖不同输入、错误和超时策略；测试使用可控 fetch，避免依赖网络或真实模型。
2. 在 `apps/app/src/app/lib` 提取一个窄范围 `request-timeout.ts`。没有找到已有兼容的通用超时 owner；三处实际消费者足以支持这次提取。建议只接收 fetch、input、init、timeoutMs 和超时提示，返回 `Promise<Response>`；不引入类、重试框架、缓存或配置系统。
3. Den 复用公共机制；Server 保留本地错误转换，OpenCode 保留 URL 超时策略及 AbortError 转换。公共 helper 不依赖这三个客户端，避免循环引用；transport 选择、headers、鉴权、正文编码继续留在现有模块。
4. 移除三处被取代的 controller/timer/race 代码。对于 signal 组合中确认的行为缺陷，单列带失败用例的后续修复，不在等价提取中顺便改掉。
5. 运行 App 类型检查、定向测试、构建与维护性审计；因公共网络机制会影响真实会话，使用当时可用的正确 checkout 验证本地请求、远程连接与流式会话取消，记录哪些场景已验证。

预计范围：3 个既有客户端模块、1 个公共 helper、最多 1 个有实际行为断言的测试文件，以及更新本文；验证 flow 按已有可用场景复用或扩展。新增依赖、路由、数据表和状态存储均为零。业务模块以减少重复实现为验收目标，不预设强行达到的删行百分比。

### 验收矩阵

| 场景 | 应证明的结果 |
| --- | --- |
| 成功与正常 HTTP 错误响应 | Response/status/body 保持可读取；4xx/5xx 的业务转换仍在原 owner |
| 超时值为 0、负数、NaN、Infinity | 与现有“不启用超时”的分支一致 |
| 超时且 fetch 支持取消 | 外层及时结束，原提示和错误映射保持 |
| fetch 忽略 signal 或 IPC 不响应取消 | 外层仍在截止时间结束，不能永久悬挂 |
| 成功/失败早于 deadline | timer 已清理，不在请求结束后追加 abort 或未处理 rejection |
| 已有 signal、Request 对象、自定义 headers/body、FormData 与二进制上传 | 当前行为先被测试明确记录；提取不丢失请求信息、不改变正文类型，不隐式扩展取消语义 |
| SSE 与长运行 session 路由 | 保留原生 fetch 和已有超时豁免，订阅卸载仍可取消 |
| OAuth、MCP auth、图片视频请求 | 维持长超时和策略顺序，不能统一压成默认 10 秒 |
| 分层错误提示 | Den/OpenCode 英文与 Server 中文、`serviceErrorMessage` 路径保持 |

第二批后续独立事项：修复上述 Windows 测试资源释放，以及根 `test:orchestrator` 指向不存在的 `test:router`。已检查 orchestrator 当前没有该 test 脚本，不能把它简单替换成 typecheck 后继续叫“测试通过”；需先明确有效测试入口，或移除失效命令并同步使用说明。这两项与请求机制重构分开验证和提交。
