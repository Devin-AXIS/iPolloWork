# iPolloWork DSH 套件

[English](README.md) | 中文

一个可安装的 DSH Bundle 提供 iPolloWork 皮肤、人工维护的原生插件市场、可选的 iPollo Account 登录、可复用的项目 agent（智能体）以及集成的 IM 通道。执行、已安装 Bundle、配置层、凭据和应用启动均由 DSH 管理。套件不包含其他 agent 运行时或安装器。

## 开发

需要 Node 24.9 或更新版本。运行 `npm ci`、`npm run check` 和 `npm pack`。软件包包含编译后的 Host 与 Client 入口、样式、品牌资源和人工维护的目录。安装期间不会运行构建脚本。

`dependencies` 声明 DSH 软件包、共享的原生 pi-ai 提供方库和 `@matrix-org/olm`；后者的 WASM 文件从磁盘加载。其余第三方库在构建时打包进 `lib`。DSH 在每个进程内将已启用 Bundle 的依赖闭包中的每个包名映射到一个目录。如果与其他 Bundle 共享库名，例如 `qrcode` 引入的 `yargs`，停用套件时该库会切换到另一个 Bundle 的副本，DSH 因而会要求重启，而不能立即停用套件。

使用 `dsh plugin --profile <profile> add link:/absolute/path/to/ipollowork-dsh-suite` 安装构建后的本地目录，再通过同一个 `dsh --profile <profile>` 启动器启动。先在独立 profile 中测试，再在工作 profile 中启用。运行时兼容范围限定为已测试的 DSH 版本系列。重新构建或移动链接目录，或将其替换为发布包后，重启对应 DSH profile，使 Host 实现与内置目录使用已安装文件；仅刷新浏览器不会清除 Host 模块路径。不依赖账号登录的 `/info` 路由报告已安装的软件包版本。正常的组件和 Bundle 开关会即时生效，无需重启。

## 模块

| 模块 | 职责 |
| --- | --- |
| `cordis.patch.yml` | 唯一的原生 Bundle 入口 |
| `src/host/index.ts` | 所有者认证的路由、资源与服务生命周期 |
| `src/host/market.ts` | DSH format-1 校验和实时安装清单 |
| `src/host/account.ts` | iPollo 登录和 DSH 凭据记录 |
| `src/client/theme.tsx` | 可撤销的调色板与原生品牌 slot |
| `src/client/suite.module.css` | 所有套件视觉规则，包括原生详情与目录详情共享的尺寸 |
| `src/client/market.tsx` | 原生插件页面中的附加市场标签页 |
| `src/client/account.tsx` | 账号设置、入口与共享账号状态 |
| `src/host/agents.ts` | Agent 定义、原生预设与委派 |
| `src/host/agent-runtime.ts` | 预设指令、所选 Skills 和项目记忆 |
| `src/client/agents.tsx` | Agent 库、配置与项目记忆编辑器 |

## 配置

在 profile 补丁中覆盖 `ipollowork-suite` 行的 `config`。字段包括 `accountOrigin`（默认 `https://work.ipollo.net`）、`catalogPath`（默认使用内置目录）、`requestTimeoutMs`（20000）、`maxResponseBytes`（1048576），以及 `theme`、`market`、`account`（均为 true）。账号服务必须使用 HTTPS 来源；HTTP 仅供回环地址开发使用。切换账号服务来源时，不会复用其他来源已保存的凭据。

编辑 `catalog/index.json` 维护市场，其格式保持为 DSH format 1。默认目录的 Creative 分类首先显示 Design（包含 PPT）和 Video。当前安装包位于 `catalog/packages/`，`catalog/bundled-releases.json` 固定其版本与 SHA-256 哈希。仅对该默认目录，Host 会校验文件，将其原子复制到 DSH home 中按内容寻址的持久缓存，并向 DSH 现有安装器提供本地 `file:` 规格。保存的安装来源因此能够在套件升级或移除后继续使用，不需要未发布的 npm 版本；显示卡片不会安装或启用插件。更新版本时同时替换压缩包与校验记录。自定义 `catalogPath` 索引保留声明的原生 npm/Git 来源。

安装状态始终来自 DSH。市场打开 DSH 现有的安装对话框和已安装 Bundle 详情页，不自行下载或执行软件包。企业标签页会说明当前没有连接企业目录。

皮肤将原生输入框引用显示为原版 iPolloWork 的选中标签：紧凑的圆角标签、始终可用的关闭按钮、明暗调色板，以及长标签省略显示。样式仅在套件启用时生效；引用数据、键盘编辑、移除和上下文序列化仍由 DSH 管理。

