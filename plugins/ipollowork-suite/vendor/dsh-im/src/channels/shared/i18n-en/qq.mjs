// English translations (qq area). Keys are exact Chinese literals passed to t().
export default {
  '无法读取 QQ 本地状态，请检查数据目录及访问权限。': 'Unable to read local QQ state. Check the data directory and access permissions.',
  'QQ 本地状态已损坏，但无法备份，原文件已保留。': 'Local QQ state is corrupt and could not be backed up. The original file has been preserved.',
  '无法保存 QQ 本地状态，请检查磁盘空间及目录写入权限。': 'Unable to save local QQ state. Check disk space and directory write permissions.',
  '返回主菜单': 'Back to main menu',
  '模式／预设': 'Mode / preset',
  '归档显示': 'Archived sessions',
  '第 {page} / {pages} 页': 'Page {page} / {pages}',
  '当前会话：{session}': 'Current session: {session}',
  '模式／预设：{preset}': 'Mode / preset: {preset}',
  '当前模型：{model}': 'Current model: {model}',
  '暂不可用': 'Unavailable',
  '归档会话：{state}': 'Archived sessions: {state}',
  '显示': 'Shown',
  '隐藏': 'Hidden',
  '任务状态：{state}': 'Task status: {state}',
  '处理中': 'Processing',
  '空闲': 'Idle',
  '部分设置暂未加载，可进入对应列表重试。': 'Some settings could not be loaded. Open the corresponding list to retry.',
  '💬 会话选择': '💬 Select session',
  '📁 工作区': '📁 Workspace',
  '🤖 模式／预设': '🤖 Mode / preset',
  '🧠 模型': '🧠 Model',
  '💬 补充指令': '💬 Steer task',
  '给当前正在运行的任务补充指令。': 'Send an additional instruction to the running task.',
  '自定义指令': 'Custom instruction',
  '请发送 /steer 你的补充指令。': 'Send /steer followed by your instruction.',
  '发送 /m 打开助手中心，点击按钮或回复当前列表的数字选择。': 'Send /m to open the assistant menu. Click a button or reply with a number from the current list.',
  '设置：会话、工作区、模式／预设、模型。': 'Settings: session, workspace, mode / preset, model.',
  '会话：新会话、会话列表、归档显示切换。': 'Sessions: new session, session list, show or hide archived sessions.',
  '任务：停止、压缩、清空上下文、快捷或自定义补充指令。':
    'Tasks: stop, compact, clear context, quick or custom steering instructions.',
  '信息：状态、帮助。': 'Information: status, help.',
  '菜单有效期为 15 分钟；发送普通消息会退出数字选择。': 'Menus expire after 15 minutes. Sending an ordinary message exits number selection.',
  '回答问题、审批和批量输入时，数字优先用于当前交互。': 'During questions, approvals and batch input, numbers belong to that interaction.',
  '完整命令说明：/help': 'Full command reference: /help',
  '当前无法展示按钮，请回复数字选择。': 'Buttons are unavailable. Reply with a number to select.',
  '点击按钮或回复数字选择，/m 返回主菜单。': 'Click a button or reply with a number. Send /m for the main menu.',
  '回答问题、审批和批量输入时，请先完成当前交互。': 'Finish any pending question, approval or batch input before replying with a menu number.',
  '已选择': 'Selected',
  '请回复数字选择，或发送 /m 重新打开菜单。': 'Reply with a number or send /m to reopen the menu.',
  '当前正在批量输入，请先发送 /send 或 /cancel，再打开菜单。': 'Batch input is active. Send /send or /cancel before opening the menu.',
  '菜单命令无效，请发送 /m 重新打开。': 'Invalid menu command. Send /m to reopen the menu.',
  '当前任务仍在运行，请先停止任务或等待任务完成后再执行此操作。': 'A task is still running. Stop it or wait for it to finish before performing this action.',

  'QQ 机器人已连接 DeepSeek Harness。':
    'The QQ bot is connected to DeepSeek Harness.',
  '回答较长，后续内容未能通过 QQ 完整发送，请回复“继续”。':
    'The answer is long and the rest could not be sent fully through QQ. Reply “继续” (continue) to receive it.',




  '结果文件「{name}」已生成，但 QQ 今日文件上传额度已用完，请稍后重试。':
    'The result file "{name}" was generated, but QQ\'s daily file upload quota is used up. Please try again later.',

  '结果文件「{name}」已生成，但当前 QQ 机器人没有文件消息权限。':
    'The result file "{name}" was generated, but the current QQ bot does not have file message permission.',
  '结果文件「{name}」超过当前 QQ 机器人可发送的文件大小，未发送。':
    'The result file "{name}" exceeds the file size the current QQ bot can send and was not sent.',
  '结果文件「{name}」为空，QQ 不允许发送空文件。':
    'The result file "{name}" is empty, and QQ does not allow sending empty files.',

  '结果文件「{name}」暂时被 QQ 限流，未能发送，请稍后重试。':
    'The result file "{name}" was temporarily rate-limited by QQ and was not sent. Please try again later.',
  '结果文件「{name}」已生成，但 QQ 拒绝了该文件或文件消息。':
    'The result file "{name}" was generated, but QQ rejected the file or file message.',
  '结果文件「{name}」已生成，但暂时未能通过 QQ 发送，请稍后重试。':
    'The result file "{name}" was generated but could not be sent via QQ right now. Please try again later.',
  'QQ 机器人与 DeepSeek Harness 连接正常。':
    'The QQ bot is connected to DeepSeek Harness normally.',
  'QQ 交互问题发送失败。': 'Failed to send the QQ interaction question.',


  'QQ 机器人凭据缺失，请移除后重新扫码。':
    'The QQ bot credentials are missing. Remove the bot and scan the QR code again.',
  'QQ 连接未就绪，插件会自动重试。':
    'The QQ connection is not ready; the plugin will retry automatically.',
  'QQ 扫码服务暂时不可用，请重新生成二维码。':
    'The QQ QR service is temporarily unavailable. Please generate a new QR code.',
  '无法生成 QQ 二维码，请稍后重试。':
    'Unable to generate the QQ QR code. Please try again later.',
  'QQ 机器人已绑定，消息连接暂未就绪。':
    'The QQ bot is bound, but the message connection is not ready yet.',
  'QQ 连接仍未就绪，请稍后重试。':
    'The QQ connection is still not ready. Please try again later.',
  QQ机器人尚未连接: 'The QQ bot is not connected yet',
  'QQ 机器人（{appId}）': 'QQ bot ({appId})',
  QQ机器人: 'QQ bot',
  'QQ WebSocket 长连接运行正常': 'The QQ WebSocket long connection is running normally',
  'QQ 连接未就绪，插件会自动重试':
    'The QQ connection is not ready; the plugin will retry automatically',
  'QQ 连接当前离线': 'The QQ connection is currently offline',
  'QQ 已授权，但无法安全保存接入配置。':
    'QQ authorization succeeded, but the connection configuration could not be saved safely.',
};
