---
kind: upgrade-guide
description: The iPolloWork desktop application, executable and helper processes are named iPolloWork.
---

# iPolloWork desktop name

English | [中文](guide.zh.md)

## Change

The desktop package is named iPolloWork instead of DeepSeek Harness. macOS installs `iPolloWork.app`; its executable and helper processes are named iPolloWork, so the menu bar and Activity Monitor show iPolloWork. Windows installs `iPolloWork.exe`, and a new installation uses `%LOCALAPPDATA%\Programs\iPolloWork`.

The bundle identifier, the `dsh` link protocol, the application data and log folders, saved credentials, and the `deepseek-harness-<version>-<os>-<arch>` installer and update file names are unchanged. Uninstalling on Windows removes `%APPDATA%\iPolloWork Desktop` only when a published `DSH_HOME` keeps the Harness home elsewhere; with the default home inside it, the folder is kept. Other `%APPDATA%` folders named after the product, such as `%APPDATA%\iPolloWork`, are never removed.

## Migration

1. An automatic update replaces the installed application in place. On macOS the bundle keeps its existing file name until you rename it; on Windows the update stays in the registered installation folder.
2. After installing from a new disk image on macOS, delete the earlier `DeepSeek Harness.app` so only one copy remains.
3. If you installed the `dsh` command and the application moved, open the application menu, select **Manage dsh Command…** and install it again; the earlier link points into the previous application path.
