# 抖音运营台

iPolloWork 插件集内置的抖音运营插件，参考 `xiaohongshu-ops` 的工作台、账号、草稿与会话/日程入口，使用独立的抖音官方 API 适配器。无需第三方运行依赖，需要 Node.js ≥22.22。

## 安装与连接

源码位于 iPolloWork 的 `examples/plugin-packages/douyin-ops`。本插件面向中国大陆抖音开放平台，不是国际版 TikTok API。根目录 `ipollowork.plugin.json` 为原生插件清单，`service/workbench.mjs` 为宿主启动入口；插件 ID 保持 `douyin-ops`。

已安装用户仍从主软件右侧 **＋ → 抖音运营台** 打开。开发环境从插件集读取源码，桌面安装包随主程序携带运行资源；账号、草稿、令牌和应用配置继续保存在用户插件数据目录。

1. 在抖音开放平台创建对应的移动/网站应用，核对应用实际可申请的能力。
2. 在工作台「账号」保存 Client Key、Client Secret、已登记的 **HTTPS 回调地址**。回调不能含自定义 query；不能直接填本机 HTTP 地址。
3. OAuth scope 默认只申请 `user_info`，按已获准能力追加需要的精确 scope。点击「开始官方授权」扫码，在跳转到登记地址后复制完整回调 URL（包含 `code` 和 `state`），粘贴回工作台完成连接。回调页面由应用接入方提供，本插件不会自动部署公网回调服务。
4. 选择账号，保存草稿，上传 MP4 或导入视频工作台生成的当前工作区文件，再点击发布。令牌不会显示在界面或模型结果中。

开发运行：`node examples/plugin-packages/douyin-ops/service/server.mjs`，终端会打印仅本机访问的带会话令牌地址。默认数据目录为 `~/.ipollowork/plugin-data/douyin-ops`；通过插件启动时使用宿主的私有插件数据目录。开发可配置 `DOUYIN_OPS_DATA_DIR`、`DOUYIN_OPS_WORKSPACE_ROOT` 和 `DOUYIN_OPS_PORT`。

## 官方接口范围

开放平台的个人、企业、系统服务商属于开发者或应用准入身份，不能直接推断某个已绑定抖音账号能否发布或回复。运行时以两层结果为准：应用先在能力管理中获批，账号再通过 OAuth 授予对应 Scope。工作台始终显示全部模块；切换账号后按实际 Scope 更新可用状态，缺少权限的真实操作会同时被界面和本地服务拦截。

| 功能 | 接口 | 权限 / 说明 |
| --- | --- | --- |
| 扫码授权 | `/platform/oauth/connect/` | `user_info` 及实际需要的权限 |
| 换取 / 刷新令牌 | `/oauth/access_token/`、`/oauth/refresh_token/` | 表单编码，令牌保存在服务端 |
| 账号身份 | `/oauth/userinfo/` | `user_info` |
| 上传与发布 | `/api/douyin/v1/video/upload_video/`、`/api/douyin/v1/video/create_video/` | `video.create.bind`；素材限制 128 MiB；文案最多 1000 字 |
| 作品列表 / 数据 | `/video/list/`、`/video/data/` | 历史 `video.list` / `video.data`；仅适用已开通对应权限的应用 |
| 评论 / 回复 | `/item/comment/list/`、`/item/comment/reply/` | 历史 `item.comment`；只操作授权用户自己作品的评论 |
| 视频搜索 | `/oauth/client_token/`、`/dy_open_api/v1/search/video/` | 应用能力 `aweme.dy.video_search`；需要真实 device_id 和翻页 search_id；不属于用户 OAuth scope |

路由与操作守卫使用以下权限矩阵：

| 工作台模块 | 判定来源 | 可用条件 |
| --- | --- | --- |
| 创作与发布 | 当前绑定账号 | `video.create.bind`；缺少时仍可进入页面查看，但发布按钮不可用 |
| 作品列表 | 当前绑定账号 | `video.list` |
| 单条作品数据 | 当前绑定账号 | `video.data` |
| 评论读取与回复 | 当前绑定账号 | `item.comment` |
| 视频搜索 | 当前应用 | 已配置应用凭据后允许调用；`aweme.dy.video_search` 的审批结果由官方 API 在调用时确认 |

