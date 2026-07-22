# Figma for iPolloWork

这是面向普通用户的一体化 Figma 插件包。安装一次后，iPolloWork 会同时注册 Figma 官方远程 MCP、完整工作流 Skills、快捷命令和专用 Agents；Figma 登录由 MCP OAuth 管理并持久化，用户不需要在对话中粘贴 Token。

## 能力

- 从 Figma 设计生成符合现有项目规范的代码
- 截图、读取变量、组件、布局和设计上下文
- Code Connect 映射与模板生成
- 创建和维护设计系统、组件库、变量与语义 Token
- 向 Figma、FigJam 和 Slides 写入原生内容
- 设计与实现的视觉一致性检查
- SwiftUI、动效、流程图和演示文稿专项工作流

## 安装和登录

1. 打开 iPolloWork 的“扩展”。
2. 展开“开发者：安装本地插件包”，选择本目录。
3. 安装后，在 MCP 应用列表中选择 Figma 并点击“登录”。
4. 在浏览器完成 Figma OAuth，然后回到 iPolloWork。
5. 新建对话，粘贴带 `node-id` 的 Figma 链接并描述任务。

远程 MCP 使用 `https://mcp.figma.com/mcp`。OAuth 凭据由 OpenCode MCP 运行时保存，不写入项目文件，也不使用 iPolloWork 的全局环境变量。

## 目录

- `ipollowork.plugin.json`：iPolloWork 插件清单
- `.opencode/mcps/figma.json`：Figma 官方远程 MCP
- `.opencode/skills/`：Figma 官方工作流 Skills 及引用资料
- `.opencode/commands/`：常用快捷命令
- `.opencode/agents/`：专项执行与审查 Agents
- `assets/`：展示资源

## 来源与限制

工作流材料同步自 [openai/plugins 的 Figma 插件](https://github.com/openai/plugins/tree/main/plugins/figma)，上游提交为 `11c74d6ba24d3a6d48f54a194cd00ef3beea18f9`，插件版本为 `2.0.13`。

Figma 远程 MCP 当前处于 Beta，部分写入能力要求 Full seat 和目标文件编辑权限。Figma 还限制可连接远程 MCP 的客户端范围；如果 OAuth 页面拒绝当前客户端，需要由 iPolloWork/Figma 完成客户端目录准入，不能通过在插件中内置密钥绕过。

使用本插件中的 Figma 工作流材料即受 `LICENSE.txt` 所述 Figma Developer Terms 约束。
