# 桌面端资源边界

视频工作台必须可离线启动。HyperFrames runtime、registry、FFmpeg、FFprobe 均随桌面安装包发布，视频启动和导出不请求云资源清单。

| 资源 | 来源与读取路径 | 生命周期 |
| --- | --- | --- |
| HyperFrames runtime | `prepare-hyperframes-runtime.mjs` → `resources/hyperframes` | 随桌面版本升级 |
| HyperFrames registry | `vendor/hyperframes/registry` → `resources/hyperframes/registry` | 与 runtime 同次发布 |
| FFmpeg、FFprobe | 固定 installer 依赖，经 `package-video-resources.mjs --bundled` → `resources/video-codecs/<id>/<executable>` | 随桌面版本升级；包含许可证和二进制包元数据 |
| 视频智能增强模型 | `apps/server/script/prepare-video-models.mjs` → `resources/video-models` | 构建时准备固定 revision 的 Whisper Tiny 和 YOLOS Tiny q8 权重；附许可证和来源记录 |
| Codex、DeepSeek Harness | `engine-package-manager.mjs` 校验签名清单并安装至用户数据目录 | 用户按需安装；已安装版本可离线复用 |

`video-resource-manager.mjs` 是媒体二进制的唯一桌面端读取入口。发布模式只读取安装包目录，开发模式读取同一 installer 依赖。启动时执行版本检查，成功后设置 `HYPERFRAMES_FFMPEG_PATH` 和 `HYPERFRAMES_FFPROBE_PATH`；组件缺失或不可执行时清空这些变量并明确报告安装包不完整。没有视频云下载、旧缓存回退、跨版本回退或系统 PATH 替代分支。

`prepare-hyperframes-runtime.mjs` 移除第三方依赖树里的重复 static 媒体二进制，只保留单份 `video-codecs`。桌面构建必须执行打包脚本并验证两个可执行文件，不能发布缺少编解码组件的安装包。

## 本地视频智能增强

在视频工作台的“视频智能增强”中上传 MP4、MOV 或 WebM，支持 3 分钟、500 MB 以内且含讲话音轨的视频。增强原视频的上传与检查共用此上限，普通编辑素材仍使用原有上限。后台转写、提取原文中的短句/数字/列表，并按人物轮廓或检测框与相邻帧保护区域安排元素；空白不足时跳过。用户检查文字、时间和预览后才替换当前时间轴，原上传文件与增强前时间轴保留。若时间轴已被继续编辑，应用或恢复会拒绝覆盖。分析副本最长边缩放至 1280，包含原音轨。

第二步默认开启“手势定位”。MediaPipe 手掌检测与 21 点手部 ONNX 模型由 OpenCV Zoo 发布，固定 revision 和 SHA-256，并附带两份 Apache-2.0 许可证。每秒采样 4 帧、每帧最多分析两只手；连续至少两帧的稳定指向或张掌才形成事件。手势与重叠的讲话片段关联，元素可延后至手势出现但不延长讲话窗口；空间不足时智能模式改用安全空白，明确选择“手势位置”时则跳过。用户能逐项选择智能、手势、左侧或右侧位置。应用时服务端依据已保存的检测结果重新匹配时间、保护人物与手部区域，客户端不能提交手势证据或坐标。没有可靠手势时继续使用音频建议。

第三步默认开启“精细人物避让”，增加 OpenCV Zoo PPHumanSeg（Apache-2.0，约 6 MB），复用原有 ONNX Runtime 与 Sharp，不增加 npm/Python 依赖。分割职责独立放在 `video-enhancement-segmentation.ts`；现有手部分类、语音转写和布局模块分别继续拥有各自规则。每秒 4 帧生成 192×192 人物概率图，以 35% 阈值保留不确定边缘，最大池化为固定 64×64 占用图，十六进制持久化，每帧 1024 字符。布局对整个展示时段及相邻帧取并集，并外扩 3.5% 安全边距；积分图让每个候选矩形检查为常数开销。空分割、几乎全屏、未覆盖检测人物、缺帧或相邻轮廓 IoU 小于 0.65 时，整段回退保守人物框；手部框始终独立保留。保护区开关展示当前采样帧，仅辅助预览，不进入导出。分析耗时随任务保存。原视频分辨率不变更此分析网格的精度；这不是逐帧发丝抠像，也不保证采样间快速运动绝不会遮挡。

开发环境先执行 `pnpm --filter ipollowork-server prepare:video-models`；完全断网的开发机器可复制已准备的模型目录并设置 `IPOLLOWORK_VIDEO_MODELS_PATH`。桌面构建自动准备模型，完整安装包运行时只读取本地目录；缺少模型不自动下载。旧安装仅缺手势或分割模型时，可关闭对应选项继续。权重合计约 70 MB，另含 tokenizer、ONNX Runtime 原生库等依赖。小模型可能转写错误、漏检人物或误判手势，必须预览校对；指向/张掌是几何分类，不解释手语或任意自然手势。

