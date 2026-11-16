import { t } from './i18n.mjs';

const TEXT_CHANNELS = Object.freeze(['telegram', 'slack', 'discord', 'whatsapp', 'matrix']);

function defineCatalogCommand(name, description, help, { aliases = [], ...options } = {}) {
  return Object.freeze({
    name,
    description,
    channels: TEXT_CHANNELS,
    menuVisible: true,
    ...options,
    aliases: Object.freeze(aliases.map((alias) => Object.freeze({
      menuVisible: true,
      ...(typeof alias === 'string' ? { name: alias } : alias),
    }))),
    help: Object.freeze(help),
  });
}

// Presentation metadata for TextHarnessBridge commands, in help order.
// Keep each command's aliases, short description and full usage together here.
// Handlers still own parsing and authorization; privateOnly is descriptive.
// enabled: false removes a definition from both consumers; menuVisible: false
// hides a command (or alias) only from the native menu, leaving help available.
export const SHARED_COMMAND_CATALOG = Object.freeze([
  defineCatalogCommand('new', '开启一个全新会话（可带标题）', [
    '/new [标题]  开启一个全新会话（可指定标题）',
  ]),
  defineCatalogCommand('fork', '从当前会话分支一个新会话', [
    '/fork [标题]  从当前会话分支一个新会话（默认沿用父会话标题加“ (fork)”）',
  ], { requiresSessionFork: true }),
  defineCatalogCommand('reset', '重置当前会话上下文（保留会话编号）', [
    '/reset  重置当前会话上下文（保留会话编号，旧会话可 /session 找回）',
  ]),
  defineCatalogCommand('compact', '压缩当前会话的较早上下文', [
    '/compact  压缩当前会话的较早上下文',
  ]),
  defineCatalogCommand('clear', '清空当前会话上下文并保留会话绑定', [
    '/clear  清空当前会话上下文（保留 Session 绑定和历史记录）',
  ]),
  defineCatalogCommand('history', '查看最近历史消息（仅私聊）', [
    '/history [数量]  查看最近历史消息（默认 3 条，最多 5 条）',
  ], { privateOnly: true }),
  // Merged listing+switch command: no argument opens the picker, an argument
  // switches directly. /wsl and friends stay accepted but leave the menu so
  // there is one workspace entry to choose from.
  defineCatalogCommand('workspace', '查看或切换工作区', [
    '/workspace 或 /ws  查看可切换的工作区（点按钮切换）',
    '/workspace 工作区序号或绝对路径  切换工作区',
  ], { aliases: [{ name: 'ws', menuVisible: false }] }),
  defineCatalogCommand('conv', '设置当前对话专属工作区', [
    '/conv 或 /conversation  查看当前对话工作区',
    '/conv 工作区绝对路径或序号  设置当前对话专属工作区',
    '/conv clear  清除专属工作区，回到 bot 默认工作区',
  ], {
    // Aliases stay typeable and stay in /help, but the native Telegram menu
    // lists each command once; B16 in the command UX audit.
    aliases: [
      { name: 'conversation', menuVisible: false },
      { name: 'thread', menuVisible: false },
    ],
  }),
  defineCatalogCommand('workspacelist', '列出工作区绝对路径', [
    '/workspacelist、/wsl、/workspaces  工作区列表别名（等同 /ws）',
  ], {
    // Aliases stay typeable and stay in /help, but the native Telegram menu
    // lists each command once; B16 in the command UX audit.
    aliases: [
      { name: 'workspaces', menuVisible: false },
      { name: 'wsl', menuVisible: false },
    ],
    menuVisible: false,
  }),
  defineCatalogCommand('sessionlist', '列出会话 ID 和标题', [
    '/sessionlist 或 /sessions [工作区序号或绝对路径]  列出会话 ID 和标题',
    '/sessionlist --all  跨工作区汇总会话（每个工作区默认显示 10 个，可用 --limit N 调整）',
    '/sessionlist --limit N  仅列出当前工作区前 N 个会话',
  ], { aliases: [{ name: 'sessions', menuVisible: false }] }),
  defineCatalogCommand('session', '将当前聊天绑定到指定会话', [
    '/session Session ID、当前工作区序号或标题关键词  将当前聊天绑定到指定会话',
    '/sess  同一命令的别名（/session 被客户端同名命令抢占时使用）',
  ], { aliases: [{ name: 'sess', menuVisible: false }] }),
  defineCatalogCommand('sessionarchive', '归档指定会话（DSH 能力）', [
    '/sessionarchive（或 /sessarchive）Session ID  归档一个会话；序号只做预览',
    '/sessionarchive <Session ID> --stop  归档前先停止该会话正在运行的任务',
  ], { aliases: [{ name: 'sessarchive', menuVisible: false }] }),
  defineCatalogCommand('ls', '列出本聊天使用过的会话（按聊天/话题隔离）', [
    '/ls 或 /list  列出本聊天使用过的会话（● 当前，←/→ 可前后切换，✕ 已失效；列表按聊天隔离，论坛群按话题）',
  ], { aliases: [{ name: 'list', menuVisible: false }] }),
  defineCatalogCommand('go', '切换到指定编号的会话', [
    '/go 会话编号  切换到该会话（编号见 /ls）',
  ]),
  defineCatalogCommand('prev', '回到上一个会话', [
    '/prev  回到上一个会话',
  ]),
  defineCatalogCommand('next', '前进到下一个会话', [
    '/next  前进到下一个会话',
  ]),
  defineCatalogCommand('drop', '从会话列表移除一条记录', [
    '/drop 会话编号  从本聊天会话列表移除该条记录（不删除 Harness 会话）',
    '/drop all  移除除当前会话外的全部记录（不删除 Harness 会话）',
  ]),
  defineCatalogCommand('title', '查看或重命名会话标题', [
    '/title  查看当前会话标题',
    '/title 新标题  重命名当前会话',
    '/title 会话编号 新标题  重命名指定会话',
  ]),
  defineCatalogCommand('tail', '预览或导出会话内容', [
    '/tail 或 /peek [编号] [条数]  预览最近消息（默认 5 条，仅提问与回答）',
    '/tail 或 /peek [编号] file  导出整个会话为 Markdown 文件',
  ], { aliases: [{ name: 'peek', menuVisible: false }] }),
  defineCatalogCommand('models', '按序号列出所有可用模型', [
    '/models  按序号列出所有可用模型',
  ]),
  defineCatalogCommand('reasoninglist', '按序号列出当前模型可用推理等级', [
    '/reasoninglist 或 /reasonings  按序号列出当前模型可用推理等级',
  ], { aliases: [{ name: 'reasonings', menuVisible: false }] }),
  defineCatalogCommand('reasoning', '查看或切换当前推理等级', [
    '/reasoning [序号、等级ID或 --default]  查看或切换当前推理等级',
  ]),
  defineCatalogCommand('model', '查看或切换当前会话模型', [
    '/model [序号或完整模型ID] [推理等级ID]  查看或切换当前会话模型',
    '示例：先发 /models，再发 /model 2 [推理等级ID]',
  ]),
  defineCatalogCommand('presetlist', '列出可用 Agent Preset', [
    '/presetlist 或 /presets  按序号列出可用 Agent Preset',
  ], { aliases: [{ name: 'presets', menuVisible: false }] }),
  defineCatalogCommand('preset', '查看或设置新会话 Agent Preset', [
    '/preset [序号或完整ID]  查看或设置当前机器人 Agent Preset',
    '纯数字 ID：/preset id:<ID>',
    '/preset --default  跟随 Host 默认',
  ]),
  defineCatalogCommand('stop', '停止当前任务', [
    '/stop  停止当前任务',
  ]),
  defineCatalogCommand('steer', '纠偏当前任务', [
    '/steer 补充指令  纠偏当前任务',
  ]),
  defineCatalogCommand('batch', '开始批量输入（仅私聊）', [
    '/batch  开始批量输入（仅私聊，最多 10 条文字）',
  ], { privateOnly: true }),
  defineCatalogCommand('send', '提交当前批次', [
    '/send  提交当前批次',
  ], { privateOnly: true }),
  defineCatalogCommand('cancel', '取消当前批次', [
    '/cancel  取消当前批次',
  ], { privateOnly: true }),
  defineCatalogCommand('status', '检查连接状态', [
    '/status  检查连接状态',
  ]),
  defineCatalogCommand('version', '查看插件版本', [
    '/version  查看插件版本',
  ]),
  defineCatalogCommand('help', '显示帮助', [
    '/help  显示本帮助',
  ]),
]);

