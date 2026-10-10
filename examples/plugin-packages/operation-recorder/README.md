# iPolloWork 操作录制插件

示范一次桌面操作，将详细步骤保存并生成可编辑、可参数化的 Agent Skill。主仓源码在 `examples/plugin-packages/operation-recorder`；工作台、服务、采集器、依赖和录制数据均由本插件管理。

## 统一 Node.js 采集方案

macOS、Windows 和 Linux 使用同一个 `native/recorder.mjs` 入口。JavaScript 统一负责键鼠事件分类、应用切换、暂停/恢复、输入合并、双击合并、滚动方向、500 步上限和退出清理。`uiohook-napi` 监听全局键鼠；`koffi` 让 JavaScript 调用系统的辅助功能接口。没有 Go / Swift 采集程序，也不再调用 Go、swiftc、lipo 或 codesign 构建采集器。

系统接口差异集中在 `native/accessibility.mjs`，使用独立 Node.js Worker 查询控件，防止辅助功能查询阻塞键鼠监听和停止命令。队列最多 256 个事件，单次查询有超时，异常会停止录制并保留已捕获步骤。同一入口和事件协议由三端共用，底层 N-API 二进制按系统和 CPU 区分，不能把同一个 `.node` 文件用于全部系统。

| 系统 | JavaScript 调用的系统接口 | 运行条件 |
| --- | --- | --- |
| Windows 10/11 x64 / arm64 | UI Automation、Win32 | 当前用户已解锁的交互桌面；目标应用权限不得高于录制器 |
| macOS x64 / arm64 | Accessibility、CoreFoundation | 需要授予辅助功能和输入监控权限 |
| Linux X11 x64 / arm64 | AT-SPI、X11 | glibc 桌面，X11 RECORD 扩展及 `libatspi` / `libXtst` 等桌面系统库 |
| Linux Wayland / XWayland | 明确报告不可用 | 可以导入 Chrome DevTools Recorder JSON，继续编辑与导出 |

插件仍通过现有 `local-service` 和 portable Skill 协议接入。宿主投影同一份 Skill 到 OpenCode、Codex harness 和 DeepSeek harness；执行引擎需要具备当前应用的浏览器或 Computer Use 工具。

## 每一步明确操作位置

采集器记录应用、窗口/页面标题、可访问性控件名称和角色、最多 8 层有名称的父级区域，以及控件在窗口内的九宫格相对位置。位置用于说明和辅助核对，执行时仍需重新定位当前控件。鼠标坐标仅临时用于命中测试，不保存到步骤或 Skill。

时间线、JSON 工作流和 Skill 使用服务端同一份描述。示例：

> 左键点击「Chrome」应用，「项目列表」页面，窗口右上方，「项目操作」工具栏内的「新建项目」按钮，点击前核对控件名称及所属页面，点击后检查界面变化。

输入步骤说明输入框和本次任务的变量；按键步骤说明当前页面、控件和组合键；滚动步骤保留实际方向。已有备注和预期结果仍进入导出。没有捕获到页面或控件时，明确写出「页面未识别」「控件身份未完整识别」，允许用户补充，不编造位置、成功条件或操作结果。

原生页面标题以系统可访问性证据为准；它可能只提供窗口标题，不能保证每个应用都有 DOM 页面或完整区域信息。Chrome 导入会将最近一次导航的地址关联到后续步骤，清除地址中的认证信息、查询和片段。历史选择器仅作为重新定位的参考。

输入原文、剪贴板内容和截图不读取或保存。输入值由执行时的用户请求或授权上下文提供。页面标题、区域名称和控件标签仍可能包含业务信息；录制与导出不代表人工审阅或重放验证通过。

## 详细操作流程

1. 在 iPolloWork 的插件库页面，找到「操作录制」插件，打开其详情，安装/启用后打开「操作录制」工作台。
2. 在工作台主内容区顶部的录制控制条，查看左侧的「准备就绪」状态。若不可用，展开控制条下方的「录制选项」，阅读具体原因；macOS 可点击该区域内的「检查系统权限」，再到系统设置授予权限。
3. 点击录制控制条右侧的「开始录制」。确认状态变为「录制中」，并出现「暂停」「结束录制」按钮。录制标题自动生成，无需填写技术名称或变量名。
4. 切换到要示范的应用/浏览器窗口。进入目标页面，依次点击实际控件、输入内容、滚动或使用快捷键。录制步骤会说明应用、页面、区域、控件和操作方式；控件不提供辅助功能信息时，该步骤会标记缺失信息。
5. 需要处理与任务无关或私密操作时，回到工作台顶部控制条，点击「暂停」。完成后点击同一控制条里的「继续」，确认状态重新变为「录制中」。暂停期间的操作不加入步骤。
6. 完成示范后，回到顶部控制条，点击「结束录制」。确认录制已保存，再展开下面的「录制步骤」时间线。
7. 在时间线里点击某一步的整行描述，展开详情。核对「页面或窗口标题」「操作控件名称」「控件所在区域」；需要时补充区域路径，如「项目管理 → 项目操作」。备注和预期结果也可补充，修改自动保存。这里不会把自动保存标记为人工批准。
8. 若有明确完成条件，在时间线下方的「生成 Skill」区域，展开「补充完成条件（可选）」并填写实际应该看到的结果；没有明确条件时可留空。
9. 点击该区域的「生成 Skill」。在出现的「Skill 草稿已生成」区域，展开「查看与编辑草稿」，核对每一步是否说明了页面、区域和控件。修改后点击「下载 Skill 插件」，编辑内容会先保存再重新打包。
10. 需要 AI 整理时，点击草稿区域的「让 AI 提炼」；独立工作台提供「复制给 AI 提炼」。提炼应保留已捕获位置和变量，明确缺失证据，不能把生成草稿描述为已经重放成功。
11. 将下载的 `.ipollowork-plugin` 导入现有插件库。以后执行该 Skill 时，执行引擎先观察当前页面，重新识别同名控件及其所属区域，再逐步执行并验证已有成功条件。

