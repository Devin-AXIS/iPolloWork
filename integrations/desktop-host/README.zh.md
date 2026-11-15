# iPolloWork desktop host

[English](README.md) | 中文

本私有包提供 Electron IPC 连接并调用官方 DSH profile 启动器，不实现 Agent 循环、模型调度器或会话格式。DSH 导入与[桌面外壳](../desktop/README.zh.md)使用同一份固定的官方源码构建。

包名为 `@ipollo/desktop-host`，桌面打包命令自动构建并包含本包。账户、首次引导与分享属于独立 iPolloWork 套件。源码基于官方 DeepSeek Harness Desktop Host，`LICENSE` 保留其 MIT 许可证。

本包的原生应用配置通过官方 Include 插件加载 `application.yml` 中共用的 iPolloWork 模块。`integrations/tooling/desktop-composition.mjs` 从公共插件配置生成该列表，仅为专属客户端启用 `dedicatedDesktop`。启动器通过最后一层覆盖传入安装路径。DSH 现有管理器保护 Include 入口，并将内部模块视为应用所有；管理器服务本身不变。
