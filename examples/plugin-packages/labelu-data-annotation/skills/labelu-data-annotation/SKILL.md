---
name: labelu-data-annotation
description: Use host MCP extension actions to create, inspect, annotate, review and export local multimodal projects.
---

# 数据标注工作流

通过主软件已有 MCP 工具使用插件：先用 ipollowork_extension_list_actions 查询 extensionId 为 labelu-data-annotation 的动作与 inputSchema，再用 ipollowork_extension_call，传 extensionId、action、args。工作区由主软件上下文提供，不能用 args 指定其他目录。无需另起 MCP server。

## 打开和查看

优先使用主软件左侧“数据标注”入口；程序集成可调用 open-workbench，将返回 url 交给内置浏览器，不在对话中输出带令牌 URL。首页默认标注员，只在首页切换工作角色，详情沿用角色。角色是本机工作模式，不是账号权限。

list-projects 列出最多 100 条最近记录（默认 25）；get-project 读取完整记录。目标不明确时先列表，不猜 projectId。只读取已保存数据，不把未保存的画布当作已完成结果。

## 创建与标注

- list-training-templates 获取模板 id，再 create-training-project 创建带素材的独立项目；每次调用新建一条记录。
- create-text-project 用用户提供的 textContent 和可选 title 创建文字项目；不自动添加示例标记。
- 用户要求修改时先 get-project，再 update-project，传 projectId、expectedRevision、完整 annotations，可选 textContent。annotations 为全量替换，必须保留不修改的标记；原生坐标/时间/属性结构不改变。文字 spans 的 start/end 是 JavaScript UTF-16 下标，end 不包含在区间内，text 应与正文切片一致。片段 segment 与关键帧 frame 的单位为秒，名称和描述放在 attributes.标记名称 / attributes.描述。
- update-project-labels 接收完整 labels 数组（name、#RRGGBB color）及可选 replacements（旧名称到新名称）。删除已用标签必须提供替代；顺序按数组顺序。
- 上传自己的图片、音视频或提取 PDF/Word/TXT 仍走工作台现有上传流程。本版 MCP 不提供任意本地路径读取、二进制上传或远程下载动作。通过工作台导入后可用 MCP 继续管理。

## 审核、导出和删除

仅在用户要求审核时调用 review-project，明确 status 为 approved 或 rejected，并带最新 expectedRevision；退回必须 comment，不能通过空标注。MCP 审核不依赖也不改变界面当前角色，不以“能调用接口”等同于“用户已要求通过”。

export-project 只返回当前版本已审核通过的 JSON 对象，不自动写文件或传送到外部；用户要求保存文件时用主软件文件工具保存该返回对象。包含正文、标注、标签、版本和审核结果，不包含媒体二进制或会话令牌。

仅在用户明确要求删除目标记录时调用 delete-project，带 projectId 和最新 expectedRevision；只删除记录，保留素材。不要因创建调用超时而盲目重试，也不要代替用户自动清理记录。

所有更新先读版本。冲突后重新读取并核对用户意图，不能只是换成新版本号再次覆盖。内容、标签或标注发生改变会恢复待审核；保存相同内容不会撤销审核。MCP 修改标记 updateSource: ai。界面打开的旧版本不会被静默替换，回首页刷新记录并重开可看到新结果。

接口表、返回值及调用示例见插件 README.md 的“主软件 MCP 接口”一节。
