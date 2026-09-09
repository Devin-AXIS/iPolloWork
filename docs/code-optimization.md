# iPolloWork 代码优化准备与方案

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
