<!-- Generated from README_ZH.md by `pnpm readme:zh-hant`; do not edit directly. -->

# iPolloWork

<p align="center">
  <a href="../README.md">English</a> · <a href="./README_ZH.md">简体中文</a> · 繁體中文 · <a href="./README_JA.md">日本語</a>
</p>

> **讓智能體創造，讓每一個結果都能繼續編輯。**

**Codex 與 Claude Code 的下一代源碼開放平替——不只幫你寫代碼，更直接完成真正的工作。**

iPolloWork 把 AI 智能體變成一個完整的可視化工作區：代碼、辦公、網站、幻燈片、設計和視頻，都能在同一個任務裏完成。你只需要描述目標，讓智能體先生成，再親手繼續修改——原位改文字、換圖片、調顏色和字體、拖動和縮放元素、切換電腦與手機預覽，或者在時間線上調整視頻畫面，像修改 PowerPoint 一樣直觀。

它不是又一個套着對話框的 AI 工具。iPolloWork 把對話、文件、瀏覽器、可編輯畫布、設計工具、視頻工作室、任務記錄、權限、Skills、插件和 MCP 真正整合進一個本地優先的桌面工作空間。

## 一個智能體工作區，完成所有類型的工作

- **Code** — 理解代碼倉庫、規劃修改、編寫代碼、調用工具並檢查結果，擁有完整的智能體開發流程。
- **辦公** — 調研、撰寫文檔、處理表格並製作精美幻燈片，不再停留在一段文字回答。
- **設計** — 生成網站、幻燈片和視覺內容，再在畫布上直接修改文字、圖片、顏色、字體、佈局和響應式效果。
- **視頻** — 在內置 Studio 中生成和調整視覺畫面，直接編輯內容並使用時間線完成剪輯。
- **自由擴展** — 接入不同模型，通過 Skills、插件、MCP 和瀏覽器自動化擴展智能體能力。
- **本地優先** — 支持 macOS、Windows 和 Linux，直接處理本地文件；可使用桌面端、瀏覽器 UI 或無界面 Server，需要團隊與商業能力時再連接 iPolloCloud。

源碼可用倉庫只包含 Work 客户端及本地運行能力。賬號、組織管理、託管 Worker、支付、管理後台和移動 App 屬於獨立的 iPolloCloud，不影響 Work 單獨使用。

## 安裝 iPolloWork

### 下載桌面安裝包

