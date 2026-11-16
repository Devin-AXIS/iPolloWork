---
kind: upgrade-guide
description: iPolloWork 桌面应用、可执行文件和辅助进程以 iPolloWork 命名。
---

# iPolloWork 桌面名称

[English](guide.md) | 中文

## 变更

桌面安装包由 DeepSeek Harness 改名为 iPolloWork。macOS 安装 `iPolloWork.app`，其可执行文件和辅助进程名为 iPolloWork，菜单栏和活动监视器显示 iPolloWork。Windows 安装 `iPolloWork.exe`，新安装使用 `%LOCALAPPDATA%\Programs\iPolloWork`。

应用标识、`dsh` 链接协议、应用数据和日志目录、已保存的凭据，以及 `deepseek-harness-<版本>-<系统>-<架构>` 安装包和更新文件名保持不变。在 Windows 上卸载时，只有已发布的 `DSH_HOME` 把 Harness home 放在别处，才会删除 `%APPDATA%\iPolloWork Desktop`；默认 home 位于该目录内时会保留该目录。以产品命名的其他 `%APPDATA%` 目录（例如 `%APPDATA%\iPolloWork`）不会被删除。

## 迁移

1. 自动更新会原地替换已安装的应用。在 macOS 上，应用包保留原文件名，直到你自行重命名；在 Windows 上，更新仍安装在已登记的安装目录中。
2. 在 macOS 上通过新的磁盘映像安装后，删除旧的 `DeepSeek Harness.app`，只保留一个副本。
3. 如果你安装过 `dsh` 命令且应用位置发生变化，请打开应用菜单，选择 **管理 dsh 命令…** 并重新安装；旧链接仍指向原来的应用路径。
