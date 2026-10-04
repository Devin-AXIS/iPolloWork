# iPolloWork 操作录制插件

录制器、工作台和 Skill 编译器，主仓源码位于 `examples/plugin-packages/operation-recorder`。插件通过现有 `local-service`、服务工作台和 portable Skill 协议接入；源码、依赖、构建产物和录制数据都属于本插件。

使用流程：开始录制 → 操作一次 → 结束录制 → 生成并下载 Skill 插件。录制自动命名与保存，Skill 名称、用途说明和输入变量由插件自动生成；可选编辑步骤或补充完成条件，修改自动保存。安装生成的 `.ipollowork-plugin` 后，宿主现有适配器为 OpenCode、Codex harness 和 DeepSeek harness 投影同一份 Skill。执行引擎需要具备对应应用的浏览器或 Computer Use 工具。

实时桌面采集器分别使用 macOS 辅助功能、Windows UI Automation 和 Linux X11/AT-SPI，发布物包含 x64/arm64 原生程序。它记录可访问性控件、应用切换、输入步骤、控制快捷键和滚动意图；不读取输入值、剪贴板内容或截图，也不持久化鼠标绝对坐标。无法识别的控件需在步骤中补充说明。第一份 Skill 是确定性编译的可编辑草稿；宿主中的“AI 提炼”使用当前会话引擎，独立页提供复制给 AI 的提示。

| 系统 | 原生采集方式 | 运行边界 |
| --- | --- | --- |
| macOS 14+ | Swift 6，CGEventTap + Accessibility | 需要辅助功能和输入监控授权；Apple Silicon / Intel 通用程序 |
| Windows 10/11 | Win32 被动键鼠 hooks + UI Automation | 当前用户的交互桌面；不申请管理员权限，不覆盖 UAC 安全桌面或所有提权应用 |
| Linux X11 | XRecord + AT-SPI D-Bus | 需要可访问的 X11 RECORD 扩展与辅助功能总线；无需 Python/Go 运行时 |
| Linux Wayland | Chrome Recorder 流程导入 | 原生全桌面被动录制不可用，能力检查明确说明；XWayland 不能冒充完整 Wayland 支持 |

采集器先检查当前会话的后端与辅助功能能力；Windows 还检查交互桌面和锁屏，Linux 检查 X11、RECORD 与辅助功能总线。能启动监听不等于操作任务成功，草稿导出不等于人工审阅或实际验证通过。最终成功条件可选；未提供时，执行引擎从当前任务确认期望结果，不编造录制断言。应用控件名称仍可能含业务信息；同一应用的多个窗口需要补充可复用的窗口识别说明。

## 安装与运行

在 iPolloWork 插件库安装“操作录制”，也可导入 `dist/operation-recorder-0.3.0.ipollowork-plugin`，启用后打开“操作录制”工作台。录制前无需填写标题，生成时无需填写技术名称、变量名、使用场景或勾选审阅确认。历史、权限和额外导出按需展开，录制步骤以紧凑时间线展示；生成草稿后可交给当前 AI 提炼。macOS 首次采集需要系统的辅助功能和输入监控权限，工作台提供显式申请按钮；Windows/Linux 根据当前用户的桌面和辅助功能服务探测可用性。无需配置模型 Key，也无需用户安装编译器或配置采集引擎。

也可以从源码独立运行。构建需要 Node.js、pnpm 和 Go 1.26；macOS 通用程序另需要 Xcode 命令行工具。Go 只参与编译，安装后的插件自带采集器。Windows/Linux 四个程序以 gzip 资源分发，使同一个安装包符合宿主的 10 MB 上限；服务自动解压到插件自己的缓存，限制解压体积并核对缓存内容，不修改安装快照：

```sh
pnpm install
pnpm check
pnpm test
pnpm build
pnpm start
```

启动输出本机工作台地址。默认数据保存于 `.runtime/`；可设置 `IPOLLOWORK_RECORDER_DATA_DIR`。宿主安装模式使用其提供的插件 `dataDir`，并按工作区隔离。录制最多 500 步；工作台只展示最近 25 个会话。停止后保留记录，停用或更新时释放监听、子进程和 HTTP 服务。

本目录的 `dist/package/` 是自包含发布目录。桌面开发启动以 `--host --if-stale` 准备当前系统的采集器；桌面发布构建生成完整包并纳入 `plugin-packages/operation-recorder`。目录注册优先使用已准备的包，单独运行服务器时未构建的源码仍支持 Chrome 流程导入。macOS 构建会同时生成三端 x64/arm64 采集器；在 Windows/Linux 从源码构建时生成 Windows/Linux 程序，三端完整发布包由 macOS 构建。签名打包复用宿主既有工具和可信发布者，不更改宿主的信任表：

