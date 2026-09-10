# 抖音运营台

iPolloWork 插件，参考 `xiaohongshu-ops` 的工作台、账号、草稿与会话/日程入口，使用独立的抖音官方 API 适配器。无需第三方运行依赖，需要 Node.js ≥22.22。

## 安装与连接

在包含此版本的 iPolloWork 插件目录安装「抖音运营台」，从右侧加号打开。插件目录注册在 `apps/server/src/plugin-package-catalog.ts`。这是含本地可执行服务的插件，当前通过仓库内置目录安装；通用导入器会拒绝未受信任签名的本地代码包，因此源码 ZIP 不宣称可直接在市场导入。

1. 在抖音开放平台创建对应的移动/网站应用，核对应用实际可申请的能力。
2. 在工作台「账号」保存 Client Key、Client Secret、已登记的 **HTTPS 回调地址**。回调不能含自定义 query；不能直接填本机 HTTP 地址。
3. OAuth scope 默认只申请 `user_info`，按已获准能力追加需要的精确 scope。点击「开始官方授权」扫码，在跳转到登记地址后复制完整回调 URL（包含 `code` 和 `state`），粘贴回工作台完成连接。回调页面由应用接入方提供，本插件不会自动部署公网回调服务。
4. 选择账号，保存草稿，上传 MP4 或导入视频工作台生成的当前工作区文件，再点击发布。令牌不会显示在界面或模型结果中。

独立开发运行：`node service/server.mjs`，终端会打印仅本机访问的带会话令牌地址。默认数据目录为 `~/.ipollowork/plugin-data/douyin-ops`；通过插件启动时使用宿主的私有插件数据目录。开发可配置 `DOUYIN_OPS_DATA_DIR`、`DOUYIN_OPS_WORKSPACE_ROOT` 和 `DOUYIN_OPS_PORT`。

## 官方接口范围

| 功能 | 接口 | 权限 / 说明 |
| --- | --- | --- |
| 扫码授权 | `/platform/oauth/connect/` | `user_info` 及实际需要的权限 |
| 换取 / 刷新令牌 | `/oauth/access_token/`、`/oauth/refresh_token/` | 表单编码，令牌保存在服务端 |
| 账号身份 | `/oauth/userinfo/` | `user_info` |
| 上传与发布 | `/api/douyin/v1/video/upload_video/`、`/api/douyin/v1/video/create_video/` | `video.create.bind`；素材限制 128 MiB；文案最多 1000 字 |
| 作品列表 / 数据 | `/video/list/`、`/video/data/` | 历史 `video.list` / `video.data`；仅适用已开通对应权限的应用 |
| 评论 / 回复 | `/item/comment/list/`、`/item/comment/reply/` | 历史 `item.comment`；只操作授权用户自己作品的评论 |
| 视频搜索 | `/oauth/client_token/`、`/dy_open_api/v1/search/video/` | 应用能力 `aweme.dy.video_search`；需要真实 device_id 和翻页 search_id；不属于用户 OAuth scope |

历史权限不能自动替换为同名 `*.bind` 或小程序权限。缺少能力时返回明确提示并保留创作者中心 / 搜索网页入口。当前版本不提供任意第三方作品批量评论、图集发布、私信、直播或电商 API；网页入口本身不会自动执行或标记任务成功。

草稿 `title` 是本地名称；发布正文及话题来自 `text`。AI 起草使用当前宿主会话，保存后刷新工作台查看；图片/视频生成复用现有工作台。定时任务复用宿主日程和 `douyin-ops-dispatcher`。

## 发布结果与持久化

同一草稿重复提交复用已有操作。日程用固定 `runKey` / `operationKey`，回复操作标识绑定账号、目标和正文。明确平台回执才记为成功；网络超时、服务中断或无法识别的提交结果记为「待核对」，阻止该账号新写操作。核对抖音页面后在记录中填写依据，才能解除阻塞。成功回执表示平台接受提交，最终公开展示仍取决于审核。

SQLite 保存本地记录；凭据以 AES-GCM 加密，密钥文件与数据库位于私有目录（这不保护被完整复制的数据目录）。HTTP 服务只监听 127.0.0.1，随机端口和本机会话令牌，拒绝跨来源请求；上传限制大小且检查文件类型，工作区导入解析真实路径防止越界。当前最多50个账号、1000条执行记录；工作台只展示最近100条草稿/素材/任务，不声称全量统计。未知结果不自动重试，令牌按需刷新。

## 验证

`node --test tests/*.test.mjs` 覆盖官方 HTTP 契约、错误响应、权限、OAuth state、账号隔离、令牌刷新、素材路径、并发去重和结果核对。`pnpm run check` 执行源文件语法检查；依赖已就绪的宿主中可运行 `bun test apps/server/src/plugin-package-manifest.test.ts apps/server/src/plugin-package-lifecycle.test.ts` 验证目录和安装。

测试使用模拟抖音响应，不代表生产凭据或平台权限已通过。真实扫码、线上发布和搜索需应用配置及平台权限后联调。

接口核对来源（2026-09-10）：[OAuth 授权](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/douyin-get-permission-code)、[令牌交换](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/get-access-token)、[视频上传](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/upload-video)、[视频发布](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create)、[官方搜索](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/douyin-search-capability/aweme-dy-video-search)、[历史作品列表](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/search-video/account-video-list)、[历史评论接口](https://open.douyin.com/platform/resource/docs/openapi/interaction-management/comment-management-user/comment-list)。