账号 Scope 可以在授权回执和刷新回执中确认；搜索能力使用 `client_token`，不应加入用户 OAuth Scope。抖音开放平台还规定单次用户授权项不超过三个，实际接入应只申请当前场景所需权限，并通过再次授权补充其他场景。

历史权限不能自动替换为同名 `*.bind` 或小程序权限。缺少能力时返回明确提示并保留创作者中心 / 搜索网页入口。当前版本不提供任意第三方作品批量评论、图集发布、私信、直播或电商 API；网页入口本身不会自动执行或标记任务成功。

草稿 `title` 是本地名称；发布正文及话题来自 `text`。AI 起草使用当前宿主会话，保存后刷新工作台查看；图片/视频生成复用现有工作台。定时任务复用宿主日程和 `douyin-ops-dispatcher`。

## 发布结果与持久化

同一草稿重复提交复用已有操作。日程用固定 `runKey` / `operationKey`，回复操作标识绑定账号、目标和正文。明确平台回执才记为成功；网络超时、服务中断或无法识别的提交结果记为「待核对」，阻止该账号新写操作。核对抖音页面后在记录中填写依据，才能解除阻塞。成功回执表示平台接受提交，最终公开展示仍取决于审核。

SQLite 保存本地记录；凭据以 AES-GCM 加密，密钥文件与数据库位于私有目录（这不保护被完整复制的数据目录）。HTTP 服务只监听 127.0.0.1，随机端口和本机会话令牌，拒绝跨来源请求；上传限制大小且检查文件类型，工作区导入解析真实路径防止越界。当前最多50个账号、1000条执行记录；工作台只展示最近100条草稿/素材/任务，不声称全量统计。未知结果不自动重试，令牌按需刷新。

## 验证

在 iPolloWork 仓库运行 `pnpm --dir examples/plugin-packages/douyin-ops test`，覆盖官方 HTTP 契约、错误响应、权限、OAuth state、账号隔离、令牌刷新、素材路径、并发去重和结果核对。`pnpm --dir examples/plugin-packages/douyin-ops run check` 执行源文件语法检查；两者不依赖第三方运行服务。

`evals/flows/` 和 `evals/voiceovers/` 保存插件的界面验证。运行 `node examples/plugin-packages/douyin-ops/evals/run.mjs --flow douyin-ops --cdp-url <隔离浏览器的CDP地址>`。该流程使用模拟平台响应，会导航和调整目标浏览器尺寸，应使用单独的测试浏览器。只有验证工具复用宿主 fraimz，业务代码不依赖宿主源码路径。

测试使用模拟抖音响应，不代表生产凭据或平台权限已通过。真实扫码、线上发布和搜索需应用配置及平台权限后联调。

## 来源与许可

插件业务源码已归回 iPolloWork 插件集。原独立目录只作为迁移后的可恢复副本，不再是维护来源。许可及署名见 [LICENSE](LICENSE) 和 [历史 MIT 许可](LICENSES/MIT-legacy.txt)。账号、令牌、应用密钥和本地数据库不随源码提交。

接口核对来源（2026-09-11）：[角色与权限](https://developer.open-douyin.com/docs/resource/zh-CN/developer/introduction/type-and-permission)、[登录与授权](https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/opensdk/user-authorization/solution)、[OAuth 授权](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/douyin-get-permission-code)、[令牌交换](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/get-access-token)、[视频上传](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/upload-video)、[视频发布](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create)、[官方搜索](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/douyin-search-capability/aweme-dy-video-search)、[历史作品列表](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/search-video/account-video-list)、[历史评论接口](https://open.douyin.com/platform/resource/docs/openapi/interaction-management/comment-management-user/comment-list)。

## 安装与更新

主软件插件目录直接读取本仓库中的清单和资源，桌面构建把相同运行资源装入应用。修改时同步提升 `package.json`、插件清单和工作台版本，通过检查后在主软件插件列表安装或更新。插件 ID、update ID 和用户数据路径保持不变，账号、草稿及登录数据会沿用。
