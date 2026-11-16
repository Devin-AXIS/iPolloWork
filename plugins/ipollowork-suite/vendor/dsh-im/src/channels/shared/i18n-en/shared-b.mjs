// English translations (shared-b area). Keys are exact Chinese literals passed to t().
export default {
  // workspace-command.mjs
  '用法：/session Session ID、当前工作区序号（/session N）或会话标题关键词':
    'Usage: /session Session ID, the Session index in the current Workspace (/session N), or a Session title keyword',
  '用法：\n/sessionlist  列出当前工作区会话\n/sessionlist --all  跨工作区汇总列出会话（每个工作区默认显示 10 个）\n/sessionlist --all --limit N  跨工作区汇总列出会话，每个工作区显示前 N 个\n/sessionlist --limit N  列出当前工作区前 N 个会话（N 为正整数）\n/sessionlist --archived  一并列出已归档会话（序号仍只对应未归档会话）\n/sessionlist 工作区序号  按 /workspacelist 序号列出会话\n/sessionlist 工作区绝对路径  列出指定工作区会话\n不带工作区参数时，默认列出当前对话的有效工作区（未设置对话专属工作区时即 bot 默认工作区）。':
    'Usage:\n/sessionlist  List Sessions in the current Workspace\n/sessionlist --all  List Sessions across all Workspaces (10 per Workspace by default)\n/sessionlist --all --limit N  List Sessions across all Workspaces, the first N per Workspace\n/sessionlist --limit N  List the first N Sessions in the current Workspace (N must be a positive integer)\n/sessionlist --archived  Also list archived Sessions (indices still cover non-archived Sessions only)\n/sessionlist Workspace index  List Sessions by /workspacelist index\n/sessionlist Workspace absolute path  List Sessions in the given Workspace\nWithout a workspace argument it lists the workspace this conversation effectively uses (the bot default when no conversation workspace is set).',
  '工作区必须是绝对路径。\n{usage}': 'The Workspace must be an absolute path.\n{usage}',
  '工作区路径包含不支持的字符或长度超过限制。\n{usage}':
    'The Workspace path contains unsupported characters or exceeds the length limit.\n{usage}',
  '工作区路径不存在。\n{usage}': 'The Workspace path does not exist.\n{usage}',
  '工作区路径必须指向一个目录。\n{usage}': 'The Workspace path must point to a directory.\n{usage}',
  '用法：/workspacelist': 'Usage: /workspacelist',
  '当前机器人暂不支持列出工作区。': 'This bot does not support listing Workspaces yet.',
  '当前 Harness Host 上没有仍然存在的已登记工作区。':
    'No registered Workspaces still exist on the current Harness Host.',
  '当前 Harness Host 上存在的工作区（{count}）：':
    'Workspaces on the current Harness Host ({count}):',
  '（当前）': '(current)',
  '切换用法：/workspace 工作区序号或绝对路径':
    'To switch: /workspace Workspace index or absolute path',
  '查看会话：/sessionlist 工作区序号或绝对路径':
    'To view Sessions: /sessionlist Workspace index or absolute path',
  '机器人正在移除或已重新接入，无法列出原会话的工作区。':
    'The bot is being removed or has been reconnected; cannot list Workspaces of the original Session.',
  '暂时无法获取工作区列表，请稍后重试。':
    'Unable to get the Workspace list right now; please try again later.',
  '当前机器人没有可用的工作区。': 'This bot has no available Workspace.',
  '当前机器人暂不支持按序号选择工作区。':
    'This bot does not support selecting a Workspace by index yet.',
  '工作区序号不存在，请先执行 /workspacelist。':
    'The Workspace index does not exist; please run /workspacelist first.',
  '今天 {time}': 'Today {time}',
  '昨天 {time}': 'Yesterday {time}',
  '前天 {time}': 'The day before yesterday {time}',
  '{month}月{day}日 {time}': '{month}/{day} {time}',
  '{year}年{month}月{day}日': '{year}-{month}-{day}',
  '标题暂不可用': 'Title unavailable',
  '暂无标题': 'No title',
  '（已归档）': '(archived)',
  '工作区：{workspace}\n该工作区暂无会话。': 'Workspace: {workspace}\nThis Workspace has no Sessions yet.',
  '工作区：{workspace}': 'Workspace: {workspace}',
  '会话（{count}）：': 'Sessions ({count}):',
  '绑定用法：/session Session ID 或当前工作区序号（/session N）':
    'To bind: /session Session ID or the Session index in the current Workspace (/session N)',
  '绑定用法：/session Session ID\n提示：/session N 只按机器人当前工作区的序号绑定。':
    "To bind: /session Session ID\nNote: /session N binds by index within the bot's current Workspace only.",
  '当前机器人暂不支持列出工作区会话。':
    'This bot does not support listing Workspace Sessions yet.',
  '机器人正在移除或已重新接入，无法列出原会话的工作区会话。':
    'The bot is being removed or has been reconnected; cannot list Workspace Sessions of the original Session.',
  '暂时无法获取工作区会话列表，请稍后重试。':
    'Unable to get the Workspace Session list right now; please try again later.',
  '（当前绑定）': '(currently bound)',
  '跨工作区会话（{workspaces} 个工作区，共 {sessions} 个会话）：':
    'Sessions across Workspaces ({workspaces} Workspaces, {sessions} Sessions in total):',
  '当前工作区：{workspace}': 'Current Workspace: {workspace}',
  '另有 {count} 个工作区暂时无法读取，未包含在汇总中。':
    '{count} more Workspace(s) could not be read and are not included in the summary.',
  '{workspace}（{count} 个会话）': '{workspace} ({count} Sessions)',
  '（共 {total} 个，显示前 {shown} 个；用 --limit N 调整）':
    '(of {total} total, showing the first {shown}; use --limit N to change)',
  '该工作区暂无会话。': 'This Workspace has no Sessions yet.',
  '（已隐藏 {count} 条归档会话，用 --archived 查看）':
    '(hid {count} archived Session(s); use --archived to see them)',
  '归档会话（只能用完整 Session ID 绑定）：':
    'Archived Sessions (bind them with the full Session ID):',
  '（{count} 条会话记录无效，已跳过）':
    '({count} invalid Session records skipped)',
  '当前机器人暂不支持跨工作区列出会话。':
    'This bot does not support listing Sessions across Workspaces yet.',
  '用法：/sessionarchive Session ID 归档一个会话；/sessionarchive 序号 只预览该序号对应的会话（编号会随列表变化，归档请用完整 ID）。加 --stop 可让 DSH 先停止该会话正在运行的任务':
    'Usage: /sessionarchive <Session ID> archives a Session; /sessionarchive <index> only previews the Session behind that index (indices shift, so archiving needs the full ID). Add --stop to let DSH stop that Session\'s running work first',
  '按序号归档只做预览：/sessionarchive {index} 现在对应这条会话。':
    'Archiving by index is preview-only: /sessionarchive {index} currently points at this Session.',
  '（编号会随会话列表变化，所以不按序号直接归档；确认归档请发送：/sessionarchive {sessionId}）':
    '(Indices shift as the list changes, so archiving by index is never executed; to confirm, send: /sessionarchive {sessionId})',
  '当前机器人暂不支持归档会话。': 'This bot does not support archiving Sessions yet.',
  '该会话已经归档。': 'This Session is already archived.',
  '这是本对话当前绑定的会话，请先 /new 或绑定其他会话，再归档它。':
    'This is the Session this chat is bound to; send /new or bind another Session before archiving it.',
  '已归档会话：': 'Archived Session:',
  '机器人正在移除或已重新接入，无法归档原会话的会话。':
    'The bot is being removed or has been reconnected; cannot archive Sessions of the original conversation.',
  '当前 DSH 版本不支持通过机器人归档会话。':
    'This DSH version does not expose Session archiving to the bot.',
  '该会话仍有任务在运行，请先 /stop，或使用 /sessionarchive <目标> --stop。':
    'That Session still has running work; send /stop first, or use /sessionarchive <target> --stop.',
  '暂时无法归档该会话，请稍后重试。': 'Unable to archive that Session right now; please try again later.',
  '标题包含「{keyword}」的会话有多个，请改用完整 Session ID 绑定：':
    'Several Sessions have titles containing "{keyword}"; bind with the full Session ID instead:',
  '标题包含「{keyword}」的会话位于其他工作区，请使用完整 Session ID 绑定：':
    'Sessions whose titles contain "{keyword}" are in other Workspaces; bind with the full Session ID:',
  '部分工作区暂时无法读取，搜索结果可能不完整；请使用完整 Session ID 绑定：':
    'Some Workspaces could not be read, so the search may be incomplete; bind with the full Session ID:',
  '部分工作区暂时无法读取，未能确认标题包含「{keyword}」的会话。请稍后重试或使用完整 Session ID。':
    'Some Workspaces could not be read, so no Session title containing "{keyword}" could be confirmed. Try again later or use the full Session ID.',
  '匹配较多，只显示前 {count} 个，请使用更精确的关键词。':
    'Many matches; only the first {count} are shown. Please use a more specific keyword.',
  '标题包含「{keyword}」的会话已归档，按标题绑定不会接管归档会话，请用完整 Session ID 绑定：':
    'Sessions whose titles contain "{keyword}" are archived, and a title keyword never takes over an archived Session; bind one with its full Session ID:',
  '按标题匹配到「{title}」（ID: {sessionId}，工作区: {workspace}），但 Harness 当前无法接管这个会话，请稍后重试或用完整 Session ID 绑定。':
    'The keyword matched "{title}" (ID: {sessionId}, Workspace: {workspace}), but Harness cannot take over that Session right now. Try again later or bind it with the full Session ID.',
  '没有标题包含「{keyword}」的会话，请先执行 /sessionlist --all 查看完整 Session ID。':
    'No Session title contains "{keyword}"; run /sessionlist --all to find the full Session ID.',
  'Session ID 格式无效。\n{usage}': 'Invalid Session ID format.\n{usage}',
  '未找到该会话，请先执行 /sessionlist 确认 Session ID。':
    'Session not found; please run /sessionlist to confirm the Session ID.',
  '子代理会话不能绑定到机器人对话，请选择普通会话。':
    'Sub-agent Sessions cannot be bound to a bot conversation; please choose a regular Session.',
  '该会话的工作区归属不明确，暂时无法绑定。':
    "The Session's Workspace ownership is ambiguous; cannot bind it right now.",
  '暂时无法读取该会话的信息，请稍后重试。':
    'Unable to read the Session info right now; please try again later.',
  '机器人正在移除或已重新接入，无法绑定原对话的会话。':
    'The bot is being removed or has been reconnected; cannot bind the Session of the original conversation.',
  '工作区或会话状态已发生变化，请重试。':
    'The Workspace or Session state has changed; please try again.',
  '暂时无法绑定会话，请稍后重试。': 'Unable to bind the Session right now; please try again later.',
  '当前机器人暂不支持按序号绑定，请使用 /session Session ID。':
    'This bot does not support binding by index yet; please use /session Session ID.',
  '会话序号不存在，请先执行 /sessionlist 查看序号。':
    'The Session index does not exist; please run /sessionlist to see the indexes.',
  '暂时无法获取会话列表，请稍后重试。':
    'Unable to get the Session list right now; please try again later.',
  '当前机器人暂不支持绑定已有会话。':
    'This bot does not support binding existing Sessions yet.',
  '当前消息缺少可绑定的会话上下文。':
    'The current message lacks a conversation context to bind to.',
  '当前聊天已绑定会话：': 'This chat is now bound to the Session:',
  '发送 /history 查看最近对话。': 'Send /history to preview recent conversation messages.',
  '标题：{title}': 'Title: {title}',
  '归档：{archived}': 'Archived: {archived}',
  '是': 'Yes',
  '否': 'No',
  '用法：/workspace 工作区序号或绝对路径':
    'Usage: /workspace Workspace index or absolute path',
  '查看或切换工作区': 'View or switch Workspace',
  '/workspace 或 /ws  查看可切换的工作区（点按钮切换）':
    '/workspace or /ws  View switchable Workspaces (tap a button to switch)',
  '/workspacelist、/wsl、/workspaces  工作区列表别名（等同 /ws）':
    '/workspacelist, /wsl, /workspaces  Workspace-list aliases (same as /ws)',
  '当前机器人暂不支持切换工作区。': 'This bot does not support switching Workspaces yet.',
  '工作区已切换为：{workspace}': 'Workspace switched to: {workspace}',
  '{message}\n用法：/workspace 工作区序号或绝对路径':
    '{message}\nUsage: /workspace Workspace index or absolute path',
  '机器人正在移除或已重新接入，无法切换原会话的工作区。':
    'The bot is being removed or has been reconnected; cannot switch the Workspace of the original Session.',

  // preset-command.mjs
  '用法：/presetlist（不带参数）': 'Usage: /presetlist (no arguments)',
  '用法：\n/preset  查看当前设置\n/preset <序号>  按最近一次 /presetlist 的序号选择\n/preset <ID>  按 Agent Preset ID 选择\n/preset id:<纯数字 ID>  选择纯数字 ID\n/preset --default  跟随 Host 默认':
    'Usage:\n/preset  Show current settings\n/preset <index>  Select by index from the latest /presetlist\n/preset <ID>  Select by Agent Preset ID\n/preset id:<numeric ID>  Select a purely numeric ID\n/preset --default  Follow the Host default',
  '未设置或当前不可用': 'Not set or currently unavailable',
  '{id}（当前不可用）': '{id} (currently unavailable)',
  '跟随 Host 默认：{preset}': 'Following Host default: {preset}',
  '跟随 Host 默认（Host 默认当前不可用）': 'Following Host default (Host default currently unavailable)',
  '{id}（已不可用）': '{id} (no longer available)',
  '当前机器人用于新会话的 Agent Preset：': 'Agent Preset this bot uses for new Sessions:',
  '已有会话不会受此设置影响。': 'Existing Sessions are not affected by this setting.',
  '查看可用项：/presetlist': 'See available options: /presetlist',
  '恢复跟随 Host 默认：/preset --default': 'Restore following Host default: /preset --default',
  'Host 默认：{preset}': 'Host default: {preset}',
  '可用 Agent Preset（{count}）：': 'Available Agent Presets ({count}):',
  '当前没有可用 Agent Preset。': 'No Agent Presets are currently available.',
  'Host 默认': 'Host default',
  '当前选择': 'current selection',
  '当前生效': 'currently in effect',
  '选择：/preset <序号或 ID>': 'To select: /preset <index or ID>',
  '当前机器人用于新会话的 Agent Preset 已设置为：':
    'The Agent Preset this bot uses for new Sessions is now set to:',
  '已有会话不变。若当前聊天已有会话，请先发送 /new，再发送普通消息，才会使用新设置创建会话。':
    'Existing Sessions are unchanged. If this chat already has a Session, send /new first, then a regular message, to create a Session with the new setting.',
  'Agent Preset 序号无效，请先执行 /presetlist。':
    'Invalid Agent Preset index; please run /presetlist first.',
  '请先执行 /presetlist，再按列表序号选择 Agent Preset。':
    'Please run /presetlist first, then select an Agent Preset by list index.',
  'Agent Preset 序号不存在，请重新执行 /presetlist。':
    'The Agent Preset index does not exist; please run /presetlist again.',
  'Agent Preset ID 格式无效。\n{usage}': 'Invalid Agent Preset ID format.\n{usage}',
  'Agent Preset 不存在或当前不可用，请重新执行 /presetlist。':
    'The Agent Preset does not exist or is currently unavailable; please run /presetlist again.',
  '工作区或机器人状态已发生变化，请重试。':
    'The Workspace or bot state has changed; please try again.',
  '获取 Agent Preset 列表已取消。': 'Fetching the Agent Preset list was cancelled.',
  '获取 Agent Preset 设置已取消。': 'Fetching the Agent Preset settings was cancelled.',
  'Agent Preset 修改已取消。': 'The Agent Preset change was cancelled.',
  '暂时无法获取 Agent Preset 列表，请稍后重试。':
    'Unable to get the Agent Preset list right now; please try again later.',
  '暂时无法获取 Agent Preset 设置，请稍后重试。':
    'Unable to get the Agent Preset settings right now; please try again later.',
  'Agent Preset 修改失败，请稍后重试。': 'Failed to change the Agent Preset; please try again later.',
  'Agent Preset 命令仅支持纯文字，请移除图片后重试。':
    'Agent Preset commands support text only; please remove images and try again.',

  // model-command.mjs
  '用法：/model <序号> 或 /model <provider>/<model>': 'Usage: /model <index> or /model <provider>/<model>',
  '用法：/model <序号或 provider/model> [推理等级ID]':
    'Usage: /model <index or provider/model> [reasoning effort ID]',
  '用法：/models（不带参数）': 'Usage: /models (no arguments)',
  '用法：/reasoning [序号、等级ID或 --default]':
    'Usage: /reasoning [index, effort ID, or --default]',
  '用法：/reasoninglist 或 /reasonings（不带参数）':
    'Usage: /reasoninglist or /reasonings (no arguments)',
  '模型序号无效：{input}': 'Invalid model index: {input}',
  '请发送 /models 查看并输入有效的正整数序号。':
    'Please send /models to view the list and enter a valid positive integer index.',
  '推理等级序号无效：{input}': 'Invalid reasoning effort index: {input}',
  '请发送 /reasoninglist 查看并输入有效的正整数序号。':
    'Please send /reasoninglist and enter a valid positive integer index.',
  '可用模型：': 'Available models:',
  '可用推理等级：': 'Available reasoning efforts:',
  '可用推理等级：{efforts}': 'Available reasoning efforts: {efforts}',
  '当前没有可用模型。': 'No models are currently available.',
  '以下模型提供方暂时不可用：': 'The following model providers are temporarily unavailable:',
  '切换模型：/model <序号>': 'To switch models: /model <index>',
  '切换模型：/model <序号> [推理等级ID]':
    'Switch model: /model <index> [reasoning effort ID]',
  '当前模型：': 'Current model:',
  '当前推理等级：{effort}': 'Current reasoning effort: {effort}',
  'Default（由模型或 Provider 决定）': 'Default (determined by the model or Provider)',
  '（当前、默认）': ' (current, default)',
  '（默认）': ' (default)',
  '查看全部模型：/models': 'See all models: /models',
  '查看可用推理等级：/reasoninglist': 'See reasoning efforts: /reasoninglist',
  '切换推理等级：/reasoning <序号或等级ID>':
    'Switch reasoning effort: /reasoning <index or effort ID>',
  '恢复默认等级：/reasoning --default': 'Restore the default effort: /reasoning --default',
  '当前聊天还没有会话。': 'This chat has no Session yet.',
  '请先发送一条普通消息创建会话。': 'Send a regular message first to create a Session.',
  '查看模型：/models': 'View models: /models',
  '选择模型：/model <序号>': 'Select a model: /model <index>',
  '当前任务正在运行，请等待完成或先发送 /stop。':
    'A task is currently running; please wait for it to finish or send /stop first.',
  '当前聊天绑定的会话已不存在，请重试。':
    'The Session bound to this chat no longer exists; please try again.',
  '无法切换到该模型。模型当前不可用，或不支持当前会话中的图片。':
    'Cannot switch to that model. It is currently unavailable, or does not support the images in this Session.',
  '无法切换推理等级。当前模型或推理等级不可用。':
    'Cannot switch the reasoning effort. The current model or effort is unavailable.',
  '当前聊天绑定的会话已发生变化，请重试。':
    'The Session bound to this chat has changed; please try again.',
  '获取模型列表已取消。': 'Fetching the model list was cancelled.',
  '获取推理等级列表已取消。': 'Fetching the reasoning effort list was cancelled.',
  '模型切换已取消。': 'The model switch was cancelled.',
  '推理等级切换已取消。': 'The reasoning effort switch was cancelled.',
  '暂时无法获取模型列表，请稍后重试。':
    'Unable to get the model list right now; please try again later.',
  '暂时无法获取推理等级，请稍后重试。':
    'Unable to get reasoning efforts right now; please try again later.',
  '模型切换失败，请稍后重试。': 'Failed to switch the model; please try again later.',
  '推理等级切换失败，请稍后重试。':
    'Failed to switch the reasoning effort; please try again later.',
  '模型命令仅支持纯文字，请移除图片后重试。':
    'Model commands support text only; please remove images and try again.',
  '模型和推理等级命令仅支持纯文字，请移除图片后重试。':
    'Model and reasoning effort commands support text only; please remove images and try again.',
  '当前任务正在等待你的回答或审批。': 'The current task is waiting for your answer or approval.',
  '请先处理当前请求，或者发送 /stop 停止任务。':
    'Please handle the current request first, or send /stop to stop the task.',
  '没有找到模型：{model}': 'Model not found: {model}',
  '请发送 /models 查看可用模型。': 'Please send /models to view available models.',
  '模型不支持推理等级：{effort}': 'The model does not support reasoning effort: {effort}',
  '该模型不提供可切换的推理等级。':
    'This model does not provide switchable reasoning efforts.',
  '模型已切换为：\n{model}\n\n后续消息将使用该模型。':
    'Model switched to:\n{model}\n\nSubsequent messages will use this model.',
  '模型已切换为：\n{model}\n推理等级：{effort}\n\n后续消息将使用该模型和推理等级。':
    'Model switched to:\n{model}\nReasoning effort: {effort}\n\nSubsequent messages will use this model and reasoning effort.',
  '推理等级已切换为：\n{effort}\n\n当前模型：{model}\n后续消息将使用该推理等级。':
    'Reasoning effort switched to:\n{effort}\n\nCurrent model: {model}\nSubsequent messages will use this reasoning effort.',

  // compact-command.mjs
  '用法：/compact（不带参数）': 'Usage: /compact (no arguments)',
  '暂无可压缩的历史记录。': 'No compactable history yet.',
  '当前会话正在生成回复或执行压缩，请稍后重试。':
    'The current Session is generating a reply or compacting; please try again later.',
  '上下文压缩已取消。': 'Context compaction was cancelled.',
  '压缩期间会话历史发生变化，本次未修改会话，请重试。':
    'The Session history changed during compaction; the Session was not modified this time, please try again.',
  '未能生成有效的压缩摘要，本次未修改会话。':
    'Could not produce a useful compaction summary; the Session was not modified this time.',
  '上下文压缩未正常完成，部分会话历史可能已变化，请检查会话后再重试。':
    'Context compaction did not finish cleanly; some Session history may have changed. Please inspect the Session before retrying.',
  '上下文已压缩，但会话保存失败。': 'Context was compacted, but saving the Session failed.',
  '已压缩 {count} 条历史记录（约 {tokens} 个 token）。':
    'Compacted {count} history items (~{tokens} tokens).',
  '上下文压缩完成。': 'Context compaction completed.',
  '上下文压缩失败。': 'Context compaction failed.',
  '当前聊天绑定的会话已不存在，请发送新消息开启会话。':
    'The Session bound to this chat no longer exists; please send a new message to start a Session.',
  '当前会话正在生成回复，请稍后重试。':
    'The current Session is generating a reply; please try again later.',
  '当前 Harness 暂不支持从机器人执行上下文压缩。':
    'The current Harness does not support running context compaction from a bot yet.',
  '上下文压缩失败，请稍后重试。': 'Context compaction failed; please try again later.',
  '当前机器人没有可用的会话状态。': 'This bot has no available Session state.',
  '当前聊天还没有可压缩的会话，请先发送一条消息。':
    'This chat has no Session to compact yet; please send a message first.',
  '当前机器人暂不支持上下文压缩。': 'This bot does not support context compaction yet.',
  '当前 Harness 未注册 /compact 命令，请确认上下文压缩组件已启用。':
    'The current Harness has not registered the /compact command; please make sure the context compaction component is enabled.',

  // clear-command.mjs
  '/clear  清空当前会话上下文（保留 Session 绑定和历史记录）':
    '/clear  Clear the current session context (keep the Session binding and history)',
  '清空当前会话上下文并保留会话绑定':
    'Clear the current session context and keep the Session binding',
  '用法：/clear（不带参数且不可附带图片或文件）':
    'Usage: /clear (no arguments, images or files)',
  '当前聊天绑定的会话已不存在，未清空上下文；请先发送新消息开启会话。':
    'The Session bound to this chat no longer exists; the context was not cleared. Send a new message to start a Session first.',
  '当前会话正在生成回复或等待交互，请先完成交互或发送 /stop，再执行 /clear。':
    'The current Session is generating a reply or waiting for an interaction. Finish it or send /stop before running /clear.',
  '上下文清理已取消，当前会话未修改。':
    'Context clearing was cancelled; the current Session was not changed.',
  '工作区或机器人状态已发生变化，未清空当前会话，请重试。':
    'The workspace or bot state changed, so the current Session was not cleared. Please try again.',
  '当前 Host 不支持 /clear，当前会话未修改。':
    'The current Host does not support /clear; the current Session was not changed.',
  '清空当前会话上下文失败，当前会话未修改，请稍后重试。':
    'Failed to clear the current Session context; the Session was not changed. Please try again later.',
  '当前机器人没有可用的会话状态，未清空当前会话。':
    'This bot has no available Session state; the current Session was not cleared.',
  '当前聊天还没有可清空的会话，请先发送一条消息。':
    'This chat has no Session to clear yet; please send a message first.',
  '当前会话上下文已清空；Session 绑定和历史记录仍保留。':
    'The current Session context was cleared; its binding and history were retained.',

  // control-command.mjs
  '用法：/stop（不带参数）': 'Usage: /stop (no arguments)',
  '用法：/version（不带参数）': 'Usage: /version (no arguments)',
  '用法：/steer <补充指令>': 'Usage: /steer <additional instruction>',
  '控制命令仅支持纯文字，请移除图片后重试。':
    'Control commands support text only; please remove images and try again.',
  '当前聊天没有正在运行的任务。': 'This chat has no running task.',
  '已请求停止当前任务。': 'Stop requested for the current task.',
  '当前聊天没有正在运行的任务，请直接发送普通消息。':
    'This chat has no running task; just send a regular message.',
  '当前聊天没有绑定会话，无法补充指令。请先绑定会话。':
    'No session is bound to this chat, so an additional instruction cannot be given. Bind a session first.',
  '任务已结束，没有正在运行的任务，无法补充指令。请直接发送消息开始新任务。':
    'The task has ended and there is no running task to steer. Send a message to start a new task.',
  '已排队，等待前序消息处理。': 'Queued. Waiting for the preceding messages to finish.',
  '排队中的消息在服务重启时被中断。为避免重复执行，未自动重放；如果该消息尚未处理，请重新发送。':
    'A queued message was interrupted when the service restarted. It was not replayed automatically to avoid running it twice; if it was not processed, please send it again.',
  '已提交补充指令，Agent 会在下一步读取。':
    'Additional instruction submitted; the Agent will read it at the next step.',
  // delivery-sync-rpc.mjs
  '请求已取消。': 'The request was cancelled.',
  '无效的会话同步设置：开关必须是布尔值，图标是不超过 32 个字符的文本。':
    'Invalid Session sync settings: each switch must be a boolean and an icon is text of at most 32 characters.',
  '无法读取或保存会话同步设置，请稍后重试。':
    'Could not read or save Session sync settings. Try again later.',

  // plan-goal-command.mjs
  '当前聊天还没有可用的会话，请先发送一条消息。':
    'This chat has no available Session yet; please send a message first.',
  '当前 Host 不支持命令委派，请确认 DSH 命令网关可用。':
    'The current Host does not support command delegation; make sure the DSH command gateway is available.',
  '{name} 已执行。': '{name} executed.',
  '{name} 执行失败。': '{name} failed.',
  '{name} 执行失败，请稍后重试。': '{name} failed; please try again later.',
  '当前机器人暂不支持 {name} 命令。': 'This bot does not support the {name} command yet.',
  '当前 Host 未注册 {name} 命令。': 'The current Host has not registered the {name} command.',
};
