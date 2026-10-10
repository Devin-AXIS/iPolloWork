---
name: ipollowork-plugin-ui
description: 为 iPolloWork 新插件或插件工作区选择可复用 UI 组件与交互规范。按 Figma 成熟状态和代码清单优先采用已确认组件，区分宿主 React 与独立 HTML/iframe 的接入方式；适用于插件表单、导航、浮层、反馈、状态和进度设计及实现。
---

# iPolloWork 插件 UI

从用户要完成的操作选择组件。默认采用“已实现与推荐使用”，保持明确的当前值、反馈位置、恢复动作和键盘焦点。

## 先确定运行环境

- **宿主 React 页面**：从 `apps/app/src/components/ui` 导入基础控件；`@/` 是主应用别名。业务组合参考现有调用，不把领域内部组件作为插件公开 API。
- **独立 HTML / iframe / 独立构建的 React 插件**：读取 [插件接入契约](references/plugin-contract.md)。主应用别名和 CSS 不会自动进入 iframe；采用现有插件的桥接方式与相同交互语义。独立 React 构建也不能假定能导入宿主组件。
- 共享实现位于已有 `@ipollowork/ui` 包，公开 Button、Input、Textarea、Select、Dialog、Toaster / toast。其余组件不可据此推断已进入插件运行时；新增三组通过 React 岛接入 HTML，不提供原生 HTML 标记适配。

## 固定接入规则 · v1

实施插件前必须读取 [插件接入契约](references/plugin-contract.md) 的公共入口、构建/注入和版本章节，按以下边界选择：

- 宿主 React 使用原有 `@/components/ui/*` 入口；共享包控件入口为 `@ipollowork/ui/controls`。
- iframe 插件只从 `@ipollowork/ui/runtime-contract` 导入 `requireRuntime(1)`；实际 React/控件从返回的运行时对象取得。不要从 `plugin-runtime` 或宿主私有路径导入实现，也不要给生产插件再打包 React。
- 开发构建显式选择 `buildPluginRuntime('bundled')`，将运行时放在业务脚本之前；生产包不包含运行时，保留契约中的固定 meta 标记，由宿主注入。不能仅凭 `NODE_ENV` 推断加载方式。
- 当前运行时版本为 `1.1.0`。使用新增组件时调用 `requireRuntime(1, required)`，required 必须列出实际使用的全部函数导出（包括 SelectTrigger、DialogContent 等子组件），逐项检查函数能力；旧1.x缺组件时停止初始化并提示更新客户端。仍不支持完整 semver 范围、最低 minor 或 manifest UI 版本协商，也不自动下载另一份组件库。

代码已整合到本地 Carrie；真实 Electron 开发客户端的内置安装、宿主注入、保存恢复及重新打开已有证据。签名包上传、打包客户端和跨客户端版本升级未验收，也未发布。推荐目录的 62 个条目不等于运行时已提供 62 个组件。

## 选择顺序与证据

读取 [组件目录](references/component-catalog.md) 中任务涉及的条目，然后打开真实源码、导出和调用场景。

1. **推荐**：默认复用对应代码；推荐范围以清单中的证据为限。
2. **待验证**：已有实现，先检查清单中的缺陷和边界。已复现缺陷不得默认采用；需要修复并重跑对应失败回归。没有已知缺陷时，场景匹配才可采用，并补齐本次使用的状态、主题、键盘和恢复验证。
3. **候选**：Figma 设计或待统一模式；先明确交互和代码接入，再验证。不要以存在设计稿推断存在公共组件。
4. **历史**：使用替代入口；兼容封装的迁移范围由实际调用决定。

Figma 状态页展示现有组件实例副本；主组件留在完整目录。查看设计时按需读取链接，避免把未确认的最新编辑自动升级为强制规范。源码与设计发生差异时记录双方依据，并解决影响本次任务的差异。

首批共享控件身份读取 [组件映射](references/component-mapping.json)：主组件 ID、源码、包导出与原生 HTML 标记一一对应。此清单是 Code Connect 不可用时的仓库契约，不是假冒 Code Connect 发布记录。

## 交互约束

完整产品规则读取仓库 `docs/interaction-guidelines.zh-CN.md` 中相关章节；`docs/client-interactions.zh-CN.md` 描述现状。遵守以下默认决策：

- 表单组合 `FieldLabel → 控件 → FieldDescription / FieldError`；标签不能只靠 placeholder。错误关联字段并设置 `aria-invalid`，提交失败保留输入。
- 普通单选用 Select，需要搜索用 Autocomplete，少量需要比较的选项用 RadioGroup，多选用 Checkbox，即时开关用 Switch，工具模式用 ToggleGroup，内容切换用 Tabs。
- 局部轻量操作用 Popover，短表单用 Dialog，长编辑用 Sheet，高风险确认优先复用 ConfirmModal / AlertDialog。关闭恢复焦点；丢弃草稿说明后果。
- 短操作反馈用 Toast；字段错误、预览失败、等待授权、长期任务状态在原位置持续显示。成功 Toast 不替代交付验收。
- 预览覆盖加载、空、可用、失败；刷新尽量保留上一份可用内容，失败就地重试。
- 分清执行状态和工作项状态：执行已结束不等于已验收；只有用户确认后才标为已验收。
- 真实数值才报告真实百分比；预计值显式标“预计”，不能单凭计时完成任务；无法估算时用不定进度或阶段文案。
- 默认复用现有尺寸和主题。普通 Input / Button 默认 32px，主动作可使用已有 36px 大尺寸；设置作用域 Button 为 28px，沿用现有 Provider。尺寸由源码决定，避免每页重新覆盖。
- 使用文字、图标或可访问名称表达状态；验证窄容器、长文案、亮暗主题与键盘使用。

## 实施与完成

按仓库 `AGENTS.md` 的演示、隔离工作区和真实体验验证流程完成可见实现；代码变更使用 `ipollowork-maintainable-code`，本 Skill 不重复定义代码质量规则。

检查实际控件状态、选择值、关闭与焦点、异步失败后的输入保留、重试、宿主主题更新和容器缩放。生成真实体验证据；夹具、模拟传输和真实服务链路分别报告。

本 Skill 文档更新本身可做结构、路径和链接检查；文档通过不表示插件已接入或运行验收通过。

## 维护

组件晋升时同时更新代码位置、Figma 状态页、清单和验证范围。主组件视觉在 Figma 完整目录维护；状态页元数据和本地目录为核对快照，不具备自动同步。新增公共组件必须有真实需求；候选库可持续编辑。