## 开发、生产和下载

开发环境需要 Node.js 22.22+、pnpm，以及首次安装两个运行时依赖。开发依赖 TypeScript 和 `@types/node` 用于现有服务的类型检查。`pnpm-workspace.yaml` 下载三端 x64 / arm64 的预编译模块，构建不需要 Go、Swift、Xcode 或 C++ 编译器，也不执行依赖的安装脚本。

现有桌面开发/生产构建调用本插件的构建脚本；检测到依赖缺失、版本不符或目标模块缺失时，脚本会在插件目录执行一次 `pnpm install --frozen-lockfile --ignore-scripts --prod=false`。已有依赖直接复用。Node.js 标准库没有全局键鼠监听和系统辅助功能 FFI，新增的两个依赖分别承担这两项职责；默认六种目标的完整插件约 8.4 MB，低于宿主 10 MiB 限制。

构建复用已有 TypeScript 开发依赖，将 `service/` 编译为 JavaScript 并调整分发清单入口为 `service/recorder.js`。安装包包含服务的 ESM 声明，应用内置 Node.js 22.16 可以直接加载，不依赖 TypeScript 剥离开关；编译器不会随插件分发。0.4.1 修复了 0.4.0 在该宿主中直接导入 `.ts` 的启动失败。

```sh
pnpm install
pnpm check
pnpm test
pnpm build
pnpm start
```

`dist/package/` 包含 JavaScript 采集器及独立依赖目录，可离开开发用的 `node_modules` 运行。`--host --if-stale` 构建仅包含当前系统；默认构建包含三端 x64 / arm64。Linux 分发 glibc 模块，不声称支持 musl。构建不在用户安装或开始录制时联网，不需要用户另行下载 Node 插件、模型、Go 或 Swift。

生产桌面版复用 iPolloWork / Electron 内置 Node.js；在独立服务器模式下需要已有 Node.js，Bun 服务器可通过宿主已有 `IPOLLOWORK_NODE_BIN` 指定 Node。macOS 权限授权是系统设置。Linux 缺少桌面系统库时，需要通过系统包管理器安装；插件不会自动安装或提权。

默认数据位于 `.runtime/`，可用 `IPOLLOWORK_RECORDER_DATA_DIR` 指定。宿主模式继续使用提供的 `dataDir`，按工作区隔离；历史只显示最近 25 个会话。数据路径和插件 ID 保持不变，旧录制加载后重新计算详细描述。关闭、停用、更新时释放采集进程、Worker、键鼠监听和 HTTP 服务。

## 发布与验证

签名打包复用宿主已有发布工具和可信发布者。私钥不放入工程或插件包：

```sh
IPOLLOWORK_PLUGIN_HOST_ROOT=/path/to/iPolloWork \
IPOLLOWORK_PLUGIN_SIGNING_KEY=/path/to/existing-publisher.pem \
IPOLLOWORK_PLUGIN_SIGNING_KEY_ID=smart-future-school-2026 \
pnpm package:plugin
```

宿主安装和三引擎投影检查：

```sh
IPOLLOWORK_PLUGIN_HOST_ROOT=/path/to/iPolloWork \
pnpm verify:host
```

此检查使用临时工作区，不安装到当前用户工作区。HTTP 工作台保留本机地址、令牌、Origin、请求大小和超时检查。原生桌面实测结果必须分别报告；模拟三端生命周期或打包六种模块不代表三端桌面操作已经验收。

Windows 真实桌面录制与导出验证（复用指定仓库已安装的 Electron，不下载浏览器）：设置 `IPOLLOWORK_PLUGIN_HOST_ROOT` 为宿主仓库，然后运行 `pnpm build` 和 `pnpm verify:desktop`。验证打开两个隔离窗口，真实点击项目页右上方「项目操作」工具栏的「新建项目」，输入并保存，再检查时间线和导出 Skill；结果写入宿主本工作树的 `evals/results/<run-id>/fraimz.html`。测试结束后关闭自有窗口并清除临时工作区。目前 Windows 通过了这一验证；macOS / Linux 的真实桌面验证仍需在对应系统执行。

源码所有者：`service/` 管理存储、验证、工作台和 Skill 编译；`native/` 管理共享采集器和系统接口适配；`ui/` 管理无框架工作台；`tests/` 管理回归验证；`scripts/` 管理构建、启动和宿主验证。Koffi 为 MIT，uiohook-napi 为 MIT，其链接的 libuiohook 为 LGPL-3.0-or-later；完整声明及源码链接随 `native/THIRD-PARTY-NOTICES.txt` 分发。
