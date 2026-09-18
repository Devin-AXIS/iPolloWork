# iPolloWork Sidebar Layout Management

## Goal

让用户可以在 iPolloWork 侧栏中手动排列项目，并把 Session 归类到另一个侧栏项目，同时保持 Session 的真实引擎工作目录和历史记录不变。

## Scope

- 项目排序、Session 排序和 Session 侧栏归类仅属于本地 UI 布局状态。
- Session 的 OpenCode/Codex Harness/DeepSeek Harness 归属、cwd、消息历史和项目文件不被改写。
- 拖动项目到项目之间改变项目显示顺序。
- 拖动 Session 到另一个项目行改变其侧栏显示归类。
- 拖动 Session 到同一项目中的另一个 Session 行改变根 Session 的显示顺序。
- 已归档 Session 从项目树中剥离，汇总到独立的“已归档”分类，并保持原项目操作归属。
- 不新增虚拟文件夹创建功能；现有 Workspace 项目行作为可投放的侧栏容器。

## Persistence and safety

- 使用单独的 Zustand persisted store，localStorage key 为 `ipollowork.react.sidebarLayout.v1`。
- 布局按 `workContextId` 隔离；Personal 使用 `personal` 作为 key。
- Session identity 使用 `sourceWorkspaceId/sessionId`，避免不同引擎或远程 Workspace 出现同 ID 碰撞。
- 刷新时只保留当前存在的项目和 Session；失效的排序/归类记录自动丢弃。
- 归档 Session 不参与项目侧栏归类；归档分类按原始 Workspace 汇总展示，并复用项目 Session 的行布局。
- 删除项目或 Session 不删除布局记录以外的任何数据；下次清理时再丢弃失效记录。

## Interaction contract

- 项目行和 Session 行设置 `draggable`，拖动时使用明确的 `dataTransfer` payload。
- 项目行接受项目拖放并显示目标高亮；Session 行接受 Session 拖放并显示目标高亮。
- 点击、重命名、归档、删除和展开行为不因拖动支持而改变。
- 归档分类独立折叠，不随项目分类折叠；归档/恢复操作仍使用原始 Workspace ID。
- Session 打开、重命名、归档、删除始终使用其原始 Workspace ID，而不是侧栏显示容器的 Workspace ID。
- 侧栏只在用户完成 drop 后写入布局 store；dragover 只阻止默认行为并更新临时高亮。

## Non-goals

- 不移动 `.opencode`、Codex Harness 或 DeepSeek Harness 的底层数据文件。
- 不修改服务端 Session API 或引擎协议。
- 不声称完成真实的跨项目 Session 迁移；该能力需要另一个引擎级迁移方案。
