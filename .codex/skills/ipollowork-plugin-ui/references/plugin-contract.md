# 插件工作区接入契约

适用于独立 HTML、iframe 和插件自己的 React 构建。核对日期：2026-10-09。

## 现有入口

宿主桥接：`apps/app/src/react-app/plugin-ui/workspace-app-frame.tsx`。
参考插件：`examples/plugin-packages/short-video-studio/src/bridge.mjs` 与 `workspace-theme.mjs`；真实 HTML 交互参考 `examples/plugin-packages/media-studio/ui/image-studio.html`。

使用目标插件现有初始化与 host-context 更新流程。宿主会提供 theme、locale 和 containerDimensions，并监听主题、语言、尺寸变化；检查实际插件契约后接入，不凭此文档臆造事件名或全局接口。

## 主题与 Token

- iframe 不自动继承宿主 CSS。读取初始主题和后续主题更新；只有主题字段存在时才修改当前主题，其他上下文更新保留主题。
- 本地 CSS 使用语义变量表达背景、表面、文字、次要文字、边框、选中、强调和危险状态。变量名沿用插件已有约定；将值与宿主视觉规范对齐。
- `--sv-*` 是短视频插件现有局部 Token，不是所有插件的公共 SDK。产物中的 `--ipw-*` 设计 Token 也不能直接等同宿主 UI Token。
- 宿主亮暗主题变化只影响插件操作界面，保留用户产物自身的配色和导出结果。
- 当前没有因本 Skill 新增共享 UI 包。只有明确的多个消费者需要相同实现时，再按仓库边界考虑提取。

## 行为

独立插件保留同一字段标签、错误关联、提交中状态和输入恢复规则。弹层需处理焦点、Escape、关闭后返回入口；考虑 iframe 边界造成的裁切，用宿主容器尺寸检验窄宽度。

使用插件已支持的宿主能力进行打开链接、发送上下文或展示模式切换。页面按钮不能直接操纵宿主 DOM，也不能仅凭 Figma 展示推断宿主 API 可用。异步操作的最终状态来自真实结果。

首次接入优先验证一条完整小流程：填写 → 选择 → 提交中 → 成功或失败 → 重试；另验证主题更新和容器缩放。控件预览通过、模拟桥接通过与安装到宿主后通过分别记录。
