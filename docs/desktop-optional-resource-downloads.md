# 桌面端资源边界

视频工作台必须可离线启动。HyperFrames runtime、registry、FFmpeg、FFprobe 均随桌面安装包发布，视频启动和导出不请求云资源清单。

| 资源 | 来源与读取路径 | 生命周期 |
| --- | --- | --- |
| HyperFrames runtime | `prepare-hyperframes-runtime.mjs` → `resources/hyperframes` | 随桌面版本升级 |
| HyperFrames registry | `vendor/hyperframes/registry` → `resources/hyperframes/registry` | 与 runtime 同次发布 |
| FFmpeg、FFprobe | 固定 installer 依赖，经 `package-video-resources.mjs --bundled` → `resources/video-codecs/<id>/<executable>` | 随桌面版本升级；包含许可证和二进制包元数据 |
| Codex、DeepSeek Harness | `engine-package-manager.mjs` 校验签名清单并安装至用户数据目录 | 用户按需安装；已安装版本可离线复用 |

`video-resource-manager.mjs` 是媒体二进制的唯一桌面端读取入口。发布模式只读取安装包目录，开发模式读取同一 installer 依赖。启动时执行版本检查，成功后设置 `HYPERFRAMES_FFMPEG_PATH` 和 `HYPERFRAMES_FFPROBE_PATH`；组件缺失或不可执行时清空这些变量并明确报告安装包不完整。没有视频云下载、旧缓存回退、跨版本回退或系统 PATH 替代分支。

`prepare-hyperframes-runtime.mjs` 移除第三方依赖树里的重复 static 媒体二进制，只保留单份 `video-codecs`。桌面构建必须执行打包脚本并验证两个可执行文件，不能发布缺少编解码组件的安装包。

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
