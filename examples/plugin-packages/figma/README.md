# Figma for iPolloWork

这是面向普通用户的一体化 Figma 插件包。安装一次后，iPolloWork 会同时注册 Figma 官方 Desktop MCP、完整工作流 Skills、快捷命令和专用 Agents。账号登录由 Figma 桌面应用独立管理，iPolloWork 不复用其他客户端的授权，也不要求用户在对话中粘贴 Token。

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
3. 在 Figma 桌面应用中打开一个 Design 文件，并确认登录的是你要使用的账号。
4. 切换到 Dev Mode，在 Inspect 面板的 MCP server 区域点击“Enable desktop MCP server”。
5. 回到 iPolloWork 重新加载引擎；Figma 状态变为已连接后，新建对话并粘贴带 `node-id` 的 Figma 链接。

Desktop MCP 使用 Figma 官方地址 `http://127.0.0.1:3845/mcp`。它只监听本机，账号和会话仍由 Figma 桌面应用持有；iPolloWork 不保存 Figma OAuth 凭据。

## 目录

- `ipollowork.plugin.json`：iPolloWork 插件清单
- `.opencode/mcps/figma.json`：Figma 官方 Desktop MCP
- `.opencode/skills/`：Figma 官方工作流 Skills 及引用资料
- `.opencode/commands/`：常用快捷命令
- `.opencode/agents/`：专项执行与审查 Agents
- `assets/`：展示资源

## 来源与限制

工作流材料同步自 [openai/plugins 的 Figma 插件](https://github.com/openai/plugins/tree/main/plugins/figma)，上游提交为 `11c74d6ba24d3a6d48f54a194cd00ef3beea18f9`，上游插件版本为 `2.0.16`；iPolloWork bundle `2.0.17` 仅补充双语展示元数据。

Figma MCP 当前处于 Beta，部分写入能力要求 Full seat 和目标文件编辑权限。Figma 的远程 MCP 只接受其 MCP 目录中的客户端；在 iPolloWork 获得远程客户端准入前，本插件使用官方 Desktop MCP，避免触发不受支持的远程 OAuth 客户端注册。

使用本插件中的 Figma 工作流材料即受 `LICENSE.txt` 所述 Figma Developer Terms 约束。