市场使用紧凑列表。已安装条目和 DSH 自带条目直接打开现有 DSH 详情页。未安装条目使用 `market.tsx` 中统一的 `PluginDetailPage` 模板：一个返回按钮、48px 包图标，下方依次展示包简介、组件和版本信息。套件仅在自己的目录详情打开时，通过 DSH 数据属性隐藏原生列表标题；返回时保留搜索和分类选择。布局支持明暗主题与窄屏。所有视觉规则集中在 `suite.module.css`，原生与目录详情共享图标和标题的尺寸变量。DSH 当前未导出可供已安装和未安装条目共用的页面组件，因此套件不导入或复制其私有页面实现。

## 账号行为

本地工作和浏览公开目录不需要 iPollo 登录。账号页通过邮箱和至少 10 位密码直接注册，初始显示名称取自邮箱的本地部分。账号已连接不表示官方服务已配置，服务可用状态在服务连接页展示；空服务目录不表示登录失败。注册调用 `/api/auth/sign-up/email`，并使用返回的会话登录；邮箱密码登录使用现有 Better Auth 的 `/api/auth/sign-in/email` 与 `/api/auth/get-session`。令牌仅保存在 DSH 凭据提供方中，每次请求后丢弃密码。`/api/v1/me/summary` 提供可选的积分信息；余额不可用时显示不可用，不显示为零。断开连接仅移除套件的本地令牌，不删除账号，也不改变 DSH 其他模型提供方的凭据。

Bundle 通过两项普通 profile 覆盖替换内置 DeepSeek 账号及其通知界面；DeepSeek 账号服务与其他模型提供方凭据保持不变。停用 Bundle 会撤销这些覆盖。设置 `account: false` 时，套件不显示账号界面。

## 限制

Agent 模块注册发现、原生委派和项目记忆工具。账号密钥与市场管理不会注入会话。原生执行前策略拒绝通过 `plugin_manager` 直接修改本套件，同时保留读取及管理其他插件的能力。这不是防篡改保护：shell/文件访问可以绕过该工具，DSH 的内置受保护包名单也不会自动保护任意第三方 Bundle。如果 agent 或第三方 Host 插件能够写入安装目录，管理员管理的安装仍需要通用管理授权扩展和操作系统隔离。不能把隐藏界面或安装本软件包视为企业安全边界。

现有主题插件可能覆盖相同的变量，一次使用一个产品皮肤。移除套件会撤销其 slot、样式表和调色板，不会删除账号或会话数据。账号登录基于仓库中的 iPollo 服务协议实现；生产登录需要真实账号及在线服务验证。原生安装器品牌替换、企业目录分发、支付处理和导入旧版 iPolloWork 包格式不在本版本范围内。

现有 iPolloWork 标志作为产品品牌资源随包提供。第三方插件保留各自的作者信息和许可证。

## 可复用的项目 agent

套件的 **Agents / 智能体** 导航展示可复用助手，并提供直接 **Start chat** 的操作。创建时填写名称和工作指令；Skills 与现有 DSH 服务作为可选的折叠选项。可选头像支持最大 5 MB 的 PNG、JPEG 或 WebP；浏览器先居中裁剪为 256 像素方形图片再保存，原生存储仅保留压缩后的栅格图片。没有图片的现有助手继续使用文字头像，图片不会进入模型输入。项目在开始会话或打开项目记忆时选择，不在创建助手时绑定。同一定义可用于多个项目，会话和记忆彼此隔离。所选 Skills 保留资源引用，Standard 组合中现有的 Skills 仍然可用。

`ipollo_list_agents` 发现已启用的 agent，`ipollo_delegate` 通过原生 spawn 后端委派任务。每个子任务使用所选预设，主 Agent 因而可以协调不同专家而不切换自身预设。现有四个预设不会修改。服务选择器读取 DSH 现有 MCP 管理器，复用其连接与凭据，不创建另一个服务器或账号记录。服务选择限制该助手继承的 MCP 工具，并跟随实时工具注册变化。这是工具可见性控制，不是文件系统或租户隔离。旧版保存的专用 MCP 连接仍可使用，新连接在 DSH 服务设置中配置。套件账号登录与创建助手相互独立。

模型选择器默认使用当前原生模型：新的顶层会话使用 DSH 全局默认模型，委派助手继承父级模型。显式选择通过原生持久模型选择机制作用于该助手之后创建的实例，包括委派子任务；不会修改 DSH 全局默认值，也不会覆盖已有会话中已选择的模型。可选模型来自原生模型目录，使用现有提供方凭据。

可选的 `ipollowork-agents` 组件支持配置 agent 和记忆数量限制，以及 MCP 启动超时。停用套件移除其界面和新任务能力，已保存数据保留。该能力位于现有软件包中，不另设套件或独立应用。

