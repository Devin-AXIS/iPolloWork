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

第一步在视频工作台的“视频智能增强”中上传 MP4、MOV 或 WebM，支持 3 分钟、100 MB 以内且含讲话音轨的视频。后台转写、提取原文中的短句/数字/列表，并按人物检测框与相邻帧保护区域安排元素；空白不足时跳过。用户检查文字、时间和预览后才替换当前时间轴，原上传文件与增强前时间轴保留。若时间轴已被继续编辑，应用或恢复会拒绝覆盖。首版分析副本最长边缩放至 1280，包含原音轨；手势识别与精细人物分割属于后续阶段。

开发环境先执行 `pnpm --filter ipollowork-server prepare:video-models`；完全断网的开发机器可复制已准备的模型目录并设置 `IPOLLOWORK_VIDEO_MODELS_PATH`。桌面构建自动准备模型，完整安装包运行时只读取本地目录；缺少模型会禁用分析，不自动下载。权重约 50 MB，另含 tokenizer、ONNX Runtime 原生库等依赖。量化小模型可能转写错误或漏检人物，必须预览校对，不提供逐像素不遮挡保证。

新增 `@huggingface/transformers@3.8.1`（Apache-2.0）复用成熟的本地语音、视觉管线；已有音量/节拍分析和 HyperFrames 不能完成语音识别或人物检测。该依赖只在独立分析子进程加载，不进入前端包，CPU 并发限制为一个任务、推理线程为两个。桌面端声明同一依赖以满足内嵌 server 的运行时依赖检查，并解包 ONNX 原生模块。模型来源与 revision 见 `video-enhancement-models.json`，生成的 `THIRD_PARTY_NOTICES.json` 和 Apache 许可证随模型目录打包。模型升级须重新固定 revision、权重校验值并用实际讲话视频验证。

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