正式安裝包發佈後會出現在 [GitHub Releases](https://github.com/Devin-AXIS/iPolloWork/releases)。當前倉庫還沒有公開 Release，因此現在請使用下方的源碼安裝方式。未來下載安裝包時，必須同時根據操作系統和 CPU 選擇文件：

| 系統 | CPU | 選擇的安裝包 |
| --- | --- | --- |
| macOS | Apple 芯片（M 系列） | `ipollowork-mac-arm64-<version>.dmg` |
| macOS | Intel | `ipollowork-mac-x64-<version>.dmg` |
| Windows | Intel/AMD 64 位 | `ipollowork-win-x64-<version>.exe` |
| Windows | ARM64 | `ipollowork-win-arm64-<version>.exe` |
| Linux | Intel/AMD 64 位 | `ipollowork-linux-x64-<version>.AppImage` |
| Linux | ARM64 | `ipollowork-linux-arm64-<version>.AppImage` |

macOS 的 `.zip` 和 Linux 的 `.tar.gz` 主要用於便攜運行或更新；普通用户優先選擇 `.dmg`、`.exe` 或 `.AppImage`。如果 Releases 暫時沒有對應安裝包，請按下方步驟從源碼運行或自行打包。

- **macOS：**打開 `.dmg`，把 **iPolloWork** 拖入“應用程序”。
- **Windows：**運行 `.exe`。本地自行構建且未簽名的安裝包可能觸發 Microsoft Defender SmartScreen。
- **Linux：**先運行 `chmod +x ipollowork-*.AppImage`，再打開 AppImage；也可以解壓 `.tar.gz` 後直接運行。

### 源碼開發和打包要求

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download) 22 或更高版本
- pnpm 11，運行 `corepack enable` 啓用
- [Bun](https://bun.sh/docs/installation) 1.3.10 或更高版本，用於構建本地 Orchestrator sidecar
- macOS：Xcode Command Line Tools（運行 `xcode-select --install`）
- Windows：[Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，安裝 **Desktop development with C++** 和 Windows SDK；使用 PowerShell 或命令提示符
- Linux：標準 Electron 構建環境，包括 C/C++ 工具鏈、Python 3、`pkg-config` 和 Electron 所需桌面庫；正式發佈使用 Ubuntu 22.04

桌面端第一次構建時會下載並準備獨立的 OpenCode sidecar。iPolloWork 不會 fork 或修改 OpenCode，OpenCode 可以繼續獨立升級。

## 從源碼啓動

### macOS 和 Linux

```bash
git clone https://github.com/Devin-AXIS/iPolloWork.git
cd iPolloWork
corepack enable
./ipollowork setup
./ipollowork dev
```

### Windows PowerShell

```powershell
git clone https://github.com/Devin-AXIS/iPolloWork.git
Set-Location iPolloWork
corepack enable
.\ipollowork.cmd setup
.\ipollowork.cmd dev
```

`setup` 會安裝鎖定版本的依賴；`dev` 會準備 OpenCode 和 Orchestrator sidecar、啓動 UI 並打開 Electron 客户端。開發模式使用隔離的 iPolloWork/OpenCode 數據，不會覆蓋用户平時使用的 OpenCode 配置。

### 常用開發命令

| 用途 | macOS / Linux | Windows |
| --- | --- | --- |
| 啓動桌面客户端 | `./ipollowork dev` | `.\ipollowork.cmd dev` |
| 只啓動瀏覽器 UI | `./ipollowork dev:ui` | `.\ipollowork.cmd dev:ui` |
| 連接本地 Cloud | `./ipollowork dev:cloud http://localhost:3100` | `.\ipollowork.cmd dev:cloud http://localhost:3100` |
| 類型檢查和桌面測試 | `./ipollowork check` | `.\ipollowork.cmd check` |
| 生產構建 | `./ipollowork build` | `.\ipollowork.cmd build` |

## 構建和打包

三個命令的作用不同：

| 命令 | 產物 |
| --- | --- |
| `build` | 編譯生產 UI、Server、Electron 和 sidecar，但不生成安裝包 |
| `package:dir` | 生成免安裝目錄，速度最快，適合本地驗證；不會修改正式版本號 |
| `package` | 先執行檢查、遞增客户端版本號，再為當前系統和當前 CPU 生成原生安裝包及便攜/更新文件；不會發布 |

### macOS 和 Linux

```bash
./ipollowork check
./ipollowork package:dir
./ipollowork package
```

### Windows PowerShell

```powershell
.\ipollowork.cmd check
.\ipollowork.cmd package:dir
.\ipollowork.cmd package
```

所有產物輸出到 `apps/desktop/dist-electron/`：

`package` 是本地正式打包命令。它會同步 App、Desktop、Orchestrator 和 Server 的版本，並按 `0.1.0` 到 `0.99.0`、再到 `1.0.0` 的順序遞增（源碼開發基線為未發行的 `0.0.0`）。可使用 `./ipollowork package --dry-run` 查看下一個版本；僅在檢查已經通過時才使用 `--skip-check`。本地打包不會自動提交、打 tag、推送或發佈。

- **macOS：**`.dmg`、`.zip` 和免安裝 `.app`
- **Windows：**NSIS `.exe` 和 `win-unpacked/`
- **Linux：**`.AppImage`、`.tar.gz` 和 `linux-unpacked/`

本地打包默認只針對當前操作系統和當前 CPU 架構。完整發布應使用 GitHub Release 工作流，分別生成 macOS ARM64/x64、Windows ARM64/x64 和 Linux ARM64/x64，並完成相應簽名或公證。本地沒有提供 Apple/Windows 簽名憑據時產物不會簽名，只適合開發測試，不應作為正式發行版。

## 連接 iPolloCloud

先啓動本地 iPolloCloud，然後運行：

```bash
./ipollowork dev:cloud http://localhost:3100
```

該命令會使用隔離的開發配置連接 Cloud 登錄和控制接口，不會覆蓋用户正常的本地 iPolloWork/OpenCode 配置。遠程或自建 Cloud 只需替換 URL。

## 架構邊界

```text
iPolloWork 桌面/UI ──> iPolloWork Server ──> OpenCode
        │
        └── 可選賬號與控制請求 ──> iPolloCloud
```

- 智能體執行和流式數據保持在 Work/Worker 路徑。
- Cloud 負責賬號、組織、權益、託管 Worker 生命週期、管理後台和商業 App。
- 不連接 Cloud 時，iPolloWork 仍可完整本地運行。
- iPolloWork 不修改 OpenCode，OpenCode 可以繼續獨立升級。

## 使用許可

- 僅個人自己使用免費；少於 3 名總用户的小規模內部使用免費。
- 3 名及以上用户的任何形式使用，不管個人、企業、內部、外部、商業或非商業，都必須先獲得書面授權。
- 任何售賣、轉售、收費服務、SaaS、託管、白標、市場分發或面向客户的使用，不管由個人還是企業提供，都必須先獲得書面授權。
- 前台用户界面中必須保留 iPolloWork 名稱、Logo 和產品歸屬展示，除非書面授權明確允許更換品牌。
- 第三方代碼和歷史上已經按 MIT 發佈的部分繼續保留原許可證和既有權利。

完整條款見 [`LICENSE`](../LICENSE)。該協議屬於源碼可用協議，不是 OSI 認可的開源協議。完整工程結構和貢獻方式請查看[英文主文檔](../README.md)。