运行 `npm run check` 执行单元检查。原生验证时，启动加载本 Bundle 和 `tests/native.patch.yml` 的临时 DSH profile（使用已打包启动器时先将测试 fixture（测试前置数据）编译为 JavaScript），然后设置 `IPOLLO_QA_URL` 为所有者 URL，再运行 `npx tsx --test tests/native.test.ts`。该无密钥测试验证真实模型请求输入、不同子任务预设、项目记忆隔离和认证后的 MCP 启动。

## 集成消息通道

**Main assistant / 总助手** 入口固定在原生会话列表上方。点击继续最近一次网页总助手会话；加号新建会话，两者始终使用 `ipollo-coordinator`。Agents 页面仅包含已保存的专家。网页入口使用独立的原生 Workspace，通过 `ipollowork-agents.config.coordinatorWorkspace` 配置（默认 `$DSH_HOME/ipollowork/assistant`），历史与 IM 连接分开保存。

每个新消息连接都会启动原生 `ipollo-coordinator` 会话，包括扫码和自动连接。总助手可以直接工作、通过 `ipollo_delegate` 使用保存的专家，或通过 `ipollo_dispatch` 创建任务专用的临时工作者。临时工作者使用原生 Standard 预设并继承总助手模型；保存的专家保留自己的指令、Skills、服务选择和可选模型。IM 请求等待原生任务树完成后返回总助手汇总的回答。

每个平台连接只授权一次，专家无需单独扫码。不同聊天保留各自的原生 Session，所选项目/工作区设置仍然生效。共享的是全局协调器定义，不是聊天历史。套件不会增加对未披露群消息的访问，也不会合并不同通道的历史。

现有已绑定会话保留预设和历史。升级后发送 `/new`，以总助手开始新会话。IM 预设选择器说明这一固定入口；在 **Agents** 中管理专家。旧版保存的机器人预设选择留在磁盘上，不会覆盖。见[升级说明](docs/upgrades/main-assistant.md)。

`ipollowork-im` 组件在套件中嵌入 MIT 许可的 DSH IM 适配器。其设置与可选侧栏页面属于 iPolloWork；人工维护的市场不再提供重复的独立 IM 安装。源码及本地修改记录于 [vendor/dsh-im/README.md](vendor/dsh-im/README.md)。

从 `@xmanrui/dsh-im` 切换前，先在 DSH 原生插件管理器中停用该 Bundle，再启用本套件。复用现有通道设置与原生凭据引用。为防止机器人重复回复，不允许同时启用二者。停用套件时，通道控制器与界面随原生插件生命周期移除，已保存配置保留。切换 Bundle 后，如果原生热重载仍显示旧 Client，请刷新页面。不会修改 DSH 核心软件包或原始预设。

图片进入正常的原生图片处理流程。无视觉能力的模型收到保留的图片文件和明确限制说明，不会声称看过图片。收到的文件和音频成为原生会话附件。钉钉识别文本与企微语音转写会被保留。飞书和企微应用录音可以使用已配置的原生语音提供方；除非输入已经是标准 16 kHz 单声道 PCM WAV，否则格式转换需要 `ffmpeg`。缺少或失败的转写会保留录音及其状态。企微智能机器人回调通常仅提供文字；只有平台提供下载引用时才能保存原录音。

结果媒体继续使用现有 `dsh_im_return_file` 通道发送工具。普通 Markdown 中的本地文件路径不等于媒体上传。继承的适配器选择支持的图片或文件消息并报告发送失败；平台专用的原生语音气泡仍取决于各适配器支持情况。

运行 `npm run check`、`npm run test:im-upstream` 和 `npm run pack:check`。无密钥原生媒体回放时，使用 esbuild 将 `tests/im-native-fixture.mjs` 编译为临时 fixture（旁边复制 `tests/fixtures/avatar.png`），让 `tests/im-native.patch.yml` 指向该文件，通过原生 `dsh web` profile 启动，再设置 `IPOLLO_IM_QA_URL`，运行 `node --import tsx --test tests/im-native.test.mjs`。测试使用本地通道响应与 mock 模型，不使用真实机器人凭据。

### 连接机器人后的菜单

飞书与 Telegram 保留原生命令菜单注册。飞书面板不可用时，第一条获得授权的私聊消息会打开现有菜单卡片。钉钉与 QQ 在第一条获得授权的私聊消息中显示现有交互菜单；企微智能机器人在首次进入聊天事件时展示紧凑欢迎卡片，若没有进入事件，则在首次私聊消息时展示。微信使用文字指南。原始消息仍会处理，群聊不会收到主动引导。

企微自建应用自动创建包含 Chat、Agents 和 Actions 的原生底部菜单。点击事件映射到现有命令，保留访问检查。管理员已有菜单保持不变；如果无法注册，则改为在首次进入或首次获得授权的消息中显示文字指南。

