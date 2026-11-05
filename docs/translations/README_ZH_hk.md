<!-- Generated from README_ZH.md by `pnpm readme:zh-hant`; do not edit directly. -->

# iPolloWork

<p align="center">
  <a href="../../README.md">English</a> · <a href="./README_ZH.md">简体中文</a> · 繁體中文 · <a href="./README_JA.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/Devin-AXIS/iPolloWork/releases/latest"><img src="https://img.shields.io/github/v/release/Devin-AXIS/iPolloWork?display_name=tag&amp;sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/Devin-AXIS/iPolloWork/releases"><img src="https://img.shields.io/github/downloads/Devin-AXIS/iPolloWork/total" alt="GitHub downloads" /></a>
  <a href="https://github.com/Devin-AXIS/iPolloWork/stargazers"><img src="https://img.shields.io/github/stars/Devin-AXIS/iPolloWork?style=flat" alt="GitHub stars" /></a>
  <a href="https://x.com/iPolloWork"><img src="https://img.shields.io/badge/X%20Global-%40iPolloWork%20%C2%B7%207.9K%20followers-000000?logo=x&amp;logoColor=white" alt="Follow iPolloWork on X" /></a>
  <a href="https://x.com/iPolloCN"><img src="https://img.shields.io/badge/X%20%E4%B8%AD%E6%96%87-%40iPolloCN%20%C2%B7%203.4K%20followers-000000?logo=x&amp;logoColor=white" alt="Follow iPolloCN on X" /></a>
  <a href="https://www.bestpractices.dev/projects/14127"><img src="https://www.bestpractices.dev/projects/14127/badge" alt="OpenSSF Best Practices" /></a>
  <a href="https://www.cloudflare.com/startups/"><img src="https://img.shields.io/badge/Cloudflare-for%20Startups-F38020?logo=cloudflare&amp;logoColor=white" alt="Cloudflare for Startups" /></a>
  <a href="https://github.com/opea-project"><img src="https://img.shields.io/badge/OPEA-Open%20Platform%20for%20Enterprise%20AI-ff7a00" alt="OPEA: Open Platform for Enterprise AI" /></a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/88012?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-88012"><img src="https://trendshift.io/api/badge/trendshift/repositories/88012/daily?language=TypeScript" alt="#22 TypeScript Repository Of The Day | Trendshift" width="250" height="55" /></a>
  <a href="https://trendshift.io/repositories/88012?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-88012"><img src="https://trendshift.io/api/badge/trendshift/repositories/88012/weekly?language=TypeScript" alt="#24 TypeScript Repository Of The Week | Trendshift" width="250" height="55" /></a>
</p>

**面向人與智能體團隊的企業級、本地優先 Agent Workbench：在一個工作空間內統一多引擎、統一插件與 Skills，管理多智能體項目和任務，並持續編輯代碼、文檔、演示稿、網站、設計和視頻。**

https://github.com/user-attachments/assets/201b561a-22ec-4c8e-a4e8-f34172cf0aa3

iPolloWork 是面向下一代 Agent 原生工作方式的統一工作台層。它不會按運行時割裂項目和擴展，而是把智能體、任務、日程、插件、Skills、工具、執行過程和可編輯成果放進同一個控制界面。你描述目標，智能體負責規劃和執行；團隊可以檢查進度、批准操作，並在同一個地方繼續編輯結果。