```sh
IPOLLOWORK_PLUGIN_HOST_ROOT=/path/to/iPolloWork \
IPOLLOWORK_PLUGIN_SIGNING_KEY=/path/to/existing-publisher.pem \
IPOLLOWORK_PLUGIN_SIGNING_KEY_ID=smart-future-school-2026 \
pnpm package:plugin
```

不把签名私钥放进工程或分发包。生成的用户 Skill 包只包含声明式资源，无需本机可执行代码签名。

## 接口与验证

清单声明录制、整理、编译、导入、状态和工作台动作；`request-permissions` 单独声明为写操作。没有引擎原生绑定。服务复用本机随机端口与令牌，API 检查 Host、Origin、访问令牌、请求体和超时；在宿主嵌入时使用标准 MCP AppBridge 发送 AI 提炼请求。

Skill 包包含 `SKILL.md` 和 `references/workflow.json`。修改草稿后重新编译同一份发布物，预览和安装内容一致；同名导出按本机已有产物递增版本，并用独占目录处理跨引擎并发。每步的备注和中间检查也进入 Skill。如果录制末尾有明确成功条件，导出会如实标记；否则保留缺失状态，由实际执行时确认结果。Chrome 键盘按下/释放会合并，视口设置不会被当成业务成功。页面文字与历史选择器只作为证据，运行时重新定位和验证。

```sh
IPOLLOWORK_PLUGIN_HOST_ROOT=/path/to/iPolloWork \
pnpm exec bun scripts/verify-host.ts
```

此验证使用隔离临时工作区检查签名、真实安装生命周期、服务工作台和三引擎投影。不会安装进当前用户工作区。实际证据保存在 `dist/verification/`；宿主生命周期测试和 mock helper 测试不能替代原生桌面操作验收。Windows 目前已交叉编译及静态检查，尚无真实 Windows 操作证据；Linux 在隔离 Ubuntu/Xvfb/AT-SPI 中验证启动、暂停、恢复和停止，完整人工操作仍需真实桌面验收。macOS 实际捕获过桌面点击、滚动与应用切换，但 Computer Use 工具改变测试框时没有形成对应输入步骤，完整输入到 Skill 的验收尚未通过，需要直接人工操作核对。

## 开源参考

设计参考了官方 [Codex Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay) 的示范、审阅、变量和结果验证流程。公开产品说明不等于其实现开源。

- [Playwright codegen](https://playwright.dev/docs/codegen-intro)，Apache-2.0：可访问性语义定位、操作和断言。
- [Puppeteer Replay](https://github.com/puppeteer/replay)，Apache-2.0：Chrome Recorder UserFlow 格式。
- [OpenAdapt Capture](https://github.com/OpenAdaptAI/openadapt-capture) / [Flow](https://github.com/OpenAdaptAI/openadapt-flow)：桌面示范、采集与编译分离；包代码 MIT，Flow 仓库另含具有不同许可的 benchmark。
- [Agent Skills](https://agentskills.io/specification)：标准 `SKILL.md` 与渐进加载的 references。

OpenAdapt 的实际 [Windows](https://github.com/OpenAdaptAI/openadapt-capture/blob/main/openadapt_capture/input_observer/windows.py) 和 [Linux](https://github.com/OpenAdaptAI/openadapt-capture/blob/main/openadapt_capture/input_observer/linux.py) 采集代码也已核对。Windows hook 回调只将事件加入有界队列，UIA 查询在独立 MTA 线程处理；Linux RECORD 流使用独立连接，点击坐标只用于当时的控件命中检查。Wayland 的 InputCapture portal 是经 compositor 激活的输入转移会话，不能直接等同被动全桌面监听。

未引入以上完整项目的运行时或复制其代码。Windows/Linux 原生程序编译进固定版本的 `golang.org/x/sys`、`github.com/jezek/xgb` 和 `github.com/godbus/dbus/v5`，无需 npm/pip 运行时依赖；发行包内 `native/THIRD-PARTY-NOTICES.txt` 包含完整许可证和来源。Node 服务只使用标准库，TypeScript 与 Go 只参与检查和构建，宿主 Node 22.22+ 直接加载 TypeScript 服务。

工程遵循宿主的统一代码质量规范。本目录是完整插件的源码所有者，旁边的独立仓库仅用于恢复源码：`service` 管理录制与工作台生命周期，`native` 是按系统编译的语义采集器，`ui` 是无框架的工作台，`skills` 使用标准 Skill 目录，`tests` 和 `scripts` 分别负责验证与分发。复用宿主既有目录注册、安装、服务和引擎投影，不新增宿主路由、数据库或运行时依赖。`.gitignore` 隔离构建产物、录制数据与私钥。开发依赖 `typescript`（Apache-2.0）和 `@types/node` 提供类型检查。