每个通道第一版状态中的可选 `menuIntroductions` 字段，在发送前记录各会话已尝试的引导，并在重启后保留。发送结果不确定或失败时，不会自动重试；用户仍可显式使用 `/menu` 或 `/help`。这不增加 DSH Session 事件或持久化类型。平台菜单与卡片布局仍需要在真实移动客户端验收，自动检查使用已认证的回调样本和 mock 平台 API。

## 组织项目

组织页面管理部门、文件包、Skills 和组织模型，权限规则见[组织资源](docs/enterprise-assets.md)。需要 PostgreSQL 账号服务，配置见[服务说明](../../services/ipollowork/README.zh.md)。

通过原生目录表单创建个人或组织项目。项目可按成员或部门授予查看、参与、维护权限，每次请求都检查当前成员关系。维护者管理权限并接纳贡献，本地工作仍在所选目录中。

项目包含概览、文件、项目记忆和改动。概览围绕参与者和实际贡献数量，文件显示输出版本、作者和容量，支持下载及手动上传。原生 `present` 默认不上传文件，不上传输入文件或完整本地 Session。参与者选择需上传的输出，维护者管理上传权限。云端到期不删除本地文件，规则见[存储说明](../../services/ipollowork/docs/storage.md)。

关联文件只包含服务来源和项目 ID。每轮模型开始前重新授权并读取当前项目记忆，撤销访问后不会复用旧上下文。`ipollo_project_memory` 可读取、提交提炼知识，或由维护者携带版本和贡献 ID 明确合并。完整摘要最多 8,000 字符、两级标题，版本冲突保留草稿。后台不运行模型，不需要 Git，也不批量同步本地状态。

打开分享时，通过原生 PKCE 流程接入当前账号；已校验的账号直接复用，无需再次登录或填写分享服务地址。分享沿用原生弹窗、查看器、会话权限与 fork 开关，可选择任何获得链接的人，或组织及其部门。成员变化实时影响组织分享；停用套件移除接收范围扩展和账号准备钩子。开放链接允许匿名访问，分享电脑必须保持在线。会话标题和菜单保留分享入口，未登录用户先连接账号。

历史快照和旧结果仍可读取，旧快照、评论和结果写入返回 HTTP 410。升级账号服务后再安装套件，详见[升级说明](docs/upgrades/2026-11-14-project-spaces.md)。

原生中继测试使用隔离服务和配置，将 `IPOLLO_QA_URL`、`IPOLLO_RELAY_ORIGIN`、`IPOLLO_RELAY_TEST_PASSWORD` 指向测试实例后执行 `node --import tsx --test tests/liveshare-native.test.ts`。不要对工作配置运行该测试。

套件输出上传配置为 `uploadTimeoutMs`（300,000）和 `maxArtifactBytes`（536,870,912）。部署专用的 `automaticOutputArchive` 默认为 false；启用后，关联项目会在具备上传权限时流式归档原生展示的完成输出，`archiveHistoryLimit`（500）限制上传记录数量。内存队列不保留完整 Session 对象；队列满时 Host 提示从项目页上传本地文件。完成记录有数量上限，后端请求 ID 保证重放不会创建重复版本。

可选的 Host 服务还可发布在 Design 中选定的文件集。它使用当前账号流式上传文件，在已有项目关联时保留项目归属，并在服务的独立浏览来源打开完整发布。独立安装的 Design 仍使用自己的存储服务设置。存储密钥和账号令牌不会进入生成的页面。

输出归档的无 Key 测试使用隔离 PostgreSQL 服务和配置，编译 `tests/native-fixture.ts` 并加载 `tests/native.patch.yml`，然后运行 `IPOLLO_ARCHIVE_QA_URL=<private-owner-url> node --import tsx --test tests/project-archive-native.test.ts`。它验证原生展示保留在本地、明确选择输出后上传、超过 24 MiB 的授权下载和输入排除。预期结果保存在 `tests/expected`。

从组织空间创建项目时，归属固定为当前组织；个人创建保留在全局目录入口。组织后台不展示共享会话页签或未归属的个人项目，原生会话分享仍在对应会话中操作。

服务记录包含稳定的 `category`（`language`、`image`、`video`、`audio`、`embedding`、`tool`）和 `vendor`，各模型也保留自己的类别。只有具备 Token 上限的语言模型进入原生对话模型选择器。组织服务列表和部门授权按这些类别展示，包括工具服务。非对话组织服务须明确配置允许的接口路径，编辑已有连接会保留其路径与分类。

官方媒体调用根据允许的接口路径和请求模型选择服务，因此图像生成与语音可以共用服务商接口和 Key，不会选错类别。服务商地域域名由账号服务管理；关闭套件或改用原生个人凭据后，官方路由随即移除。