新增 `@huggingface/transformers@3.8.1`（Apache-2.0）复用成熟的本地语音、视觉管线；已有音量/节拍分析和 HyperFrames 不能完成语音识别或人物检测。该依赖只在独立分析子进程加载，不进入前端包，CPU 并发限制为一个任务、推理线程为两个。桌面端声明同一依赖以满足内嵌 server 的运行时依赖检查，并解包 ONNX 原生模块。模型来源与 revision 见 `video-enhancement-models.json`，生成的 `THIRD_PARTY_NOTICES.json` 和 Apache 许可证随模型目录打包。模型升级须重新固定 revision、权重校验值并用实际讲话视频验证。

手部推理直接声明 `onnxruntime-node@1.21.0`（MIT），复用 Transformers 已有的同版本依赖与原生模块，不增加另一套推理引擎或 Python。图像处理复用现有 Sharp，两个模型顺序运行并在分析子进程结束前释放。推理输入、时间和位置均留在当前视频会话目录；运行时不请求外部服务。

分析调用现有 `video-enhancement` 扩展动作，不经过 OpenCode、Codex 或任何云模型。工作进程禁用远程模型、缓存回源与 `fetch`，解码仅允许本地文件协议。转写文字只作为经过转义的元素内容处理。上传路径、会话所有权、时长、大小和最终布局在 server 验证；客户端不能提交任意布局或 HTML。

验证入口：`bun test apps/server/src/extensions/video-enhancement.test.ts`；UI 使用 `evals/support/video-enhancement-fixture.ts` 启动真实 server，与 app 开发服务器的 `tests/video-enhancement-proof.html` 配合。设置 `IPOLLOWORK_ENHANCEMENT_PROOF_VIDEO` 为本地讲话测试片，再运行 `node evals/runner/run.mjs --flow video-local-enhancement --cdp-url <验证浏览器端点>`。此隔离页面复用生产组件和真实 API/推理，不替代完整桌面安装包验收。

## 引擎云资源协议

当前引擎下载协议仍使用签名清单：

```http
GET /api/v1/desktop/resources?appVersion=0.50.13&platform=macos&arch=arm64
```

清单协议固定包含 `codex-harness`、`deepseek-harness`、`ffmpeg`、`ffprobe` 四个资源 ID。视频客户端不再消费该清单；它仍是现有引擎下载和资源发布接口的契约，不能在没有同步更新云端和引擎客户端时随意改变。

`platform` 为 `windows`、`macos`、`linux`，`arch` 为 `x64`、`arm64`。清单必须匹配精确 appVersion/platform/arch，使用内置受信任 Ed25519 公钥验证签名，校验资源尺寸、SHA-256 和归档路径，并在验证后原子安装。不存在的目标返回 404，未完整发布返回 503；禁止自动回退到其他版本或平台。

`publish-desktop-resources.mjs` 负责现有四项云资源的发布与清单验证；`package-video-resources.mjs` 不带 `--bundled` 时仍能为这个发布协议产出两个媒体归档。这是发布端协议用途，不是视频启动的备用下载路径。

## 验收

- 构建产物同时包含 HyperFrames runtime、registry、两个可执行媒体组件和许可证。
- 云资源接口返回 404、无网络或用户媒体缓存为空时，视频工作台依然能打开。
- 使用安装包媒体组件完成真实 MP4 导出并完整解码。
- 缺失、损坏或不可执行的组件不得被报告为 ready；发布流程在构建阶段拒绝该安装包。
- Codex、DeepSeek 的签名校验和按需安装契约保持有效；视频修复不能替代它们的云端资源发布验收。

## 项目与会话的资源生命周期

项目和会话仅提供“归档”和“删除”两种处置。已归档对象的同一入口显示“恢复”。归档保留消息、项目目录、产物和个人配置，停止当前执行、视频结果查询及所属插件服务；项目归档关闭 Codex、DeepSeek 的工作区运行进程、OpenCode 的目录实例和目录监听。共享引擎程序不随会话卸载。恢复只解除归档，下一次使用再启动引擎，不自动重新提交已停止的付费任务。

删除会话时，服务端先验证会话所属项目与文件路径，持久化清理范围，再停止生产者、删除原生历史、所属 `design/<session-id>` / `video/<session-id>` 目录和已登记的独占文件，最后删除产物索引、视频任务及会话绑定。其他会话登记引用的共享文件保留。删除项目时删除整个项目文件夹、全部原生引擎工作区数据、项目插件数据和项目配置；全局账号库、凭据、其他项目、共享引擎安装保留。确认框必须显示完整项目路径与不可恢复提示。目录链接只删除链接本身；禁止跨链接父目录递归、删除承载宿主运行数据的目录或包含其他登记项目的目录。

