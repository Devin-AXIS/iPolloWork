# 桌面端可选资源下载契约

本文供云平台、桌面端和发布流程对接。目标是让用户在应用内按需下载 Codex、DeepSeek 和视频功能资源，减少桌面安装包体积。本文描述待实现的接口契约；除引擎包现有的 GitHub Release 下载流程外，云平台接口和视频资源下载尚未实现。

## 当前打包边界

| 资源 ID | 构建来源 | 当前状态 | 客户端触发时机 |
| --- | --- | --- | --- |
| `codex-harness` | `apps/desktop/codex-runtime`，由 `apps/desktop/scripts/package-engine-runtime.mjs` 产出 `ipollowork-engine-codex-harness-<platform>-<arch>-<version>.tar.gz` | 已有安装、校验和 GitHub Release 下载逻辑；Windows/Linux 仍内置压缩包，macOS 只内置校验文件 | 用户安装 Codex 引擎 |
| `deepseek-harness` | `apps/desktop/dsh-runtime`，同一脚本产出 `ipollowork-engine-deepseek-harness-<platform>-<arch>-<version>.tar.gz` | 同上 | 用户安装 DeepSeek 引擎 |
| `hyperframes-runtime` | `apps/desktop/scripts/prepare-hyperframes-runtime.mjs` 产出的 `apps/desktop/hyperframes-runtime` | 打包在 `resources/hyperframes`；客户端目前直接查找该本地路径 | 首次使用视频预览、编辑或渲染 |
| `hyperframes-registry` | `vendor/hyperframes/registry` | 打包在 `resources/hyperframes/registry`；服务端从本地读取组件 | 首次使用视频组件库，可与运行时同时下载 |
| `ffmpeg`、`ffprobe` | `apps/desktop/package.json` 中的 `@ffmpeg-installer/ffmpeg`、`@ffprobe-installer/ffprobe` 对应平台二进制 | 桌面端目前从安装目录或系统路径查找；尚无独立发布包 | 首次执行需要媒体编解码的功能，可与视频资源同时下载 |

引擎包命名、版本和 SHA-256 以**当次发布构建产物**为准，不以开发机缓存为准。现有引擎管理器把下载结果安装到 Electron `userData/engine-packs`，并校验 SHA-256。发布流程已将引擎压缩包及 `.sha256` 上传到 GitHub Release；云平台可同步这些不可变产物，不需要重新编译引擎。

视频资源目前没有可供云端上传的独立压缩包。发布流程需要新增按平台和架构生成的产物，并保存版本、文件大小和 SHA-256。`hyperframes-runtime` 与 `hyperframes-registry` 可以是两个包，但必须在同一个视频功能版本中声明兼容关系；桌面端应在全部必需包就绪后才启用视频功能。FFmpeg 和 FFprobe 是原生可执行文件，分别发布对应平台和架构的包，并保留许可证材料。

建议新增产物名为 `ipollowork-hyperframes-runtime-<platform>-<arch>-<version>.tar.gz`、`ipollowork-hyperframes-registry-<version>.tar.gz`、`ipollowork-ffmpeg-<platform>-<arch>-<version>.tar.gz` 和 `ipollowork-ffprobe-<platform>-<arch>-<version>.tar.gz`。组件库内容可跨平台共用，但清单仍须声明它与当前桌面版本和视频运行时兼容。原生二进制在 macOS 上的签名与下载后可执行性需要由发布流程和桌面端共同验证。

## 云平台接口

建议提供一个只读资源清单接口，下载流量走对象存储/CDN：

```http
GET /api/v1/desktop/resources?appVersion=0.50.13&platform=windows&arch=x64
```

`platform` 取 `windows`、`macos`、`linux`；`arch` 取 `x64`、`arm64`。云平台只返回已经完成发布并与**精确 appVersion** 匹配的平台资源；不自动回退到 `latest` 或其他版本。未支持的平台组合或版本返回明确的 404，暂未发布完成返回 503。

```json
{
  "schemaVersion": 1,
  "appVersion": "0.50.13",
  "platform": "windows",
  "arch": "x64",
  "resources": [
    {
      "id": "codex-harness",
      "version": "<engine-version>",
      "fileName": "ipollowork-engine-codex-harness-windows-x64-<engine-version>.tar.gz",
      "format": "tar.gz",
      "sizeBytes": 0,
      "sha256": "<64 lowercase hex characters>",
      "url": "https://<cdn>/<immutable-object-key>"
    }
  ]
}
```

示例中的 `sizeBytes` 和占位值由实际发布产物填充；实际 `sizeBytes` 必须大于零。每个资源使用固定 `id`，`version` 是资源版本，`appVersion` 是兼容的桌面版本；二者不必相同。若资源必须与其他资源一起安装，可增加 `requires`，列出同一清单内的资源 ID。云平台可以对私有资源返回短期有效的签名 URL，但客户端应能在 URL 过期后重新取得清单。对象地址不能被同名覆盖：新内容必须使用新版本或新对象键。

下载端需要 `Content-Length`，并建议支持 `HEAD`、`Range`、`ETag`，便于显示进度和断点续传。服务端应设置合理的 CDN 缓存和超时，并在对象缺失时返回明确错误，不能返回 HTML 错误页作为资源文件。

## 完整性与安装约束

这些资源包含可执行代码。SHA-256 不能只从同一个可修改的云端响应取得并直接信任；发布流程应生成受信任的资源清单，再由应用内置其摘要或公钥验证签名清单。现有引擎包内置 `.sha256` 的方式可作为过渡，但切换云端时仍需保持同等级的信任来源。

桌面端先下载到用户数据目录中的临时文件，核对大小和 SHA-256，检查归档路径安全，再解压到临时目录；成功后原子切换到新版本。失败时保留可用旧版本，清理未完成文件，并允许用户重试。缓存按 `id/platform/arch/version` 区分，不写入应用安装目录，以免更新或卸载时丢失用户已下载资源。

现有客户端还需调整以下位置，云接口上线本身不会让安装包变小：

1. `apps/desktop/electron-builder.yml`：Windows/Linux 引擎包改为只保留受信任校验材料；移除已改为远程下载的视频资源和媒体二进制打包项。
2. `apps/desktop/electron/engine-package-manager.mjs`：在保持已有本地安装和校验流程的前提下，接入云资源清单与 URL；保留已安装版本的离线可用性。
3. `apps/desktop/electron/main.mjs`、`apps/server/src/extensions/video-components.ts`：从用户数据目录解析下载后的 HyperFrames、组件库、FFmpeg 和 FFprobe，并在缺失时显示明确的下载入口。
4. 发布流水线：从同一提交生成所有平台产物、可信清单和校验值，上传完成并验证可下载后，再发布对应桌面版本。

## 交付验收

- 对同一 `appVersion/platform/arch`，接口返回的文件名、大小和 SHA-256 与发布产物逐字节一致；不存在的组合不会返回其他平台资源。
- 客户端分别完成 Codex、DeepSeek 和视频资源的首次下载、安装、再次启动复用；损坏文件、下载中断及磁盘不足不会替换可用旧版本。
- 无网络时，已安装资源仍可使用；未安装资源显示可理解的下载失败或离线提示。
- 分别比较变更前后的 Windows 安装包、macOS DMG/ZIP 和 Linux 包体积，并检查安装后的 `app.asar`、`resources`，确认目标资源确实不再随包发出。

本次已先处理模板的重复打包：`server/dist/bundled-templates` 不再进入 `app.asar`；独立资源目录只保留供本地模板安装的目录和索引文件，不再附带与目录内容重复的 `.ipwp` 归档。模板的远程下载不在上述云接口范围内。
