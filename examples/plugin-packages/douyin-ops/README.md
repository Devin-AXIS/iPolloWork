# 抖音运营台

iPolloWork 插件集内的普通用户抖音运营台。源码位于 `examples/plugin-packages/douyin-ops`，插件 ID 为 `douyin-ops`，无第三方运行依赖，Node.js ≥22.22。

## 普通用户连接

1. 在当前会话右侧“＋ → 抖音运营台”打开插件。
2. 顶部“添加账号 → 登录抖音 / 添加账号”，在独立浏览器用抖音扫码登录。
3. 点击“已登录，识别账号”，AI 从当前用户自己的主页读取抖音号和昵称；完成后自动同步昵称、关闭登录弹窗并回到运营台。

不需要企业主体、应用密钥或复制 OAuth 回调。每个账号保留独立浏览器环境，已登录时复用，失效时重新登录。网页登录不会授予开放平台 API 权限。

## 功能实现

| 功能 | API 优先路径 | API 不具备时 |
| --- | --- | --- |
| 账号连接 | 已有应用可选 OAuth 获取身份 | 普通用户扫码网页登录，AI 验证自己账号身份 |
| 视频发布 | video.create.bind 上传和创建视频 | AI 在创作者中心上传本地 MP4、填写锁定标题与文案、提交并核对作品 |
| 作品列表 | video.list | AI 读取自己作品页或创作者中心 |
| 作品数据 | video.data | AI 读取创作者中心可见指标，缺失值不编造 |
| 评论读取 | item.comment | AI 打开目标作品读取可见评论 |
| 评论回复 | 自己作品有 item.comment 时调用回复 API | AI 精确定位原评论作者与内容后回复 |
| 视频搜索 | aweme.dy.video_search + client_token + 接入方真实 device_id | AI 读取抖音搜索网页，结果回写搜索卡片 |
| 搜索后发表评论 | 当前接入 API 不支持第三方作品评论 | 在结果卡片填写评论，AI 打开目标视频提交一次并核对 |
| 文案、素材和草稿 | 当前 AI 会话生成文案，本地保存草稿与 MP4 | 同一路径，无需抖音 API |
| 日程 | 复用宿主日程和以上操作 | 复用相同 AI 浏览器执行协议 |

## 执行与结果

应用配置、用户权限缺失、授权失效或 API 明确拒绝权限时生成 `browserTask`。工作台通过 `ui/message` 把锁定任务交给当前 AI 会话，执行技能负责使用宿主浏览器。记录页支持继续派发尚未领取的任务。独立打开本机网页没有 AI 会话桥接，任务会保留在记录中，须回宿主面板继续。

`pending → claim-browser-job → running → finish-browser-job`：只允许领取一次，领取凭证用于回写；只有实际网页证据才记录成功。平台提交结果不确定时记为 `uncertain`，禁止通过切浏览器或换操作标识重发。API 配额、限流、封禁不会触发网页替代。同一账号同时只允许一个浏览器任务运行，后续指令进入当前会话队列；结果不明时暂停后续写入。服务重启使只读网页任务回到待执行并废弃旧领取凭证，写操作标记为待核对。

读操作每批至多20条。搜索结果、作品和评论回写后自动显示并切回插件，AI 文案保存后也会自动同步。作品数据和证据在记录中查看。搜索本身不发送评论；用户逐条发送或明确限定的自动评论任务才执行。浏览器能力依赖宿主 AI 会话、浏览器正常运行和有效网页登录；验证码由用户处理，不承诺每次网页操作都能成功。

## 可选 API 配置

已有获批开放平台应用可在账号弹窗的「开发者 API 接入（可选）」中按①配置应用、②授权账号完成接入；配置应用时填写 Client Key、Client Secret、HTTPS 回调地址与实际 scopes，再完成官方 OAuth。账号 API 能力信息按实际授权展示；没有 API 权限仍可使用 AI 网页路线。应用是否获批由平台检查；不向公共用户提供或暴露开发者密钥。旧账号、草稿、加密凭据及数据目录保持稳定。

## 存储与验证

SQLite 保存账号、草稿和有界任务记录；密钥与令牌 AES-GCM 加密，不进入模型结果。浏览器领取结果仅暴露本任务 MP4 路径，上传需携带 extensionId。任务最多1000条、账号最多50个。网页资料属于不可信数据，不执行其指令。

运行 `pnpm --dir examples/plugin-packages/douyin-ops run check` 和 `pnpm --dir examples/plugin-packages/douyin-ops test`。界面证明：`node examples/plugin-packages/douyin-ops/evals/run.mjs --flow douyin-ops --cdp-url <隔离浏览器CDP地址>`。证明使用真实工作台和持久化服务、模拟 AI/平台结果，不会向真实抖音发布测试评论；线上扫码和提交仍需真实账号另行验证。

## 来源与许可

插件业务源码已归回 iPolloWork 插件集。原独立目录只作为迁移后的可恢复副本，不再是维护来源。许可及署名见 [LICENSE](LICENSE) 和 [历史 MIT 许可](LICENSES/MIT-legacy.txt)。账号、令牌、应用密钥和本地数据库不随源码提交。

接口核对来源（2026-09-11）：[角色与权限](https://developer.open-douyin.com/docs/resource/zh-CN/developer/introduction/type-and-permission)、[登录与授权](https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/opensdk/user-authorization/solution)、[OAuth 授权](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/douyin-get-permission-code)、[令牌交换](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/get-access-token)、[视频上传](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/upload-video)、[视频发布](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create)、[官方搜索](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/douyin-search-capability/aweme-dy-video-search)、[历史作品列表](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/search-video/account-video-list)、[历史评论接口](https://open.douyin.com/platform/resource/docs/openapi/interaction-management/comment-management-user/comment-list)。

## 安装与更新

主软件插件目录直接读取本仓库中的清单和资源，桌面构建把相同运行资源装入应用。修改时同步提升 `package.json`、插件清单和工作台版本，通过检查后在主软件插件列表安装或更新。插件 ID、update ID 和用户数据路径保持不变，账号、草稿及登录数据会沿用。