`resource-lifecycle.ts` 是这两个对象、三个引擎共用的状态和文件清理边界。归档状态与原生引擎能力解耦，使 DeepSeek 可以恢复。删除阶段记录保存在既有运行数据库中，失败保留范围、阻止继续写入并允许重试；成功只留不含历史、文件名和内容的 ID 屏障，防止迟到回调或旧登记复活对象。项目路径只能由显式新建操作重新使用。HTTP 文件写入、插件动作、后台视频保存与执行监视均在清理前结束；删除后的审计不得写入已删除项目目录。

DeepSeek 的文件删除适配受管 JSONL 布局：整个 `sessions/<project-key>/<session-id>/` 目录（包含 `session.jsonl`、`session.v*.jsonl.zstd` 等代际文件），并识别已知平铺 JSONL 文件。关闭运行时后才能删除，其他运行会话繁忙时返回可重试错误。找不到非空会话的受管文件必须失败并保留数据，不能假称已彻底删除。共享旧 HOME 仅清理所属项目目录和已知会话，独立项目 HOME 可整体删除。只有 OpenCode 远程端点的连接没有项目文件管理能力；远程 iPolloWork 项目操作必须转发到所属主机，权限或连接失败时不能伪装为本机“移除记录”。

体验验收：`bun test apps/server/src/resource-lifecycle.test.ts`、`bun test apps/server/src/session-read-model.e2e.test.ts --test-name-pattern 'archive|delete|permanent'`；桌面流程 `pnpm fraimz --flow resource-lifecycle --cdp-url <隔离桌面 CDP>`，`IPOLLOWORK_LIFECYCLE_PROOF_ROOT` 必须指向独立验证目录。当前匹配的官方 DSH 版本为 `0.1.6-alpha.2`，沿用 `constants.json` 和 `dsh-runtime/package.json` 的精确版本约束。DeepSeek 验证使用真实引擎与仅监听回环地址的模型响应夹具；删除后检查原生历史目录消失，并重启引擎确认原生列表不再发现会话。原生协议测试也可通过 `IPOLLOWORK_DSH_CLI`、`IPOLLOWORK_DSH_NODE_BIN` 和 `IPOLLOWORK_DSH_HOST_PLUGIN` 使用已有的受管引擎，避免为每份 worktree 复制依赖。版本不匹配时必须单独记录实测限制，接口替身测试不能充当三个原生引擎均已验收的证据。

## 后续空间治理方案（待实现）

| 优先级 | 机制与归属 | 建议验收标准 |
| --- | --- | --- |
| P0 | 设置中增加存储统计，区分项目源文件、会话产物、可重建缓存、共享引擎、日志和开发 worktree；显示归属、实际磁盘字节与最近使用时间 | 分别统计释放前后实际磁盘占用，正确处理链接、硬链接和共享依赖，避免重复计数；不在对象菜单增加第三种处置 |
| P0 | 桌面浏览器、终端、HyperFrames 预览/导出、下载和分析子进程全面接入同一归属与释放协议 | 归档后无所属运行任务；正在导出或下载时删除，子进程退出且目录不被重建；保留共享账号登录态 |
| P0 | 开发 worktree 完成后回收：检查分支、未提交改动和唯一文件，保留必要源码快照；依赖由稳定的 pnpm 内容存储承载 | 主目录不再通过链接依赖临时 worktree；完成任务不长期留下整份 node_modules、构建输出、安装包和渲染文件 |
| P1 | 缓存按容量、最近访问时间自动淘汰，采用受管目录白名单 | 建议初始上限：可重建预览/缩略图合计 2 GB、下载临时文件 24 小时、渲染临时文件 7 天；逐项可配置，绝不按“修改时间久”删除用户源文件或最终作品 |
| P1 | 日志轮转与测试产物保留策略，由日志、打包与 eval runner 各自实施 | 建议日志总量不超过 200 MB 或 7 天；安装包只留当前版本及一份可用回退；成功测试保留最近 3 次，失败证据保留 14 天 |
| P1 | 引擎与素材复用：共享不可变运行程序和模型、内容哈希素材去重、引用计数及延迟回收 | 单个项目不复制引擎程序、模型或模板依赖；最后一个引用删除后才移除素材；当前使用版本与升级回退版本可区分 |
| P1 | 空闲实例回收与并发限制，复用现有引擎池和桌面预览管理器 | 建议原生会话空闲 5 分钟释放可恢复状态，预览空闲 2 分钟关闭；运行中、待确认与导出中对象受明确租约保护，恢复不重复提交收费请求 |
| P2 | 删除失败队列与崩溃续清、批量删除、空间预算和数据库维护 | 能区分已释放实例与已释放磁盘；锁文件重试可观察；大任务预估所需空间并保留系统余量；数据库仅在空闲页足够多时压缩，避免每次删除执行 VACUUM |

这些上限是后续产品默认值建议，当前变更未启用自动删除历史项目、用户作品或未提交源码。归档的目的仅是释放运行资源，本身不会显著减少项目文件的磁盘占用。
