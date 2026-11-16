// English translations (telegram area). Keys are exact Chinese literals passed to t().
export default {
  // Terminal status written back over a placeholder whose in-place edit was
  // rejected, so it is the last thing a reader sees on a degraded reply.
  '回复已发送。': 'The reply was sent.',
  '回复发送结果未能确认。': 'The reply delivery result could not be confirmed.',
  '消息发送失败，请稍后重试。': 'The message could not be sent. Try again later.',
  '开启一个全新会话': 'Start a brand-new Session',
  '压缩当前会话的较早上下文': 'Compact the earlier context of the current Session',
  '切换工作区': 'Switch Workspace',
  // /ws workspace picker card: one tap switches, the pressed card is re-marked in place.
  '选择要切换的工作区（共 {count} 个）：': 'Choose a Workspace to switch to ({count} total):',
  '这个列表已过期，请重新发送 /ws。': 'This list has expired. Send /ws again.',
  '正在切换工作区，请稍候。': 'Switching Workspaces, one moment.',
  '已经在工作区：{workspace}': 'Already in this Workspace: {workspace}',
  '暂时无法切换工作区，请稍后重试。': 'Could not switch Workspaces right now. Try again later.',
  '列出工作区绝对路径': 'List Workspace absolute paths',
  '列出会话 ID 和标题': 'List Session IDs and titles',
  '将当前聊天绑定到指定会话': 'Bind the current chat to a specific Session',
  '按序号列出所有可用模型': 'List all available models by number',
  '查看或切换当前会话模型': 'View or switch the model of the current Session',
  '列出可用 Agent Preset': 'List available Agent Presets',
  '查看或设置新会话 Agent Preset': 'View or set the Agent Preset for new Sessions',
  '停止当前任务': 'Stop the current task',
  '纠偏当前任务': 'Steer the current task',
  '检查连接状态': 'Check connection status',
  '查看插件版本': 'Show plugin version',
  '显示帮助': 'Show help',
  '该 Telegram 机器人已配置 Webhook，请先在原服务中移除 Webhook 后重试。':
    'This Telegram bot already has a Webhook configured. Remove the Webhook from the original service and try again.',
  'Telegram机器人': 'Telegram Bot',
  ' Bot API 长轮询': ' Bot API long polling',
  // Approval button card (batch 1): buttons, terminal receipts and dead-card
  // notices. Keys match the literals passed through t() in approval-card.mjs.
  '✅ 批准一次': '✅ Approve once',
  '✅ 已批准（仅本次）': '✅ Approved (this time only)',
  '❌ 已拒绝': '❌ Rejected',
  '⏰ 已过期': '⏰ Expired',
  '⛔ 已失效': '⛔ No longer valid',
  '正在提交审批决定，请稍候。': 'Submitting the approval decision, please wait.',
  '该审批已处理，无需重复操作。': 'This approval was already handled. No need to act again.',
  '该审批已过期，已自动拒绝。': 'This approval expired and was rejected automatically.',
  '该审批已被新提示取代，请使用最新一条。':
    'This approval was superseded by a newer prompt; use the latest one.',
  '该审批已失效，请等待新的审批提示。':
    'This approval is no longer valid; wait for a new approval prompt.',
};
