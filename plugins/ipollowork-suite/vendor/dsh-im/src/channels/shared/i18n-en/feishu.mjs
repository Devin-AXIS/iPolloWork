// English translations (feishu area). Keys are exact Chinese literals passed to t().
export default {
  '这里需要填写用户的 Open ID，不能填写机器人自己的 Open ID。':
    'Enter a user Open ID here, not the bot’s own Open ID.',
  '已结束本轮提问，将在当前会话中继续处理图片。':
    'The questions have been closed. Your image will be processed in this conversation.',
  '图片已排队，但暂时无法结束当前提问。请先回答问题或发送 /stop，结束后会继续处理图片。':
    'Your image is queued, but the current questions could not be closed. Answer them or send /stop; your image will be processed afterward.',
  '⏹ 提问已结束{progress}': '⏹ Questions closed{progress}',
  '内容已合并至后续消息。': 'Content has been consolidated into the following messages.',
  // feishu/bridge.mjs — welcome / help
  '北汇星河 AIOS 已连接 DeepSeek Harness。':
    'BeiHui XingHe AIOS is connected to DeepSeek Harness.',
  '/repair  补全飞书权限与卡片回调': '/repair  Complete Feishu permissions and the card callback',
  '/m（或 /menu）  打开交互卡片菜单': '/m (or /menu)  Open the interactive card menu',
  '/watch [Session ID 或序号]  关注会话，任务完成自动推送':
    '/watch [Session ID or index]  Watch a session; completion is pushed automatically',
  '/unwatch [Session ID 或序号]  取消关注':
    '/unwatch [Session ID or index]  Stop watching',
  '/watchlist  查看关注列表': '/watchlist  View the watch list',
  '/archived on|off  会话列表是否包含归档会话':
    '/archived on|off  Whether the session list includes archived sessions',
  '工作区必须是绝对路径。': 'The workspace must be an absolute path.',
  '工作区路径不存在。': 'The workspace path does not exist.',
  '工作区路径必须指向一个目录。': 'The workspace path must point to a directory.',
  '机器人正在移除或已重新接入，无法操作原会话的工作区。':
    'The bot is being removed or has been reconnected; the original session’s workspace cannot be changed.',
  '操作失败，请稍后重试。': 'The operation failed. Please try again later.',
  '结果文件「{name}」已生成，但机器人缺少飞书文件上传权限 im:resource。请私聊机器人执行 /repair 命令，或者在「IM机器人」设置页点击“补全权限”按钮并扫码。完成飞书要求的发布审批后重试。':
    'The result file "{name}" was generated, but the bot lacks the Feishu file-upload scope im:resource. Run /repair in a direct chat with the bot, or click the “Complete permissions” button on the IM Bot settings page and scan the QR code. Complete any publishing approval Feishu requires, then try again.',
  '结果文件「{name}」超过飞书 30 MB 上限，未发送。':
    'The result file "{name}" exceeds the Feishu 30 MB limit and was not sent.',
  '结果文件「{name}」为空，飞书不允许发送空文件。':
    'The result file "{name}" is empty; Feishu does not allow sending empty files.',
  '结果文件「{name}」暂时被飞书限流，未能发送，请稍后重试。':
    'The result file "{name}" was temporarily rate-limited by Feishu and could not be sent. Please try again later.',
  '结果文件「{name}」已生成，但暂时未能发送，请稍后重试。':
    'The result file "{name}" was generated but could not be sent right now. Please try again later.',
  '处理失败，请稍后重试。如果问题持续，请在 DeepSeek Harness 的「IM机器人」设置页检查飞书连接状态。':
    'Message processing failed. Please try again later. If the problem persists, check the Feishu connection status on the IM Bot settings page in DeepSeek Harness.',
  '已开启全新 Harness 会话。': 'A brand-new Harness session has started.',
  '飞书机器人与 DeepSeek Harness 连接正常。':
    'The Feishu bot is connected to DeepSeek Harness and working normally.',
  '用法：/archived on（包含归档会话）或 /archived off（隐藏归档会话）':
    'Usage: /archived on (include archived sessions) or /archived off (hide archived sessions)',
  '已开启：会话列表包含归档会话。': 'On: the session list includes archived sessions.',
  '已关闭：会话列表隐藏归档会话。': 'Off: the session list hides archived sessions.',

  // feishu/bridge.mjs — repair flow
  '为避免授权链接暴露，请私聊机器人发送 /repair。':
    'To keep the authorization link private, send /repair to the bot in a direct message.',
  '无法识别当前发送者，未发起修复。':
    'The current sender could not be identified, so repair was not started.',
  '当前 Host 版本暂不支持聊天内修复，请先更新插件。':
    'The current Host version does not support in-chat repair. Update the plugin first.',
  '用法：/repair、/repair qr、/repair status、/repair cancel 或 /repair verify':
    'Usage: /repair, /repair qr, /repair status, /repair cancel, or /repair verify',
  '当前 Runtime 没有可恢复的修复任务记录（机器人可能刚完成密钥更新并重启）。本命令不会启动新的授权；请查看机器人发送的验证结果，确认上一次任务已结束后再发送 /repair。':
    'The current Runtime has no recoverable repair attempt (the bot may have just rotated its secret and restarted). This command starts no new authorization. Check the verification result the bot sent, then send /repair after the previous attempt has finished.',
  '另一位用户正在修复该机器人，本次不会显示其授权信息。':
    'Another user is repairing this bot; its authorization info will not be shown this time.',
  '暂时无法取消修复任务，请稍后重试。':
    'Could not cancel the repair task right now. Please try again later.',
  '暂时无法取消旧修复任务，未生成新链接；请稍后重试。':
    'Could not cancel the previous repair attempt, so no new link was generated. Please try again later.',
  '暂时无法查询修复状态，请稍后重试。':
    'Could not check the repair status right now. Please try again later.',
  '修复流程暂时失败，现有机器人连接不受影响；请稍后发送 /repair 重试。':
    'The repair flow failed for now; the existing bot connection is unaffected. Send /repair again later.',
  '飞书返回了无法安全验证的授权链接，已中止本次修复。':
    'Feishu returned an authorization link that cannot be verified safely. This repair was aborted.',
  '飞书未返回授权链接，已中止本次修复。':
    'Feishu did not return an authorization link. This repair was aborted.',
  '授权已确认，正在发送并等待测试按钮回调；收到真实回调后才会完成。':
    'Authorization confirmed. Sending a test button and waiting for its callback; this completes only after a real callback arrives.',
  '修复状态查询中断，现有机器人连接不受影响；发送 /repair status 重试查询。':
    'The repair status query was interrupted; the existing bot connection is unaffected. Send /repair status to retry.',
  '链接为短期有效': 'The link is valid for a short time.',
  '链接约 {minutes} 分钟后过期': 'The link expires in about {minutes} minutes',
  '旧授权链接已作废，已生成新的修复链接。':
    'The previous authorization link was invalidated and a new repair link was generated.',
  '🔧 准备补全权限与回调。': '🔧 Preparing to complete permissions and the callback.',
  '本次会增量添加当前缺少项：卡片回调 card.action.trigger；im:message.group_msg（用于接收未 @ 的群消息）；飞书显示为“获取单聊、群组消息”的租户权限 im:message:readonly（用于读取用户消息中的图片或文件）；im:resource（用于上传机器人发送的图片或文件）；im:message.group_at_msg.include_bot:readonly（用于接收群内其他机器人 @ 当前机器人的消息）；以及原生命令面板所需的 application:app_slash_command:read / write。群回复方式保持不变，实际收到的群消息和文件会自动保存。确认页只会显示当前缺少的项；若出现上述范围之外的配置，请取消。':
    'This incrementally adds the currently missing items: the card callback card.action.trigger; im:message.group_msg for group messages without mentions; the tenant scope im:message:readonly, shown by Feishu as “Read direct and group messages” and used to read images or files in user messages; im:resource, used to upload images or files sent by the bot; im:message.group_at_msg.include_bot:readonly, used to receive group messages from other bots that mention this bot; and application:app_slash_command:read / write for the native command panel. The group reply mode stays unchanged, and received group messages and files are saved automatically. The confirmation page shows only items the app is currently missing; cancel if anything outside this scope appears.',
  '当前设备直接打开：': 'Open directly on this device:',
  '若要用另一台设备扫码，发送 /repair qr。{expiry}。':
    'To scan with another device, send /repair qr. {expiry}.',
  '请用另一台设备扫码完成授权{remaining}。':
    'Complete authorization by scanning with another device{remaining}.',
  '（剩余约 {minutes} 分钟）': ' (about {minutes} minutes left)',
  '二维码暂时无法发送，请直接打开授权链接：\n{url}':
    'The QR code could not be sent. Open the authorization link directly:\n{url}',
  '授权链接已过期；平台未返回成功结果，无法确认已修复。发送 /repair 生成新链接。':
    'The authorization link expired; the platform returned no success, so the repair cannot be confirmed. Send /repair for a new link.',
  '已取消本次修复授权，未确认完成修复。':
    'Repair authorization was cancelled; the repair was not confirmed.',
  '你已取消或拒绝授权，没有确认修复；发送 /repair 可重试。':
    'You cancelled or declined authorization, so the repair was not confirmed. Send /repair to retry.',
  '授权已提交，但未收到测试按钮回调。可能尚未点击或配置仍在传播；稍后发送 /repair verify 查询，不要盲目重复授权。':
    'Authorization was submitted, but no test-button callback arrived. It may not have been tapped yet, or the config is still propagating. Send /repair verify later to check; do not authorize blindly again.',
  '修复流程暂时失败，现有机器人连接不受影响；发送 /repair 可重试。':
    'The repair flow failed for now; the existing bot connection is unaffected. Send /repair to retry.',
  '授权已确认，正在等待专用测试按钮的真实回调；回调到达前不会宣告成功。':
    'Authorization confirmed. Waiting for the real callback from the dedicated test button; success is not declared until it arrives.',
  '授权尚未完成，暂时不能验证卡片按钮。请先打开授权链接并确认。':
    'Authorization is not complete, so the card buttons cannot be verified yet. Open the authorization link and confirm first.',
  '修复任务正在等待授权{remaining}。发送 /repair qr 可获取二维码，/repair cancel 可取消。':
    'The repair task is waiting for authorization{remaining}. Send /repair qr for the QR code, or /repair cancel to cancel.',
  '，剩余约 {minutes} 分钟': ', about {minutes} minutes left',
  '这个菜单已过期，请回复 /m 重新打开。': 'This menu has expired. Send /m to reopen it.',
  '菜单没有这个编号，回复 /m 重新打开。': 'This menu has no such number. Send /m to reopen it.',
  '本页只有 {count} 个会话，回复 /sessionlist 重新查看。':
    'This page has only {count} sessions. Send /sessionlist to view them again.',
  '只有 {count} 个工作区，回复 /workspacelist 重新查看。':
    'There are only {count} workspaces. Send /workspacelist to view them again.',
  '关注列表只有 {count} 个会话。': 'The watch list has only {count} sessions.',




  '已绑定会话「{title}」\nID：{id}': 'Session bound: "{title}"\nID: {id}',
  '绑定失败：{message}': 'Binding failed: {message}',

  '切换失败：{message}': 'Switch failed: {message}',
  '用法：/watch <Session ID 或当前工作区序号>':
    'Usage: /watch <Session ID or the current workspace index>',
  '当前机器人没有可用的工作区，无法按序号解析会话。':
    'This bot has no available workspace, so sessions cannot be resolved by index.',
  '当前工作区只有 {count} 个会话。': 'The current workspace has only {count} sessions.',
  '没有找到这个会话，请用 /sessionlist 查看可用会话。':
    'Session not found. Use /sessionlist to see the available sessions.',
  '当前状态存储不支持关注。': 'The current state store does not support watching.',
  '无法解析会话：{message}': 'Could not resolve the session: {message}',
  '每个聊天最多关注 {count} 个会话。': 'Each chat can watch at most {count} sessions.',
  '关注列表里没有这个会话，回复 /watchlist 查看。':
    'This session is not in the watch list. Send /watchlist to view it.',
  '已关注会话「{title}」，任务完成会推送结果。':
    'Watching session "{title}"; results are pushed when the task completes.',
  '关注失败：{message}': 'Could not watch: {message}',
  '已取消关注「{title}」。': 'Unwatched "{title}".',
  '取消失败：{message}': 'Could not unwatch: {message}',
  '飞书交互问题发送失败。': 'Failed to send the Feishu interaction question.',
  '当前任务仍在运行，请先停止任务或等待任务完成后再开启新会话。':
    'The current task is still running. Stop it or wait for it to finish before starting a new session.',
  '请输入补充指令后再提交。': 'Enter an instruction before submitting.',
  '操作过于频繁，请稍后再试。': 'Too many card actions are pending. Please try again shortly.',
  '卡片操作失败，请稍后重试。': 'The card action failed. Please try again later.',
  '新会话操作的卡片状态未能更新，请发送 /m 重新打开菜单。':
    'Could not update the new-session card status. Send /m to reopen the menu.',
  '请先选择至少一个会话。': 'Select at least one session first.',
  '已批量关注 {count} 个会话。': 'Now watching {count} sessions.',
  '已批量关注 {count} 个会话，另有 {failed} 个未成功。':
    'Now watching {count} sessions; {failed} could not be processed.',
  '已关注（或已达关注上限）。': 'Sessions are already watched, or the watch limit has been reached.',
  '已取消关注 {count} 个会话。': 'Stopped watching {count} sessions.',
  '已取消关注 {count} 个会话，另有 {failed} 个未成功。':
    'Stopped watching {count} sessions; {failed} could not be processed.',
  '所选会话均未处理成功，请稍后重试。':
    'None of the selected sessions could be processed. Please try again later.',
  '所选会话已在关注列表中。': 'The selected sessions are already being watched.',
  '所选会话已不在关注列表中。': 'The selected sessions are no longer in the watch list.',
  '未取消任何关注。': 'No watches were removed.',
  '当前没有绑定的会话，请先从会话列表选择。':
    'No session is currently bound. Select one from the session list first.',
  '已就绪，直接发消息即可继续当前会话。':
    'Ready. Send a message to continue the current session.',
  '修复需在私聊中验证接入者身份，请直接发送 /repair 开始。':
    'Repair must verify the owner in a direct chat. Send /repair there to begin.',
  '暂时无法获取预设列表，请稍后重试。':
    'Could not load the preset list. Please try again later.',
  '暂时无法获取系统状态，请稍后重试。':
    'Could not load system status. Please try again later.',
  '连接正常': 'Connected',
  '预设：{preset}': 'Preset: {preset}',
  '未知': 'Unknown',
  '/stop 执行完成。': '/stop completed.',
  '停止任务失败，请稍后重试。': 'Could not stop the task. Please try again later.',
  '已提交补充指令。': 'Instruction submitted.',
  '预设重置失败，请稍后重试。': 'Could not reset the preset. Please try again later.',
  '预设切换失败，请稍后重试。': 'Could not switch the preset. Please try again later.',

  // feishu/feishu-cards.mjs — interactive cards
  '🤖 助手中心': '🤖 Assistant center',
  '**设置**': '**Settings**',
  '切换会话': 'Switch session',
  '选择会话（当前未绑定）': 'Select a session (none currently bound)',
  '跟随默认': 'Follow default',
  '切换预设': 'Switch preset',
  '切换模型': 'Switch model',
  '默认等级': 'Default effort',
  '切换推理等级': 'Switch reasoning effort',
  '第 {page}/{pages} 页 · 共 {total} 个模型': 'Page {page}/{pages} · {total} models',
  '第一页': 'First page',
  '最后一页': 'Last page',
  '当前模型不可用：{model}': 'Current model is unavailable: {model}',
  '当前工作区暂无可用会话。': 'There are no available sessions in the current workspace.',
  '🤖 切换预设': '🤖 Switch preset',
  '🧠 切换模型': '🧠 Switch model',
  '🆕 新会话': '🆕 New session',
  '正在开启…': 'Starting…',
  '已执行：新会话': 'Done: new session',
  '正在开启新会话…': 'Starting a new session…',
  '已执行：新会话。发送消息即可开始。': 'Done: new session. Send a message to start.',
  '新会话操作失败：{message}': 'New session action failed: {message}',
  '📋 会话/关注': '📋 Sessions / watches',
  '🗂 工作区列表': '🗂 Workspace list',
  '**任务控制**': '**Task controls**',
  '⏹ 停止': '⏹ Stop',
  '📐 压缩': '📐 Compact',
  '**补充指令**': '**Steer task**',
  '选择补充指令': 'Choose an instruction',
  '继续': 'Continue',
  '加速运行': 'Move faster',
  '总结当前进展': 'Summarize current progress',
  '更简洁些': 'Be more concise',
  '更详细些': 'Be more detailed',
  '✏️ 更多 / 自定义…': '✏️ More / custom…',
  '🗄 归档：{state}': '🗄 Archived: {state}',
  '已显示': 'shown',
  '已隐藏': 'hidden',
  '切换归档显示': 'Toggle archived sessions',
  '📊 状态': '📊 Status',
  '📖 帮助': '📖 Help',
  '**数字兜底**\n**1**工作区列表 · **2**新会话 · **3**会话列表 · **4**状态\n**5**🔧补全权限 · **6**帮助':
    '**Number fallback**\n**1** Workspace list · **2** New session · **3** Session list · **4** Status\n**5** 🔧 Complete permissions · **6** Help',
  '跟随 Host 默认{default}': 'Follow Host default{default}',
  '**当前**：{value}': '**Current**: {value}',
  '**Host 默认**：{value}': '**Host default**: {value}',
  '未设置': 'Not set',
  '选择预设': 'Select a preset',
  '🔄 跟随默认': '🔄 Follow default',
  '当前没有可选择的预设。': 'There are no presets to choose from.',
  '🤖 预设列表': '🤖 Preset list',
  '**当前模型**：{model}': '**Current model**: {model}',
  '选择模型': 'Select a model',
  '🧠 模型列表': '🧠 Model list',
  '{icon} 飞书机器人{state}': '{icon} Feishu bot {state}',
  '已连接': 'connected',
  '未连接': 'disconnected',
  '📂 工作区：`{workspace}`': '📂 Workspace: `{workspace}`',
  '🤖 预设：{preset}': '🤖 Preset: {preset}',
  '🧠 模型：{model}': '🧠 Model: {model}',
  '💬 会话：{count} 个': '💬 Sessions: {count}',
  '📊 系统状态': '📊 System status',
  '📋 会话 / 工作区': '📋 Sessions / workspace',
  '/sessionlist  列出工作区会话': '/sessionlist  List workspace sessions',
  '/sessionlist 或 /sessions  列出工作区会话':
    '/sessionlist or /sessions  List workspace sessions',
  '/session ID  绑定已有会话': '/session ID  Bind an existing session',
  '/workspacelist  列出工作区': '/workspacelist  List workspaces',
  '/new  开启全新会话': '/new  Start a new session',
  '📊 状态 / 压缩': '📊 Status / compact',
  '/status  连接状态': '/status  Connection status',
  '`/version` — 查看插件版本': '`/version` — show the plugin version',
  '/compact  压缩当前会话上下文': '/compact  Compact the current session context',
  '/archived on/off  会话列表显示/隐藏归档': '/archived on/off  Show/hide archived sessions',
  '👁 关注': '👁 Watches',
  '/watch ID  关注会话（完成后推送）': '/watch ID  Watch a session (push on completion)',
  '/watchlist  关注列表': '/watchlist  List watched sessions',
  '/unwatch ID  取消关注': '/unwatch ID  Stop watching a session',
  '📦 批量输入（仅私聊）': '📦 Batch input (direct messages only)',
  '🤖 预设 / 模型': '🤖 Presets / models',
  '/models  列出模型': '/models  List models',
  '/presetlist 或 /presets  列出可用 Agent Preset':
    '/presetlist or /presets  List available Agent Presets',
  '🎮 任务控制': '🎮 Task controls',
  '/steer 指令  给 Agent 补充指令': '/steer INSTRUCTION  Steer the Agent',
  '**📋 卡片功能**\n\n1. 会话下拉 — 切换当前绑定会话\n2. 工作区下拉 — 切换工作区\n3. 🤖 预设下拉 — 切换 Agent 预设\n4. 🧠 模型下拉 — 切换模型\n5. 🆕 新会话 — 开启全新会话\n6. 📋 会话/关注 — 查看/绑定会话，管理关注\n7. ⏹ 停止 — 停止当前任务\n8. 📐 压缩 — 压缩当前会话上下文\n9. 🧹 清空上下文 — 清空上下文并保留绑定和历史记录\n10. 补充指令 — 给 Agent 发送指令\n11. 🗄 归档切换 — 显示/隐藏归档会话\n12. 📊 状态 — 查看系统连接状态\n13. 📖 帮助 — 查看本帮助':
    '**📋 Card features**\n\n1. Session dropdown — switch the bound session\n2. Workspace dropdown — switch workspace\n3. 🤖 Preset dropdown — switch Agent Preset\n4. 🧠 Model dropdown — switch model\n5. 🆕 New session — start fresh\n6. 📋 Sessions/watches — view or bind sessions and manage watches\n7. ⏹ Stop — stop the current task\n8. 📐 Compact — compact the current session context\n9. 🧹 Clear context — clear context while keeping the binding and history\n10. Steer task — send an instruction to the Agent\n11. 🗄 Archived toggle — show or hide archived sessions\n12. 📊 Status — view connection status\n13. 📖 Help — view this help',
  '**⌨️ 文本命令**\n\n`/m` — 打开菜单卡片\n`/new` — 开启全新会话\n`/session Session ID、当前工作区序号或标题关键词` — 绑定已有会话\n`/sessionlist [工作区]` 或 `/sessions [工作区]` — 列出会话\n`/sessionlist --all` 或 `/sessions --all` — 跨工作区汇总会话（每个工作区默认显示 10 个，可用 --limit N 调整）\n`/sessionlist --limit N` 或 `/sessions --limit N` — 仅列出当前工作区前 N 个会话\n`/workspace 工作区序号或绝对路径` — 切换工作区\n`/workspacelist` — 列出工作区\n`/status` — 查看连接状态\n`/compact` — 压缩上下文\n`/clear` — 清空上下文并保留 Session 绑定和历史记录\n`/stop` — 停止当前任务\n`/steer 指令` — 补充指令\n`/watch ID` — 关注会话\n`/watchlist` — 关注列表\n`/unwatch ID` — 取消关注\n`/archived on/off` — 归档显隐\n`/presetlist` 或 `/presets` — 列出预设\n`/preset [序号/ID]` — 切换预设\n`/preset --default` — 跟随默认\n`/models` — 列出模型\n`/reasoninglist` 或 `/reasonings` — 按序号列出当前模型可用推理等级\n`/reasoning [序号、等级ID或 --default]` — 查看或切换当前推理等级\n`/model [序号或完整模型ID] [推理等级ID]` — 查看或切换当前会话模型\n`/batch` — 开启批量输入（仅私聊，最多 10 条文字）\n`/send` — 提交当前批次\n`/cancel` — 取消当前批次\n`/repair` — 补全飞书权限与卡片回调':
    '**⌨️ Text commands**\n\n`/m` — open the menu card\n`/new` — start a new session\n`/session Session ID, current workspace index, or title keyword` — bind an existing session\n`/sessionlist [workspace]` or `/sessions [workspace]` — list sessions\n`/sessionlist --all` or `/sessions --all` — summarize sessions across workspaces (10 per workspace by default; use --limit N to change)\n`/sessionlist --limit N` or `/sessions --limit N` — list only the first N sessions in the current workspace\n`/workspace <workspace index or absolute path>` — switch workspace\n`/workspacelist` — list workspaces\n`/status` — view connection status\n`/compact` — compact context\n`/clear` — clear context while keeping the Session binding and history\n`/stop` — stop the current task\n`/steer INSTRUCTION` — steer the task\n`/watch ID` — watch a session\n`/watchlist` — list watched sessions\n`/unwatch ID` — stop watching\n`/archived on/off` — show or hide archived sessions\n`/presetlist` or `/presets` — list presets\n`/preset [index/ID]` — switch preset\n`/preset --default` — follow default\n`/models` — list models\n`/reasoninglist` or `/reasonings` — list reasoning efforts for the current model\n`/reasoning [index, effort ID, or --default]` — show or switch reasoning effort\n`/model [index or full model ID] [reasoning effort ID]` — show or switch the current Session model\n`/batch` — start batch input (direct messages only, up to 10 text messages)\n`/send` — submit the current batch\n`/cancel` — cancel the current batch\n`/repair` — complete Feishu permissions and the card callback',
  '**💡 数字兜底**\n回复数字快速操作：\n**1**工作区列表 · **2**新会话 · **3**会话/关注\n**4**状态 · **5**补全权限 · **6**帮助':
    '**💡 Number fallback**\nReply with a number for a quick action:\n**1** Workspace list · **2** New session · **3** Sessions/watches\n**4** Status · **5** Complete permissions · **6** Help',
  '从下方下拉选择补充指令；最后一项可自定义输入。':
    'Choose an instruction below; the last option lets you enter a custom one.',
  '当前没有绑定会话，请先绑定会话再补充指令。':
    'No session is bound. Bind one before steering the task.',
  '➕ 补充指令': '➕ Steer task',
  '输入补充指令后点「提交」，发送给当前运行的任务。':
    'Enter an instruction and press Submit to send it to the running task.',
  '输入你的补充指令': 'Enter your instruction',
  '提交': 'Submit',
  '➕ 自定义指令': '➕ Custom instruction',
  '🤖 助手菜单': '🤖 Assistant menu',
  '**点击按钮或直接回复数字**': '**Tap a button or reply with a number**',
  '1 · 会话列表': '1 · Sessions',
  '2 · 工作区': '2 · Workspace',
  '3 · 新会话': '3 · New session',
  '4 · 状态': '4 · Status',
  '5 · 帮助': '5 · Help',
  '**6 · 补全权限**（请直接回复数字 **6**）':
    '**6 · Complete permissions** (reply with the number **6**)',
  '7 · 关注列表': '7 · Watch list',
  '🧪 验证卡片按钮': '🧪 Verify card buttons',
  '授权已提交。请点击下方按钮；机器人真实收到回调后才会判定修复成功。':
    'Authorization submitted. Tap the button below; the repair is confirmed only after the bot receives the real callback.',
  '完成验证': 'Finish verification',
  '**工作区**：{workspace}\n共 **{total}** 个会话{paging}':
    '**Workspace**: {workspace}\n**{total}** sessions in total{paging}',
  '（第 {page}/{pageCount} 页）': ' (page {page}/{pageCount})',
  '⭐取关': '⭐ Unwatch',
  '⭐关注': '⭐ Watch',
  '◀ 上一页': '◀ Previous',
  '下一页 ▶': 'Next ▶',
  '回复数字（1~N）绑定本页会话。': 'Reply with a number (1–N) to bind a session on this page.',
  '📂 会话列表': '📂 Session list',
  '当前 Host 上没有已登记的工作区。': 'No workspaces are registered on the current Host.',
  '回复数字切换工作区，或点击按钮：': 'Reply with a number to switch workspaces, or tap a button:',
  '🗂 工作区': '🗂 Workspace',
  '🤖 助手菜单（回复数字即可，无需记命令）':
    '🤖 Assistant menu (reply with a number — no need to memorize commands)',
  '1 · /sessionlist  列出会话（回复数字绑定）':
    '1 · /sessionlist  List sessions (reply with a number to bind)',
  '2 · /workspacelist  列出工作区（回复数字切换）':
    '2 · /workspacelist  List workspaces (reply with a number to switch)',
  '3 · /new  开启新会话': '3 · /new  Start a new session',
  '4 · /status  连接状态': '4 · /status  Connection status',
  '5 · /help  本帮助': '5 · /help  This help',
  '6 · /repair  补全权限与回调（请回复数字 6）':
    '6 · /repair  Complete permissions and callback (reply with the number 6)',
  '7 · /watchlist  关注列表': '7 · /watchlist  Watch list',
  '直接发送文字/图片即继续当前会话。':
    'Send text or an image directly to continue the current session.',
  '/session ID 或序号  绑定已有会话': '/session ID or index  Bind an existing session',
  '/watch ID 或序号  关注会话（完成后推送）':
    '/watch ID or index  Watch a session (push when done)',
  '/compact  压缩上下文': '/compact  Compact the context',
  '🧹 清空上下文': '🧹 Clear context',
  '清空当前会话上下文并保留绑定和历史记录': 'Clear the current session context while keeping the binding and history',
  '/workspace 绝对路径  切换工作区': '/workspace <absolute path>  Switch workspace',
  '/presetlist  列出可用 Agent Preset': '/presetlist  List available Agent Presets',
  '任务完成会自动推送，回复数字或点按钮取消关注：':
    'Completion is pushed automatically. Reply with a number or tap a button to unwatch:',
  '👁 关注列表': '👁 Watch list',
  '⭐ 取消关注': '⭐ Unwatch',
  '☆ 关注': '☆ Watch',
  '🔍 关注列表': '🔍 Watch list',
  '勾选要关注的会话': 'Select sessions to watch',
  '勾选要取消关注的会话': 'Select sessions to unwatch',
  '当前没有关注的会话。任务完成会自动推送结果。':
    'No sessions are being watched. Results are pushed automatically when tasks complete.',
  '当前关注 **{count}** 个会话：': 'Currently watching **{count}** sessions:',
  '**➕ 添加关注**（多选下拉勾选）': '**➕ Add watch** (select from the multi-select dropdown)',
  '**➖ 取消关注**（多选下拉勾选）': '**➖ Remove watch** (select from the multi-select dropdown)',
  '📋 会话列表': '📋 Session list',
  '🔙 返回菜单': '🔙 Back to menu',
  '已完成': 'Completed',
  '已停止': 'Stopped',
  '运行中': 'Running',
  '⚙️ 任务过程': '⚙️ Task progress',
  '📋 过程详情': '📋 Process details',
  '🛠️ 工具摘要（{count}）': '🛠️ Tool summary ({count})',
  '💭 思考过程（{count}）': '💭 Thinking ({count})',
  '🛠️ 工具': '🛠️ Tools',
  '💭 思考': '💭 Thinking',
  '📋 过程详情（工具 {tools} · 思考 {notes}）': '📋 Process details (tools {tools} · thinking {notes})',
  '已中止': 'Aborted',
  '已取消': 'Cancelled',
  '已结束': 'Ended',
  '✅ 任务完成': '✅ Task complete',
  '**状态**：{reason}': '**Status**: {reason}',
  '打开会话列表': 'Open session list',
  '工作区': 'Workspace',
  '绑定该会话后可继续追问，输入文字即可。':
    'After binding this session you can keep asking; just type a message.',
  '当前没有关注的会话。\n`/watch <ID|序号>` 关注后，任务完成会自动推送。':
    'No sessions are being watched.\nWatch one with `/watch <ID|index>` and completion is pushed automatically.',

  // feishu/feishu-channel.mjs
  '正在生成…': 'Generating…',
  '⤵️ 最终结果见下方': '⤵️ Final result below',
  '回答完成': 'Answer complete',
  '内容较长，生成完成后将分段发送完整回答。':
    'This response is long. The complete answer will be sent in parts when generation finishes.',
  '飞书机器人': 'Feishu bot',

  // feishu/message-utils.mjs
  '飞书机器人缺少图片读取权限 im:message:readonly（飞书显示为“获取单聊、群组消息”）。请私聊机器人执行 /repair 命令，或者在「IM机器人」设置页点击“补全权限”按钮并扫码。按飞书提示发布新版本、完成必要审批后，再重新发送图片。':
    'The Feishu bot is missing the image-read scope im:message:readonly, shown by Feishu as “Read direct and group messages.” Run /repair in a direct chat with the bot, or click the “Complete permissions” button on the IM Bot settings page and scan the QR code. Publish a new version and complete any approval requested by Feishu, then resend the image.',

  // feishu/feishu-runtime.mjs — callback probe notices
  '✅ 修复完成：已实测收到 card.action.trigger，菜单按钮现在可用。':
    '✅ Repair complete: card.action.trigger was received in a real test; the menu buttons now work.',
  '⚠️ 修复验证超时：未收到测试卡按钮的 card.action.trigger，不能确认按钮已修复。请不要重复授权；先检查飞书开放平台的卡片回调配置，确认后再发送 /repair。':
    '⚠️ Repair verification timed out: no card.action.trigger from the test card button was received, so the buttons cannot be confirmed repaired. Do not authorize again; check the card-callback configuration in Feishu Open Platform first, then send /repair.',
  '⚠️ 修复验证失败：无法发送专用测试卡，不能确认 card.action.trigger 已恢复。请不要重复授权；先检查机器人消息权限和连接状态。':
    '⚠️ Repair verification failed: the dedicated test card could not be sent, so card.action.trigger cannot be confirmed restored. Do not authorize again; check the bot message permission and connection status first.',
  '⚠️ 修复验证中断：Runtime 已停止，未完成 card.action.trigger 实测，不能确认修复成功。请不要重复授权；先等待机器人恢复连接。':
    '⚠️ Repair verification interrupted: the Runtime stopped before the card.action.trigger test completed, so the repair cannot be confirmed. Do not authorize again; wait for the bot to reconnect.',

  // feishu/bridge.mjs — interaction cards (approve/reject / answer buttons)
  '该审批已处理或不存在，无需重复操作。':
    'This approval has already been processed or does not exist; no need to repeat the action.',
  // feishu/feishu-cards.mjs — approval card
  '操作参数：\n{operation}': 'Operation parameters:\n{operation}',
  '✅ 批准': '✅ Approve',
  '❌ 拒绝': '❌ Reject',
  '🔐 工具审批': '🔐 Tool approval',
  // feishu/feishu-cards.mjs — question card
  '❓ 请补充信息{progress}': '❓ Please provide more information{progress}',
  '选择 {number}': 'Select {number}',
  // feishu/bridge.mjs — deferred delivery terminal statuses
  '后台任务已结束（{reason}），没有可推送的最终结果。':
    'The background task has finished ({reason}); there is no final result to deliver.',
  '已请求停止后台任务。': 'Requested to stop the background task.',
  '无法安全停止后台任务，请在 Harness 中查看并停止对应任务。': 'Unable to safely stop the background task. Please inspect and stop the matching task in Harness.',
  '任务失败': 'Failed',
  // feishu/bridge.mjs — step push context injection
  '📎 已注入会话上下文': '📎 Context injected',
  // feishu/bridge.mjs — goal rounds opened outside the IM (issue #454)
  '🔄 目标自动续跑': '🔄 Goal auto-continued',
  '🔄 目标自动续跑（第 {round} 轮）': '🔄 Goal auto-continued (round {round})',
  // feishu/feishu-cards.mjs — question card answered state + custom entry (issue #162)
  '✏️ 其他答案…': '✏️ Other answer…',
  '✅ 已回答{progress}': '✅ Answered{progress}',
  '✅ 已选择：{label}': '✅ Selected: {label}',
  '回答已提交，对话将继续。': 'Answer submitted. The conversation will continue.',
  // feishu/bridge.mjs — answered interaction notices + custom answer guidance (issue #162)
  '这个问题已经回答过了。': 'This question has already been answered.',
  '想自定义答案？直接发送文字消息即可，将作为本题答案提交。':
    'Want a custom answer? Just send a text message and it will be submitted as your answer.',
  // feishu/bridge.mjs — thinking status heartbeat
  '⏳ 正在思考中…（已运行 {elapsed}）': '⏳ Thinking… (elapsed {elapsed})',
  '⏳ 正在思考中…': '⏳ Thinking…',
};
