// English translations (shared-c area). Keys are exact Chinese literals passed to t().
export default {
  '请先在“绑定 DS Bot”中解除绑定，再切换会话或工作目录。': 'Unbind in “Bind DS Bot” before switching the Session or working directory.',
  '当前会话日志已损坏，无法继续读取。请先到 DSH 查看任务状态，再发送 /new 创建新会话；原会话记录会保留。': 'The current Session log is corrupt and cannot be read. Check the task status in DSH before sending /new to create a new Session; the original records will be preserved.',
  '绑定会话的日志已损坏，已切换到新会话并继续处理本条消息。原会话记录已保留，历史上下文不会自动带入。': 'The bound Session log is corrupt. Switched to a new Session to continue processing this message. The original records are preserved; previous context is not carried over automatically.',
  '微信': 'Weixin',
  '飞书': 'Feishu',
  '钉钉': 'DingTalk',
  '企业微信': 'Enterprise WeChat',
  '{channel}正在初始化，请稍后重新读取。': '{channel} is initializing. Please reload shortly.',
  '{channel}配置格式错误。请检查其数据目录中的 config.json 和 workspaces.json，修复后重启 DSH。详细原因请查看启动日志。': 'The {channel} configuration is invalid. Check config.json and workspaces.json in its data directory, then restart DSH. See the startup log for details.',
  '{channel}配置格式错误。请检查其数据目录中的 config.json，修复后重启 DSH。详细原因请查看启动日志。': 'The {channel} configuration is invalid. Check config.json in its data directory, then restart DSH. See the startup log for details.',
  '无法读取或写入{channel}配置。请检查其数据目录的访问权限，修复后重启 DSH。详细原因请查看启动日志。': 'The {channel} configuration could not be read or written. Check access to its data directory, then restart DSH. See the startup log for details.',
  '{channel}初始化失败。请展开诊断详情，并通过参考号查找 DSH 启动日志，修复后重启 DSH。': '{channel} initialization failed. Expand the diagnostic details and find the reference in the DSH startup log, fix the issue, then restart DSH.',
  // history-command.mjs / command help
  '/history [数量]  查看最近历史消息（默认 3 条，最多 5 条）':
    '/history [count]  Preview recent messages (default 3, maximum 5)',
  '用法：/history [数量]（默认 3 条，最多 5 条）':
    'Usage: /history [count] (default 3, maximum 5)',
  '[图片]': '[Image]',
  '[文件]': '[File]',
  '本条没有可预览的文字。': 'This message has no text to preview.',
  '（已截断）': ' (truncated)',
  '会话历史｜{session}｜最近 {count} 条':
    'Session history | {session} | Recent messages: {count}',
  '以上为历史记录，不是本次新回复。':
    'These are history records, not a new reply.',
  '本次有限读取中仅找到 {count} 条可预览消息。':
    'Messages available to preview within this bounded read: {count}.',
  '当前会话仅有 {count} 条可预览消息。':
    'Messages available to preview in this Session: {count}.',
  '用户': 'User',
  '助手': 'Assistant',
  '当前聊天绑定的会话已不存在，请重新绑定会话。':
    'The Session bound to this chat no longer exists. Please bind a Session again.',
  '会话、工作区或机器人状态已发生变化，请重新执行 /history。':
    'The Session, workspace, or bot state has changed. Please run /history again.',
  '当前 Harness 暂不支持读取会话历史。':
    'This Harness does not support reading Session history.',
  '历史读取已取消。': 'History reading was cancelled.',
  '读取历史超时，请稍后重试。': 'Reading history timed out. Please try again later.',
  '暂时无法读取会话历史，请稍后重试。':
    'Unable to read Session history right now. Please try again later.',
  '请在与机器人的私聊中使用 /history。':
    'Please use /history in a direct chat with the bot.',
  '/history 仅支持文字命令，请移除图片或文件后重试。':
    '/history supports text commands only. Remove images or files and try again.',
  '当前聊天尚未绑定会话，请先发送消息或使用 /session 绑定会话。':
    'This chat has no bound Session. Send a message or use /session to bind one first.',
  '本次有限读取中未找到可预览的历史消息。':
    'No history messages were available to preview within this bounded read.',
  '当前会话暂无可预览的历史消息。':
    'This Session has no history messages available to preview yet.',

  // harness-approval.mjs
  '请精准回复「批准」或「拒绝」（也支持：同意 / 不同意 / yes / no）。':
    'Please reply exactly with 「批准」 (approve) or 「拒绝」 (reject). Also accepted: 同意 / 不同意 / yes / no.',
  '请先完成当前问题，再精准回复「批准」或「拒绝」。':
    'Please finish the current question first, then reply exactly with 「批准」 (approve) or 「拒绝」 (reject).',
  '该审批已处理，无需再次回复。':
    'This approval has already been handled; no need to reply again.',
  '审批已超时，已自动拒绝此次操作。':
    'This approval timed out and the operation was rejected automatically.',
  '审批已超时，正在自动拒绝，但暂未得到确认，稍后会自动重试。':
    'This approval timed out. Automatic rejection has not been confirmed yet and will be retried shortly.',
  'DeepSeek Harness 需要你的审批：':
    'DeepSeek Harness needs your approval:',
  '工具：{tool}': 'Tool: {tool}',
  '操作参数：': 'Operation parameters:',
  '原因：{reason}': 'Reason: {reason}',
  '群聊中请 @机器人 后发送审批决定。':
    'In group chats, please @ the bot before sending your approval decision.',
  '只有发起当前任务的用户可以处理这条审批。':
    'Only the user who started the current task can handle this approval.',
  '审批决定正在提交，请稍候。':
    'Your approval decision is being submitted; please wait.',
  '已批准，仅对本次操作有效。':
    'Approved — valid for this operation only.',
  '已拒绝此次操作。': 'This operation was rejected.',
  '机器人端无法处理这次审批，请到 Web 查看。': 'The bot cannot handle this approval. Please check the Web interface.',
  '未找到可处理端，本次操作未获批准。': 'No approval interface is available. This operation was not approved.',
  '有操作在等待审批：{tool}，请到 Web 处理。': 'An operation is awaiting approval: {tool}. Please handle it in the Web interface.',
  '本会话有问题等待回答，请在桌面端回答。': 'This session has a pending question. Please answer it in the desktop app.',
  '无法完整展示这次操作，已安全拒绝此次审批。':
    'The operation could not be displayed in full, so this approval was safely rejected.',
  '审批提交失败，请重新回复「批准」或「拒绝」。':
    'Failed to submit the approval; please reply with 「批准」 (approve) or 「拒绝」 (reject) again.',

  // harness-question.mjs
  'DeepSeek Harness 需要你补充信息{progress}：':
    'DeepSeek Harness needs more information{progress}:',
  '请输入你的回答。': 'Please enter your answer.',
  '请回复选项序号或文字；多选用逗号分隔，也可补充其他内容。':
    'Reply with option numbers or text; separate multiple choices with commas, or add anything else.',
  '请回复一个选项序号或文字，也可直接输入其他答案。':
    'Reply with an option number or its text, or type your own answer directly.',
  '请点击下方按钮选择，也可直接回复文字。':
    'Tap a button below to choose, or reply with text directly.',
  '请直接回复你的答案。': 'Please reply with your answer directly.',
  '群聊中请 @机器人 后发送答案。':
    'In group chats, please @ the bot before sending your answer.',

  // image-prompt.mjs
  '当前模型不支持图片，请用 /models 查看可用模型，再用 /model <序号> 切换后重发。':
    'The current model does not support images. Use /models to list available models, switch with /model <number>, then resend.',
  '当前会话模型不支持直接接收图片输入。用户发送的图片已作为文件保存到工作区（见下方文件清单）。请使用可用工具分析这些图片文件后回答，例如 run_code 或 pwsh 读取字节、解析元数据、调用图像处理或 OCR 库；不要假设自己能直接看到图片内容。':
    'The current session model does not accept direct image input. The images sent by the user were saved into the workspace as files (see the file manifest below). Answer by analyzing those image files with the available tools — for example run_code or pwsh to read bytes, parse metadata, or call image-processing or OCR libraries — and do not assume you can see the images directly.',
  '图片超过宿主允许的大小，请压缩后重试。':
    'The image exceeds the size allowed by the host; compress it and try again.',
  '图片分辨率过高，请压缩后重试。':
    'The image resolution is too high; compress it and try again.',
  '图片内容无效或格式不受支持，请重新发送。':
    'The image content is invalid or its format is unsupported; please resend it.',
  '未能读取图片内容，请重新发送。':
    'Could not read the image content; please resend it.',
  '图片格式与实际内容不一致，请重新发送。':
    'The image format does not match its actual content; please resend it.',
  '一次发送的图片数量超过宿主限制，请减少后重试。':
    'The number of images sent at once exceeds the host limit; send fewer and try again.',
  '图片总大小超过宿主限制，请减少图片或压缩后重试。':
    'The total image size exceeds the host limit; send fewer images or compress them and try again.',
  '图片下载地址发生了重定向，暂时无法读取。':
    'The image download URL redirected and cannot be read right now.',
  '图片下载失败（HTTP {status}），请重新发送后再试。':
    'Image download failed (HTTP {status}); please resend it and try again.',
  '图片超过 5 MB，请压缩后重试。':
    'The image is larger than 5 MB; compress it and try again.',
  '一次最多只能处理 {maxImages} 张图片。':
    'At most {maxImages} images can be processed at once.',
  '一次发送的图片总大小过大，请减少图片数量或压缩后重试。':
    'The total size of the images sent is too large; send fewer images or compress them and try again.',
  '图片下载失败，请重新发送后再试。':
    'Image download failed; please resend it and try again.',
  '暂不支持该图片格式，请发送 JPEG、PNG、WebP 或 GIF 图片。':
    'This image format is not supported yet; please send a JPEG, PNG, WebP, or GIF image.',

  // connection-test.mjs
  '✅ DeepSeek Harness 连接测试成功':
    '✅ DeepSeek Harness connection test succeeded',
  '这条消息由「IM机器人」设置页中的“{name}”机器人卡片发出。':
    'This message was sent from the "{name}" bot card on the IM Bot settings page.',
  '{channelLabel}尚未收到可用于测试的私聊消息。':
    'The {channelLabel} has not received a direct message that can be used for testing yet.',
  '机器人': 'bot',

  // editable-message-stream.mjs / harness-client.mjs / progress text
  '正在处理…': 'Processing…',
  '处理完成。': 'Processing complete.',
  '工具': 'tool',
  '正在整理结果…': 'Gathering results…',
  '_正在搜索网络并整理信息…_': '_Searching the web and gathering information…_',
  '_正在使用 {name}…_': '_Using {name}…_',

  // image-prompt.mjs
  '请分析这张图片。': 'Analyze this image.',

  // inbound-file.mjs
  '文件接收失败，请重新发送后再试。': 'File reception failed. Please resend it.',
  '文件下载失败，请重新发送后再试。': 'File download failed. Please resend it.',

  // agent-preset.mjs
  'Agent Preset 无效。': 'Invalid Agent Preset.',

  // batch-input.mjs
  '/batch  开始批量输入（仅私聊，最多 10 条文字）':
    '/batch  Start batch input (direct messages only, up to 10 text messages)',
  '/send  提交当前批次': '/send  Submit the current batch',
  '/cancel  取消当前批次': '/cancel  Cancel the current batch',
  '开始批量输入（仅私聊）': 'Start batch input (direct messages only)',
  '提交当前批次': 'Submit the current batch',
  '取消当前批次': 'Cancel the current batch',
  '当前已处于批量输入模式，已收集 {count}/{limit} 条。\n请发送 /send 提交或 /cancel 取消。':
    'Batch input is already active with {count}/{limit} messages collected.\nSend /send to submit or /cancel to cancel.',
  '当前已处于批量输入模式，已收集 {count}/{limit} 条。\n完成后发送 /send，取消请发送 /cancel。':
    'Batch input is already active with {count}/{limit} messages collected.\nSend /send when finished or /cancel to cancel.',
  '[消息 {index}]': '[Message {index}]',
  '以下是用户通过批量输入模式发送的多条内容，请按顺序作为同一次输入统一处理。':
    'The user sent the following messages in batch input mode. Process them in order as one input.',
  '批量输入模式仅支持私聊，请在与机器人的私聊中使用。':
    'Batch input is available only in direct messages. Please use it in a direct chat with the bot.',
  '当前聊天有正在运行的任务、待回答问题或待审批请求。\n请先完成当前交互或发送 /stop，再使用 /batch。':
    'This chat has a running task, unanswered question, or pending approval.\nFinish the current interaction or send /stop before using /batch.',
  '用法：/{command}（不带参数）': 'Usage: /{command} (without arguments)',
  '批量输入命令仅支持纯文字，请移除图片、文件或引用消息后重试。':
    'Batch input commands support text only. Remove the image, file, or quoted message and try again.',
  '当前没有待提交的批量内容，请先发送 /batch。':
    'There is no batch to submit. Send /batch first.',
  '当前没有正在进行的批量输入。': 'There is no active batch input.',
  '已进入批量输入模式，最多可发送 {limit} 条文字。\n完成后发送 /send，取消请发送 /cancel。':
    'Batch input started. You can send up to {limit} text messages.\nSend /send when finished or /cancel to cancel.',
  '批量输入模式目前仅支持文字，不支持图片、文件或引用消息，这条消息未收录。\n请继续发送文字，或使用 /send、/cancel。':
    'Batch input currently supports text only, not images, files, or quoted messages, so this message was not collected.\nContinue with text, or use /send or /cancel.',
  '当前批次正在提交，请勿重复发送 /send。':
    'The current batch is being submitted. Do not send /send again.',
  '批量内容已经提交，无法取消。\n如需停止当前任务，请发送 /stop。':
    'The batch has already been submitted and cannot be cancelled.\nSend /stop if you need to stop the current task.',
  '当前批次正在提交，请等待处理完成后再开启新批次。':
    'The current batch is being submitted. Wait for it to finish before starting another batch.',
  '已取消批量输入。': 'Batch input cancelled.',
  '已取消批量输入，共丢弃 {count} 条消息。':
    'Batch input cancelled; {count} messages were discarded.',
  '当前批次还没有内容，请先发送文字，或使用 /cancel 取消。':
    'The current batch is empty. Send some text first or use /cancel.',
  '当前正在批量输入，请先发送 /send 提交或 /cancel 取消。':
    'Batch input is active. Send /send to submit or /cancel to cancel first.',
  '当前批次已满，这条消息未收录。\n请先发送 /send 提交或 /cancel 取消，然后重新发送这条消息。':
    'The current batch is full, so this message was not collected.\nSend /send or /cancel first, then resend this message.',
  '已收集 {count}/{limit} 条，当前批次已满，请发送 /send 提交或 /cancel 取消。':
    'Collected {count}/{limit} messages. The batch is full; send /send or /cancel.',
  '批量内容提交失败，已保留 {count} 条消息。\n请再次发送 /send 重试或 /cancel 取消。':
    'Batch submission failed; {count} messages were retained.\nSend /send to retry or /cancel to cancel.',
  '你可以发送普通消息，但没有执行命令的权限。请联系管理员在 DSH 设置 → IM机器人 → 对应机器人 → 访问设置中，为你开启当前私聊或群聊场景的命令权限后重试。':
    'You can send regular messages, but you do not have permission to run commands. Ask an administrator to grant you command permission for the current direct or group chat under DSH Settings → IM Bots → the relevant bot → Access Settings, then try again.',
};