iPolloWork 不再把自己定義成某一個編程智能體的“平替”。它通過明確的兼容邊界連接 [Codex](https://github.com/openai/codex)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、OpenCode 和未來智能體運行時，同時保留各個生態自身的原生優勢。編程只是起點：當結果變成演示稿、網頁、視覺設計或視頻時，它仍然可以繼續編輯，而不是隻留下一個成品文件或一段聊天記錄。

<div align="center">
  <h3>加入 iPolloWork 官方微信羣</h3>
  <p>使用微信掃描下方二維碼，加入官方社區，獲取產品動態並交流使用經驗。</p>
  <img src="../assets/ipollowork-official-wechat-group.jpg" alt="iPolloWork 官方微信羣二維碼" width="220" />
</div>

## 它真正解決的核心問題

- **多引擎，一個工作台** — 兼容 Codex、DeepSeek Harness、OpenCode 和未來運行時，不需要圍繞每個引擎重新搭建項目體驗。
- **統一的全局擴展系統** — 插件、Skills、智能體、命令、服務和授權只需安裝、啓用、更新或卸載一次；可選的引擎原生綁定仍歸同一生命週期管理。
- **項目原生的人機協作** — 人與智能體圍繞同一個項目查看職責、任務、日程、執行健康和成果，不再把工作拆散在彼此孤立的對話裏。
- **一體化可編輯生產** — 從代碼延伸到文檔、網站、演示稿、設計和視頻；生成之後，文字、圖片、佈局、時間線和畫面仍能繼續修改。
- **本地與企業可控** — 可以完全在本地運行、自選模型或服務商、逐項審核權限和執行；團隊真正需要時再連接組織服務。

## 智能體運行時兼容

OpenCode 是目前默認的本地執行運行時。[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 已作為可選同級運行時和子代理委派目標接入；[Codex](https://github.com/openai/codex) 則通過 [`ipollowork-ui-mcp`](https://www.npmjs.com/package/ipollowork-ui-mcp) 控制界面接入。MCP 是這條接入路徑使用的協議，不是與 Codex、DSH、OpenCode 並列的另一個智能體引擎。它們共享同一個工作台，但不會假裝所有運行時都擁有完全相同的原生能力。

協作方式保持簡單：iPolloWork 是項目工作台；需要時，一個任務可以把邊界明確的工作交給 DSH 子代理，再把結構化進度和結果帶回同一個項目。各運行時繼續保留自己的智能體、Skills、插件和執行機制。

### 在 DeepSeek Harness 中直接啓動 iPolloWork 創作插件

DeepSeek Harness 用户可以把 iPolloWork 的 Design、PPT 和 Video 原生視圖安裝到 DSH Web 界面，並從任意項目目錄啓動：

<p>
  <a href="https://www.npmjs.com/package/deepseek-idesign"><img src="https://img.shields.io/npm/v/deepseek-idesign?label=DeepSeek%20Design&amp;logo=npm&amp;color=CB3837" alt="deepseek-idesign npm 版本" /></a>
  <a href="https://www.npmjs.com/package/deepseek-ivideo"><img src="https://img.shields.io/npm/v/deepseek-ivideo?label=DeepSeek%20Video&amp;logo=npm&amp;color=CB3837" alt="deepseek-ivideo npm 版本" /></a>
</p>

```bash
npx @deepseek-ai/dsh plugin --profile web add deepseek-idesign deepseek-ippt deepseek-ivideo
npx @deepseek-ai/dsh web
```

打開 [http://127.0.0.1:3080](http://127.0.0.1:3080)，新建對話後選擇 **Design**、**PPT** 或 **Video**。如果已經安裝 `dsh` 命令，可以把 `npx @deepseek-ai/dsh` 直接替換成 `dsh`。DeepSeek Harness 目前仍處於開發者預覽階段，插件兼容性會跟隨其活躍版本線。

## 安裝 iPolloWork

### 下載桌面應用

正式安裝包發佈在 [GitHub Releases](https://github.com/Devin-AXIS/iPolloWork/releases)。如果希望手動下載，請同時根據操作系統和 CPU 選擇文件：

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
Codex / MCP 客户端 ── ipollowork-ui-mcp ──> iPolloWork 桌面/UI
                                                 │
                                                 ├── 本地 API ──> Engine Protocol ──> OpenCode（默認）
                                                 │                                  └──> DeepSeek Harness（可選）
                                                 └── 可選賬號與控制請求 ──> iPolloCloud
```

- 智能體執行、任務狀態和流式數據在統一引擎邊界規範化，引擎原生行為仍留在各自適配器中。
- 可移植的 Skills、插件、MCP 服務和項目能力使用同一生命週期，引擎專屬增強保持可選。
- Codex 當前通過 MCP 控制界面兼容接入，不會被誤寫成已經存在的 Codex 原生引擎適配器。
- Cloud 負責賬號、組織、權益、託管 Worker 生命週期、管理後台和商業 App。
- 不連接 Cloud 時，iPolloWork 仍可完整本地運行。
- iPolloWork 不會 fork OpenCode 或 DeepSeek Harness，兩者都可以繼續獨立演進。

## Star 增長趨勢

<p align="center">
  <a href="https://www.star-history.com/?repos=Devin-AXIS%2FiPolloWork&amp;type=date&amp;legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-light.svg" />
      <img alt="iPolloWork Star 增長趨勢" src="https://raw.githubusercontent.com/Devin-AXIS/iPolloWork/star-history/docs/star-history/star-history-light.svg" width="900" />
    </picture>
  </a>
</p>

## 使用許可

- 僅個人自己使用免費；少於 3 名總用户的小規模內部使用免費。
- 3 名及以上用户的任何形式使用，不管個人、企業、內部、外部、商業或非商業，都必須先獲得書面授權。
- 任何售賣、轉售、收費服務、SaaS、託管、白標、市場分發或面向客户的使用，不管由個人還是企業提供，都必須先獲得書面授權。
- 前台用户界面中必須保留 iPolloWork 名稱、Logo 和產品歸屬展示，除非書面授權明確允許更換品牌。
- 第三方代碼和歷史上已經按 MIT 發佈的部分繼續保留原許可證和既有權利。

完整條款見 [`LICENSE`](../../LICENSE)。該協議屬於源碼可用協議，不是 OSI 認可的開源協議。完整工程結構和貢獻方式請查看[英文主文檔](../../README.md)。
