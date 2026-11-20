---
name: ipollowork-plugin-development
description: 为 iPolloWork 设计、开发、迁移、审查、打包或验收原生 DeepSeek Harness 插件。Use for iPolloWork DSH Bundles, Host tools, Client slots, installable Skills, plugin migration, packaging and marketplace integration.
---

# iPolloWork 插件开发

定位当前 iPolloWork 检出的根目录，读取 `AGENTS.md` 和目标包的子目录指令。先查 [插件开发规范](../../../docs/plugin-development.zh.md)、当前 `integrations/runtime/upstream.json` 的固定版本及目标包的发布脚本。使用对应 pin 的公开 API 和本仓库中的实际调用点。如果本机有多个 iPolloWork 检出，通过 Git 根目录和目标分支确定工作位置。

## 确定扩展点

- 只有工作指令时编写 `SKILL.md`。需要通过插件管理器安装时，为它添加小型 Bundle 和生命周期内的 `ctx.skills.register`。参照[操作录制](../../../plugins/operation-recorder/README.zh.md)的 Skill 导出。
- 工具、路由和服务放在 Host。需要界面再添加 `./client`、`dsh.client` 与原生 slots。参照[数据标注](../../../plugins/data-annotation/README.zh.md)的独立工作台或 [Stage](../../../plugins/stage/README.zh.md)的 Host/Client 接入。接入现有 MCP 优先复用原生连接管理。
- 迁移旧版包时，先核对需要保留的行为、配置和数据，再把旧入口换成原生 DSH Bundle。保留宿主 loader、Plugin Manager 和 Agent 运行时，通过插件或独立服务扩展。缺少公开扩展点时说明对需求的影响。

## 遵守 DSH 设计

- 用 pin 中的公开 Cordis 服务、Client slots 和类型接入宿主。遵循原生生命周期、认证和数据所有权。涉及 DSH 管理的能力时，复用原生入口及其权限和状态。
- 开发或审查 Client UI 前，读取 `.upstream/dsh/.agents/skills/dsh-client-ui-ux/SKILL.md` 及本次涉及的参考；缺少本地源码时按仓库说明准备固定版本。先找同场景的 DSH 原生页面，复用公开组件、语义主题 token 和交互。设置、侧栏、弹层、错误提示使用原生扩展点和反馈方式。样式限定在插件内并能随停用撤销。
- 在真实宿主页面检查功能和相邻元素，覆盖明暗主题、窄容器、长文本、键盘焦点及本次影响的加载、禁用和失败状态。产品工作台可保留自己的内容设计，嵌入的导航、窗口间距、宿主主题和弹层交互仍遵守 DSH。

## 实现并交付

1. 对既有插件沿用其包名和组件 ID。仓库内新建独立插件使用 `plugins/<slug>/`。使用 ESM、严格 TypeScript、`package.json` 的 `exports` 和 `dsh.bundle.patch`。检查 patch 组件指向真实入口，按 pin 确认运行时约束、服务注入和最终发货文件。
2. 从正常入口接通用户流程。将注册和资源释放绑定 Cordis 生命周期。Host 执行身份、工作区和读写校验。凭据通过原生提供方或既有服务管理。产品改动引入新的上游依赖时，更新 [DSH 兼容性记录](../../../integrations/runtime/compatibility.zh.md)的两个语言版本。
3. 运行目标包已有的构建与检查，再用 `npm pack --dry-run` 检查发货文件。需要安装包时，从该包目录执行 `npm pack` 并记录 SHA-256。根目录 `npm run package:plugin` 是 Suite 专用命令。依赖缺失时先按目标包 README 准备固定 DSH 并建立所需链接。
4. 使用独立 `DSH_HOME` 安装实际 `.tgz`，验证主流程、启停和卸载。按改动验证未授权、工作区隔离、旧版数据、升级及目标客户端。按仓库指令运行根目录检查，报告真实验证结果与未验证范围。
5. 按请求交付源码、包和必要的安装说明。按目标分发渠道更新对应的市场目录、组织发布资料或桌面组合。获得用户授权后再安装到日常 profile、公开上架或上传。
