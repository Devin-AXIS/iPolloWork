---
kind: upgrade-guide
description: iPolloWork Desktop 使用内置应用插件替代 profile 中的旧副本。
---

# iPolloWork 内置插件

[English](guide.md) | 中文

## 变更

iPolloWork Desktop 现在使用安装包内置的套件、Design 和 Video 版本。此前 profile 单独安装的副本可能覆盖内置版本。启动时会将旧副本及原始 profile 清单备份至 `.dsh-bundled-package-backups/upgrade-*`，再移除相应依赖声明。bundle 启用状态、自定义补丁、文档、凭据及其他插件保持不变。

## 迁移

1. 等旧客户端任务完成后退出，再打开新版客户端。
2. 验证更新前保留 `$DSH_HOME/profiles/desktop` 中的备份目录。如果启动报告迁移失败，解决提示的文件系统问题后重新打开。
3. 打开已启用的 Design 和 Video 页面，确认能够加载。如需回退，在客户端关闭时恢复备份的包条目及清单，并使用匹配的旧客户端。
