# iPolloWork 通知中心

[English](README.md) | 中文

安装 iPolloWork DSH 套件后，点击 DSH 侧栏头像旁的铃铛打开「通知中心」。可查看各来源的通知、按未读筛选、打开原详情或标为已读。侧栏收窄后，入口会保留图标和未读提示。

在「设置 → 通知」可以逐个启用或关闭已接入的来源。新来源默认开启，开关随 DSH 配置保存。关闭后，该来源的条目和未读数从中心隐藏。重新开启后按来源当前的已读状态显示。

首批接入 DSH 会话未读更新和项目看板任务通知。套件会同时装载两项。独立开发配置中的看板需 0.4.9 或以上版本，沿用组织通知收件箱及原来的已读状态。会话未读使用 DSH 原生状态，阅读后移出列表，生命周期与运行中的 DSH Host 一致。中心本身不另存历史，也不更改来源的已读数据格式。

## 通知接入规则

客户端插件通过可选服务 `ipolloNotificationCenter` 注册。套件通过 `@ipollo/dsh-suite/notifications` 导出类型。独立开发包也可用 `@ipollo/dsh-notification-center/contract`。

```ts
ctx.inject(['ipolloNotificationCenter'], scope => scope.effect(() =>
  scope.ipolloNotificationCenter.registerSource('ipollo.example', {
    label: () => strings().example,
    getSnapshot: feed.getSnapshot,
    subscribe: feed.subscribe,
    markRead: id => feed.markRead(id),
    open: id => feed.open(id),
  }),
))
```

1. 用唯一且稳定的来源名，以小写字母开头，可包含小写字母、数字、点和连字符。通知 ID 在来源和接收者范围内保持稳定。同一事件更新沿用原 ID，需要单独确认的新事件使用新 ID。
2. 提供纯文本、UTC 毫秒时间戳、来源真实的已读状态，以及可选的 `info`、`action`、`success` 或 `error`。按可确认的结果发通知，例如定时指令已投递只代表触发，任务成功要等到实际执行完成。
3. 同步提供一个按时间倒序的快照，每个来源最多 200 条已授权的通知。异步请求留在来源内。首次读取、已读写入成功、收到新事件、语言或账号权限变化时发出更新。切换账号或撤销权限时，清空旧账号数据并取消过期请求。
4. 来源负责持久化、保留期限、投递、已读写入与权限校验，使用自己的鉴权接口。中心只在内存汇总，不把通知写入浏览器存储。通知内容不得包含令牌、私有提示词、成果正文或其他机密。
5. 用 `open(id)` 按当前权限打开实际对话或详情，先用当前数据重新解析 ID。禁止传任意 URL 或 HTML。如果打开即已读，应在内容成功打开后确认。
6. 注册与插件生命周期绑定，返回注销函数。中心未安装时保留必要的独立入口。任务指派、待决事项、执行结果和需要处理的失败适合进中心。表单的临时反馈留在原操作位置。

## 构建与验证

从仓库根目录运行 `npm run setup:build` 准备固定版本的 DSH 类型。在本目录执行 `npm ci --workspaces=false`、`npm run check`、`npm run pack:check` 和 `npm pack`，独立归档供开发验证，日常使用安装套件即可。

每次升级 DSH 固定版本时，使用临时配置，检查两种主题和窄屏上头像旁的铃铛入口。安装看板和账号桥接后，验证组织指派能在接收者的中心出现、打开真实任务，刷新后保留已读。验证原生会话通知能打开对应对话，并由原生已读状态清除角标。再验证账号切换以及中心未安装时看板的独立入口。
