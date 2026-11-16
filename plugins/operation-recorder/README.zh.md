# 操作录制

[English](README.md) | 中文

独立 DSH 插件 `@ipollo/dsh-operation-recorder`，迁移自多引擎 iPolloWork 录制器 0.3.0。保留语义桌面采集、暂停继续、历史记录、Chrome Recorder 导入、脱敏、步骤编辑、确定性 Skill 编译与导出。不需要模型 Key，不增加第二套 Agent。

## 构建与安装

运行 `npm ci --legacy-peer-deps`，仓库开发再运行 `npm run link:workspace`，随后运行 `npm run check`、`npm run pack:check`、`npm pack`。先构建根目录的官方运行时。完整原生构建需要 Go 1.26；macOS 通用采集器还需 Swift 6/Xcode 命令行工具。安装包自带采集器，用户无需编译器。使用 `dsh plugin --profile <profile> add /绝对路径/ipollo-dsh-operation-recorder-0.2.0.tgz` 安装，先核对目标 profile。

打开侧栏“操作录制”，选择已有 DSH 工作区，再打开工作台。录制需要明确的系统权限。Windows 使用 UI Automation 和被动 hooks，Linux X11 使用 XRecord/AT-SPI，macOS 使用辅助功能/CGEventTap。Wayland 提供 Chrome Recorder 导入，不支持完整桌面采集。旧版真实采集验证的限制仍然存在，交叉编译和 mock 测试不能证明每个平台的真实输入采集。

`ipollo_recorder` 提供 `status`、`review`、`import-chrome`、`compile`，参数放在 `input`；只读会话拒绝写入。采集和权限申请由用户工作台发起。“AI 提炼”打开原生 DSH 会话并填入未发送草稿，保留已有文字，由用户检查后发送。生成的 `.tgz` 是独立 DSH Skill 插件，包含 `package.json`、`cordis.patch.yml`、生命周期注册、`SKILL.md`、`references/workflow.json`，可使用同一个官方安装命令。导出草稿不代表重放成功或人工审核通过。

记录位于 `<工作区>/.ipollowork/plugins/operation-recorder/workspaces/<工作区哈希>`。不自动移动、删除旧录制数据，Chrome JSON 仍可导入。停用时释放 HTTP 服务及采集子进程，卸载保留记录。工作台要求 DSH 所有者认证，服务凭据留在 Host；此边界不能隔离任意 shell 或其他 Host 插件。

`npm run check` 检查输入脱敏、导入、递增版本导出、工作区隔离、符号链接拒绝、原生采集器 mock 和服务释放。还需真实 DSH 客户端及真实平台采集验证。许可见 `LICENSE`、`NOTICE.txt`、`native/THIRD-PARTY-NOTICES.txt`。

## 0.2 证据与提炼改进

新增可选操作目标、录制质量提示（目标不明、缺少完成条件、空录制或尚未结束）、`prepare` 精简证据及 `events` 分页读取。AI 调用 compile 必须提供最新 `expectedRevision`，不能替用户标记人工批准。最新导出会持久保存，重开工作台可恢复；证据变化后旧导出失效。安装包新增 `references/evidence.json`、`evals/evals.json`，验收用例明确为 `not_run`，不编造缺失的断言。继续使用工作区内插件文件，不新增数据库或服务。

研究来源：[humblebanana/dsh-record-replay](https://github.com/humblebanana/dsh-record-replay/tree/32d06f7db906914e278d1552728d1d63f191d6ad) 将证据校验、准备、技能编写分开；[kangshifu1/dsh-record-replay](https://github.com/kangshifu1/dsh-record-replay/tree/e1015e57a4f815dba5f4776f6ae9d969a3e25ddf) 使用录屏帧生成技能。本次检查了源码，未复制其运行时或安装到日常配置。此版强化已有语义录制，不宣称新增视频录屏、自动重放或已验证社区插件兼容 rc.3。macOS 对辅助功能角色不完整的自定义编辑器增加可打印物理键的输入意图捕获，不读取输入字符；无名称目标仍需真实证据或用户说明。
