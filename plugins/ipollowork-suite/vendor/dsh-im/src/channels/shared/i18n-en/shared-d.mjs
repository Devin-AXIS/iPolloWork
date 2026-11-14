// English translations (shared-d area: session navigation commands).
// Keys are exact Chinese literals passed to t().
export default {
  '当前会话最近 {count} 条（仅显示提问与回答）：':
    'Current session, last {count} messages (prompts and answers only):',
  '会话 {n} 最近 {count} 条（仅显示提问与回答）：':
    'Session {n}, last {count} messages (prompts and answers only):',
  '… 还有 {n} 条更早的消息。': '… and {n} more messages.',
  '会话、工作区或机器人状态已发生变化，请重新执行 /tail。':
    'The session, workspace, or bot state has changed. Please run /tail again.',
  '读取已取消。': 'Reading was cancelled.',
  '读取超时，请稍后重试。': 'Reading timed out. Please try again later.',
  '暂时无法读取会话内容，请稍后重试。':
    'The session content is temporarily unavailable. Please try again later.',
  '没有编号为 {n} 的会话。用 /ls 查看列表。':
    'There is no session number {n}. Use /ls to see the list.',
  '编号 {n} 的会话已不存在或已归档。如需从列表移除请发送 /drop {n}。':
    'Session {n} no longer exists or is archived. To remove it from the list, send /drop {n}.',
  '工作区或机器人状态已发生变化，请重试 /go {n}。':
    'The workspace or bot state has changed. Please retry /go {n}.',
  '暂时无法切换会话，请稍后重试。': 'Cannot switch sessions right now. Please try again later.',
  '此聊天或话题还没有会话，发送 /new 创建第一个（列表按聊天隔离，论坛群按话题）。':
    'No sessions in this chat/topic yet — /new creates the first one (the list is per chat, per topic in forum groups).',
  '会话较多，仅显示最近 {shown} 条（共 {total} 条）。':
    'Many sessions; showing the latest {shown} of {total}.',
  '已切换到会话 {n}（{title}，最后活动 {age}）。':
    'Switched to session {n} ({title}, last activity {age}).',
  '此聊天没有更早的会话。': 'No earlier session in this chat.',
  '此聊天没有更晚的会话。': 'No later session in this chat.',
  '目标会话不存在，请发送 /ls 查看。':
    'The target session no longer exists. Send /ls to review the list.',
  '已切换到会话 {n}（{title}）。': 'Switched to session {n} ({title}).',
  '已从会话列表移除编号 {n}。注意：Harness 中的会话本身未被删除或归档，仍可在 DSH 中访问。':
    'Removed session {n} from the list. Note: the session itself was not deleted or archived in Harness and is still available in DSH.',
  '当前聊天尚未绑定会话，无法确定保留哪条，未移除任何记录。':
    'This chat is not bound to a session, so there is nothing to keep; no entries were removed.',
  '列表里只有当前会话，无需移除。':
    'Only the current session is in the list, so there is nothing to remove.',
  '已移除 {count} 条记录，保留编号 {n}（当前会话）。注意：Harness 中的会话本身未被删除或归档，仍可在 DSH 中访问。':
    'Removed {count} entries; kept № {n} (current). Note: the sessions themselves were not deleted or archived in Harness and are still available in DSH.',
  '会话 {n}：{title}': 'Session {n}: {title}',
  '当前聊天尚未绑定会话。': 'This chat is not bound to a session yet.',
  '当前会话编号 {n}：{title}': 'Current session number {n}: {title}',
  '当前 Harness 暂不支持重命名会话。': 'This Harness does not support renaming sessions.',
  '已将会话标题改为「{title}」。': 'Renamed the session to "{title}".',
  '暂时无法重命名会话，请稍后重试。': 'Cannot rename the session right now. Please try again later.',
  '本次有限读取中未找到可预览的消息。':
    'No previewable messages were found in this bounded read.',
  '当前会话暂无可预览的消息。': 'This session has no previewable messages.',
  '用法：/go 会话编号（用 /ls 查看编号）。':
    'Usage: /go <session number> (see numbers with /ls).',
  '用法：/drop 会话编号（用 /ls 查看编号）。':
    'Usage: /drop <session number> (see numbers with /ls).',
  '未知命令，请发送 /help 查看帮助。': 'Unknown command. Send /help for help.',
  '导出时间：{time}': 'Exported: {time}',
  '消息数：{count}': 'Messages: {count}',
  '导出标题：会话': 'session',
  '导出角色：用户': 'User',
  '导出角色：助手': 'Assistant',
  '正文说明：消息正文以代码围栏逐字引用，围栏长度大于正文中任意连续的围栏字符。':
    'Convention: message bodies are quoted verbatim inside code fences whose delimiter is longer than any run of fence characters in the body.',
  '注意：因事件数量达到上限，导出内容被截断。':
    'Note: the export was truncated because the event cap was reached.',
  '当前渠道不支持发送文件。': 'This channel does not support sending files.',
  '隐藏消息': 'Hide message',
  '已隐藏。': 'Hidden.',
  '列出本聊天使用过的会话（按聊天/话题隔离）': "List this chat's sessions (per chat / per topic)",
  '/ls 或 /list  列出本聊天使用过的会话（● 当前，←/→ 可前后切换，✕ 已失效；列表按聊天隔离，论坛群按话题）':
    '/ls or /list  List this chat\'s sessions (● current, ←/→ navigate, ✕ unavailable; the list is per chat, and per topic in forum groups)',
  '切换到指定编号的会话': 'Switch to a session by number',
  '/go 会话编号  切换到该会话（编号见 /ls）':
    '/go <number>  Switch to that session (numbers in /ls)',
  '回到上一个会话': 'Go back to the previous session',
  '/prev  回到上一个会话': '/prev  Go back to the previous session',
  '前进到下一个会话': 'Go forward to the next session',
  '/next  前进到下一个会话': '/next  Go forward to the next session',
  '从会话列表移除一条记录': 'Remove one entry from the session list',
  '/drop 会话编号  从本聊天会话列表移除该条记录（不删除 Harness 会话）':
    '/drop <number>  Remove that entry from this chat\'s session list (the Harness session is not deleted)',
  '/drop all  移除除当前会话外的全部记录（不删除 Harness 会话）':
    '/drop all  Remove every entry except the current session (the Harness sessions are not deleted)',
  '查看或重命名会话标题': 'Show or rename a session title',
  '/title  查看当前会话标题': '/title  Show the current session title',
  '/title 新标题  重命名当前会话': '/title <new title>  Rename the current session',
  '/title 会话编号 新标题  重命名指定会话': '/title <number> <new title>  Rename that session',
  '预览或导出会话内容': 'Preview or export session content',
  '/tail 或 /peek [编号] [条数]  预览最近消息（默认 5 条，仅提问与回答）':
    '/tail or /peek [number] [count]  Preview recent messages (default 5; prompts and answers only)',
  '/tail 或 /peek [编号] file  导出整个会话为 Markdown 文件':
    '/tail or /peek [number] file  Export the whole session as a Markdown file',
  '会话（/go N）：': 'Sessions (/go N):',
  '秒': 's',
  '分': 'min',
  '时': 'h',
  '天': 'd',
  '无标题': 'no title',
  '当前会话：{title}': 'Current session: {title}',
  '已记住新会话标题「{title}」，将在下一条消息创建会话时应用。':
    'Remembered the new session title "{title}"; it will be applied when the next message creates the session.',
  '编号 {n} 是当前会话，不能删除。请先切换到其他会话（/go 数字、/prev 或 /new）再删除。':
    'Session {n} is the current session and cannot be dropped. Switch away first (/go <number>, /prev, or /new), then drop it.',
  '✕ 当前会话已失效，发送 /new 可开启新会话。':
    '✕ The current session is unavailable; send /new to start a fresh one.',
  '开启一个全新会话（可带标题）': 'Start a brand-new session (with an optional title)',
  '/new [标题]  开启一个全新会话（可指定标题）':
    '/new [title]  Start a brand-new session (optionally titled)',
  '从当前会话分支一个新会话': 'Branch a new session from the current one',
  '/fork [标题]  从当前会话分支一个新会话（默认沿用父会话标题加“ (fork)”）':
    '/fork [title]  Branch a new session from the current one (default: parent title + " (fork)")',
  '当前 Host 不支持会话分支（fork）。': 'This Host does not support session branching (fork).',
  '当前会话仍在生成回复，请先等待完成或发送 /stop 再分支。':
    'The current session is still generating a reply; wait for it to finish or send /stop before forking.',
  '当前会话还没有已完成的回合，无法分支。请先完成一个回合再 /fork。':
    'The current session has no completed turn yet; finish one before /fork.',
  '当前会话已不存在或已归档，无法分支。':
    'The current session no longer exists or is archived; it cannot be forked.',
  '工作区或机器人状态已发生变化，请重试 /fork。':
    'The workspace or bot state has changed; please retry /fork.',
  '暂时无法分支会话，请稍后重试。': 'Cannot fork the session right now. Please try again later.',
  '分支出的子会话无法绑定，请重试。': 'The forked child session could not be bound. Please try again.',
  '分支出的子会话已归档，无法绑定。': 'The forked child session is archived and cannot be bound.',
  '暂时无法绑定分支出的子会话，请稍后重试。':
    'Cannot bind the forked child session right now. Please try again later.',
  '已从会话 {parent} 分支到会话 {child}：{title}': 'Forked session {parent} into session {child}: {title}',
  '切换后的提问发送失败，请重试。': 'The follow-up question after the switch failed to send. Please try again.',
  '暂时无法创建新会话，请稍后重试。': 'Cannot create a new session right now. Please try again later.',
  '重置当前会话上下文（保留会话编号）': 'Reset the current session context (keep the number)',
  '/reset  重置当前会话上下文（保留会话编号，旧会话可 /session 找回）':
    '/reset  Reset the current session context (keep the number; the old session is reachable via /session)',
  '用法：/reset（不带参数且不可附带图片或文件）':
    'Usage: /reset (no arguments, and no images or files)',
  '当前会话正在生成回复或等待交互，请先完成交互或发送 /stop，再执行 /reset。':
    'The current session is generating a reply or awaiting an interaction; finish it or send /stop before /reset.',
  '当前机器人没有可用的会话状态，未重置当前会话。':
    'This bot has no session state available; the current session was not reset.',
  '当前 Host 不支持 /reset，当前会话未修改。':
    'This Host does not support /reset; the current session is unchanged.',
  '重置当前会话上下文失败，当前会话未修改，请稍后重试。':
    'Could not reset the current session context; it is unchanged. Please try again later.',
  '当前会话上下文已重置（编号保持不变）。旧会话 ID：{id}，可用 /session {id} 重新绑定。':
    'The current session context is reset (the number is unchanged). Old session ID: {id}; rebind it with /session {id}.',
  '当前聊天还没有会话，已开启全新会话。':
    'This chat has no session yet, so a new session was started.',
};