export function commandsForChannel(channel, catalog = SHARED_COMMAND_CATALOG) {
  return catalog.filter((item) => item.enabled !== false && item.channels.includes(channel));
}

/**
 * Drop entries whose required Host capability is absent (e.g. /fork when the
 * host facade exposes no sessions.fork member), so the menu and /help never
 * promise a command that always refuses.
 */
export function availableCommandCatalog(catalog = SHARED_COMMAND_CATALOG, { supportsFork = true } = {}) {
  return catalog.filter((item) => item.requiresSessionFork !== true || supportsFork);
}

/**
 * The session-navigation help lines every channel that handles them should
 * list, without the file-export form of /tail (only file-capable channels
 * document that). Kept here so the non-text bridges cannot drift from /ls.
 */
export const SESSION_NAV_HELP_LINES = Object.freeze([
  '/ls 或 /list  列出本聊天使用过的会话（● 当前，←/→ 可前后切换，✕ 已失效；列表按聊天隔离，论坛群按话题）',
  '/go 会话编号  切换到该会话（编号见 /ls）',
  '/prev  回到上一个会话',
  '/next  前进到下一个会话',
  '/drop 会话编号  从本聊天会话列表移除该条记录（不删除 Harness 会话）',
  '/title  查看当前会话标题',
  '/title 新标题  重命名当前会话',
  '/title 会话编号 新标题  重命名指定会话',
  '/fork [标题]  从当前会话分支一个新会话（默认沿用父会话标题加“ (fork)”）',
  '/reset  重置当前会话上下文（保留会话编号，旧会话可 /session 找回）',
  '/tail 或 /peek [编号] [条数]  预览最近消息（默认 5 条，仅提问与回答）',
]);

export function commandHelpLines(channel, catalog = SHARED_COMMAND_CATALOG) {
  return commandsForChannel(channel, catalog).flatMap((item) => item.help.map((line) => t(line)));
}
