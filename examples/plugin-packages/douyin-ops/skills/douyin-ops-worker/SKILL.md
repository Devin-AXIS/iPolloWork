---
name: douyin-ops-worker
description: 在抖音运营台管理 OAuth 账号、保存视频草稿、导入视频工作台素材、通过官方 API 发布视频、查询作品数据和评论、回复指定评论及搜索视频。用户要求抖音账号运营、发布、评论、搜索或打开运营台时使用。
---

# 抖音运营执行

先调用 `ipollowork_extension_list_actions` 查看 `extensionId=douyin-ops`，通过 `ipollowork_extension_call` 调用下列操作。打开页面用 `open-workbench`，宿主直接启动本机工作台。无需安装依赖；运行需要 Node.js 22.22 或更新版本。

## 账号与凭据

- `list-accounts` 获取真实 OAuth `openId`、昵称、账号 ID 和已授予 `scopes`。按用户指定账号选定，不自动换号。
- Client Key、Client Secret、已登记的 HTTPS 回调地址在工作台「账号」中填写。不要让用户在聊天中提供密钥，不读取数据库、密钥文件或平台令牌。
- 使用工作台「开始官方授权」扫码后，把完整回调地址粘贴回工作台。回调必须包含本次 `state` 和 `code`，有效期十分钟且只可使用一次。
- `openId` 是应用内的 OAuth 标识，不是用户页面展示的抖音号。不能把它当作网页登录验证依据。
- API 按该接口精确 scope 检查授权；历史权限与 `*.bind`、小程序权限不可互换。权限不足时说明缺少的 scope，不能编造 API 数据或把网页打开视为授权完成。

## 草稿、素材与发布

1. `studio-state` 查看当前草稿、素材和执行记录。最近记录有数量上限；已知操作用 `get-job` 精确查询。
2. 用当前会话起草文案。`save-draft(accountId,title,text,assetId?,id?)` 保存，文案最多 1000 字。`title` 是本地草稿名；提交到抖音的是 `text`，话题直接写入 `text`。
3. 视频由已有视频工作台生成后，`import-media(sourcePath)` 导入当前工作区真实 MP4 文件，最多 128 MiB。把返回素材 ID 写入草稿。导入不会发布，也不接受远程下载地址。
4. 用户要求发布指定账号的这份内容后，`publish-draft(accountId,draftId,operationKey)` 上传并发布。`operationKey` 一经选定，重试必须原样使用。API 要求 `video.create.bind`；发起后草稿锁定。不要因为回复慢就创建新草稿重发。
5. `job.status=succeeded` 表示平台给出了 `item_id` 回执，最终展示取决于抖音审核，不保证立即公开。`uncertain` 表示需要去抖音核对，不可重发。`failed` 表示明确失败；查看原因再准备新草稿。

## 数据、评论与搜索

- `list-videos(accountId,cursor?,count?)`：官方历史 `video.list` 接口，单页最多 20 条。
- `video-data(accountId,itemIds)`：历史 `video.data` 接口，一次 1–20 个当前授权用户作品。作品 ID 必须来自真实结果；不要猜测 opaque ID。
- `list-comments(accountId,itemId,cursor?,count?)`：历史 `item.comment` 接口。`reply-comment(accountId,itemId,commentId,content,operationKey)` 只回复用户指定的自己作品评论，最多 300 字。先读评论上下文，保存稳定操作标识，再按用户授权发送。
- `search-videos(keyword,deviceId,cursor?,searchId?,count?)` 使用应用 `client_token` 和 `aweme.dy.video_search` 能力。`deviceId` 必须是接入方按平台要求提供的设备标识，不得编造。后续页完整传回原 `search_id` 和 `cursor`；大整数按字符串原样传递。该权限不加入用户 OAuth scope。
- 搜索结果可用于筛选和起草。当前插件没有对任意第三方作品批量发评的 API 操作，不把自己的作品回复接口用于第三方作品。
- `browser-target(accountId?,kind,keyword?)` 返回官方创作者中心或搜索入口。宿主 `ui/open-link` 接收未加前缀的 `browserProfileId`；调用原生浏览器工具时使用 `profileId="douyin-ops:" + browserProfileId` 并保留 tabId。缺少 API 权限时可按用户要求在可见页面完成工作，但须先实际核对网页账号身份、目标内容及宿主审批设置。网页操作不自动生成 API 成功回执。

## 结果核对

`get-job(jobId)` 查询状态。`uncertain` 会阻止该账号新写操作；在用户或实际浏览器证据确认结果后，用 `resolve-job(jobId,outcome,evidence)` 保存具体核对依据。不能用“我猜失败了”解除阻塞。该操作只记录结果，不重复提交。

工作台服务和数据保存在宿主为插件提供的私有目录；密钥和令牌加密存储，不进入模型结果。不要复制其他工作区或小红书的登录状态。
