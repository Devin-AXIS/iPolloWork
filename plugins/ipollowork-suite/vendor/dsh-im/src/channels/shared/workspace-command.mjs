import { isSessionNotFound } from './session-error.mjs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { t } from './i18n.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

const WORKSPACE_COMMAND = /^\/(?:workspace|ws)(?:\s+([\s\S]+))?$/i;
const WORKSPACE_LIST_COMMAND = /^\/(?:workspacelist|workspaces|wsl)(?:\s+([\s\S]+))?$/i;
const THREAD_WORKSPACE_COMMAND = /^\/(?:conv|conversation|thread)(?:\s+([\s\S]+))?$/i;
const SESSION_LIST_COMMAND = /^\/(?:sessionlist|sessions)(?:\s+([\s\S]+))?$/i;
// `/session` stays the advertised name. Some clients own a slash command of the
// same name and grab the input box before the bot sees it, so `/sess` is
// accepted as a short alias that survives those clients.
const SESSION_BIND_PREFIX = /^\/(?:session|sess)(?=$|\s)/i;
const SESSION_BIND_COMMAND = /^\/(?:session|sess)[ \t]+([^\s]+)$/i;
const MAX_WORKSPACE_PATH_LENGTH = 4_096;
const MAX_COMMAND_MESSAGE_LENGTH = 1_800;
const MAX_SESSION_ID_LENGTH = 256;
const UNSAFE_DISPLAY_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const UNSAFE_DISPLAY_TEXT_GLOBAL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const SESSION_BIND_USAGE = '用法：/session Session ID、当前工作区序号（/session N）或会话标题关键词';
const SESSION_LIST_USAGE = [
  '用法：',
  '/sessionlist  列出当前工作区会话',
  '/sessionlist --all  跨工作区汇总列出会话（每个工作区默认显示 10 个）',
  '/sessionlist --all --limit N  跨工作区汇总列出会话，每个工作区显示前 N 个',
  '/sessionlist --limit N  列出当前工作区前 N 个会话（N 为正整数）',
  '/sessionlist --archived  一并列出已归档会话（序号仍只对应未归档会话）',
  '/sessionlist 工作区序号  按 /workspacelist 序号列出会话',
  '/sessionlist 工作区绝对路径  列出指定工作区会话',
  '不带工作区参数时，默认列出当前对话的有效工作区（未设置对话专属工作区时即 bot 默认工作区）。',
].join('\n');
// Archiving is a Harness capability (workspace.archiveSession); the command only
// carries the request, so an older Host answers with a clear "not supported".
const SESSION_ARCHIVE_PREFIX = /^\/(?:sessionarchive|sessarchive)(?=$|\s)/i;
const SESSION_ARCHIVE_COMMAND = /^\/(?:sessionarchive|sessarchive)(?:[ \t]+([^\s]+))?(?:[ \t]+(--?stop))?$/i;
const SESSION_ARCHIVE_USAGE = '用法：/sessionarchive Session ID 归档一个会话；/sessionarchive 序号 只预览该序号对应的会话（编号会随列表变化，归档请用完整 ID）。加 --stop 可让 DSH 先停止该会话正在运行的任务';
// An index is resolved against a list that shifts as soon as a new Session
// appears (the command's own turn can add one), so an index only previews the
// target: archiving is destructive and has to name the Session explicitly.
const SESSION_ARCHIVE_PREVIEW = '按序号归档只做预览：/sessionarchive {index} 现在对应这条会话。';
const SESSION_ARCHIVE_PREVIEW_HINT = '（编号会随会话列表变化，所以不按序号直接归档；确认归档请发送：/sessionarchive {sessionId}）';
const SESSION_LIST_ALL_FLAG = '--all';
const SESSION_LIST_LIMIT_FLAG = '--limit';
const SESSION_LIST_ARCHIVED_FLAG = '--archived';
const ALL_WORKSPACES_DEFAULT_LIMIT = 10;
const MAX_SESSION_TITLE_QUERY_LENGTH = 120;
const MAX_SESSION_TITLE_MATCHES = 10;
const SESSION_ID_PREFIX = /^session-/iu;
const SESSION_LIST_ALL_HEADER = '跨工作区会话（{workspaces} 个工作区，共 {sessions} 个会话）：';
const SESSION_LIST_ALL_CURRENT = '当前工作区：{workspace}';
const SESSION_LIST_ALL_SKIPPED = '另有 {count} 个工作区暂时无法读取，未包含在汇总中。';
const SESSION_LIST_GROUP_HEADER = '{workspace}（{count} 个会话）';
const SESSION_LIST_GROUP_TRUNCATED = '（共 {total} 个，显示前 {shown} 个；用 --limit N 调整）';
const SESSION_LIST_GROUP_EMPTY = '该工作区暂无会话。';
const SESSION_LIST_GROUP_INVALID = '（{count} 条会话记录无效，已跳过）';
const SESSION_LIST_ARCHIVED_HIDDEN = '（已隐藏 {count} 条归档会话，用 --archived 查看）';
const SESSION_LIST_ARCHIVED_HEADER = '归档会话（只能用完整 Session ID 绑定）：';
const SESSION_TITLE_AMBIGUOUS = '标题包含「{keyword}」的会话有多个，请改用完整 Session ID 绑定：';
const SESSION_TITLE_REMOTE = '标题包含「{keyword}」的会话位于其他工作区，请使用完整 Session ID 绑定：';
const SESSION_TITLE_SEARCH_INCOMPLETE = '部分工作区暂时无法读取，搜索结果可能不完整；请使用完整 Session ID 绑定：';
const SESSION_TITLE_SEARCH_INCOMPLETE_MISS = '部分工作区暂时无法读取，未能确认标题包含「{keyword}」的会话。请稍后重试或使用完整 Session ID。';
const SESSION_TITLE_AMBIGUOUS_TRUNCATED = '匹配较多，只显示前 {count} 个，请使用更精确的关键词。';
const SESSION_TITLE_MISS = '没有标题包含「{keyword}」的会话，请先执行 /sessionlist --all 查看完整 Session ID。';
const SESSION_TITLE_BIND_FAILED = '按标题匹配到「{title}」（ID: {sessionId}，工作区: {workspace}），但 Harness 当前无法接管这个会话，请稍后重试或用完整 Session ID 绑定。';
const SESSION_TITLE_ARCHIVED = '标题包含「{keyword}」的会话已归档，按标题绑定不会接管归档会话，请用完整 Session ID 绑定：';

function commandResult(message, messages = [message], extra = {}) {
  return { handled: true, message, messages, ...extra };
}

function normalizedWorkspacePath(value) {
  if (typeof value !== 'string' || value.length > MAX_WORKSPACE_PATH_LENGTH
    || !isAbsolute(value) || UNSAFE_DISPLAY_TEXT.test(value)) return null;
  return resolve(value);
}

function safeDisplayText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_DISPLAY_TEXT_GLOBAL, ' ').replace(/\s+/gu, ' ').trim();
}

function validSessionId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SESSION_ID_LENGTH
    && !/\p{White_Space}/u.test(value)
    && !UNSAFE_DISPLAY_TEXT.test(value);
}

export function parseSessionListArgument(value) {
  const argument = typeof value === 'string' ? value.trim() : '';
  if (!argument) return { selector: '', limit: null };
  const tokens = argument.split(/[ \t]+/u);
  const head = tokens[0].toLowerCase();
  // Anything that does not start with a flag stays a workspace selector; only
  // the flags below are parsed, so a path can never be mistaken for one. An
  // unknown flag is a usage error instead of being echoed as a bad path.
  const flags = new Set([SESSION_LIST_ALL_FLAG, SESSION_LIST_LIMIT_FLAG, SESSION_LIST_ARCHIVED_FLAG]);
  if (!flags.has(head)) {
    return head.startsWith('--')
      ? { error: t(SESSION_LIST_USAGE) }
      : { selector: argument, limit: null };
  }
  let all = false;
  let archived = false;
  let limit = null;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index].toLowerCase();
    if (token === SESSION_LIST_ALL_FLAG && !all) {
      all = true;
      index += 1;
      continue;
    }
    if (token === SESSION_LIST_ARCHIVED_FLAG && !archived) {
      archived = true;
      index += 1;
      continue;
    }
    const raw = token === SESSION_LIST_LIMIT_FLAG ? tokens[index + 1] : undefined;
    const parsed = typeof raw === 'string' && /^\d+$/u.test(raw) ? Number(raw) : null;
    if (limit !== null || parsed === null
      || !Number.isSafeInteger(parsed) || parsed < 1) {
      return { error: t(SESSION_LIST_USAGE) };
    }
    limit = parsed;
    index += 2;
  }
  // Optional flags are only present when they were asked for, so the shape of a
  // plain `--limit N` (or bare) result stays what earlier callers compare to.
  const result = { selector: '', limit };
  if (all) result.all = true;
  if (archived) result.archived = true;
  return result;
}

async function existingWorkspacePath(value) {
  const workspace = normalizedWorkspacePath(value);
  if (!workspace) return null;
  try {
    if (!(await stat(workspace)).isDirectory()) return null;
    return normalizedWorkspacePath(await realpath(workspace));
  } catch {
    return null;
  }
}

async function existingWorkspacePaths(values) {
  const checked = await Promise.all(values.map(existingWorkspacePath));
  return [...new Set(checked.filter(Boolean))];
}

async function selectedWorkspacePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value.trim())) {
    return { error: t(`工作区必须是绝对路径。
{usage}`, { usage: t(SESSION_LIST_USAGE) }) };
  }
  const workspace = normalizedWorkspacePath(value.trim());
  if (!workspace) {
    return { error: t(`工作区路径包含不支持的字符或长度超过限制。
{usage}`, { usage: t(SESSION_LIST_USAGE) }) };
  }
  let info;
  try {
    info = await stat(workspace);
  } catch {
    return { error: t(`工作区路径不存在。
{usage}`, { usage: t(SESSION_LIST_USAGE) }) };
  }
  if (!info.isDirectory()) {
    return { error: t(`工作区路径必须指向一个目录。
{usage}`, { usage: t(SESSION_LIST_USAGE) }) };
  }
  try {
    const canonical = normalizedWorkspacePath(await realpath(workspace));
    return canonical
      ? { workspace: canonical }
      : { error: t(`工作区路径包含不支持的字符或长度超过限制。
{usage}`, { usage: t(SESSION_LIST_USAGE) }) };
  } catch {
    return { error: t(`工作区路径不存在。
{usage}`, { usage: t(SESSION_LIST_USAGE) }) };
  }
}

export async function workspacePathSnapshot(harness, { includeTitles = false, includeConversationDirectories = false, conversationKey, ...options } = {}) {
  const withEntries = includeTitles && typeof harness.listWorkspaceEntries === 'function';
  const listed = await (withEntries ? harness.listWorkspaceEntries(options) : harness.listWorkspaces(options));
  const currentValue = await conversationSessionWorkspace(harness, conversationKey, options);
  let current = await existingWorkspacePath(currentValue);
  if (!current && typeof conversationKey === 'string' && conversationKey
    && typeof harness?.currentWorkspace === 'function') {
    // A conversation override can outlive its directory. /sessionlist falls
    // back to the bot workspace in that case; keep this snapshot consistent.
    current = await existingWorkspacePath(harness.currentWorkspace());
  }
  const entries = await Promise.all((Array.isArray(listed) ? listed : []).map(async (item) => ({
    path: await existingWorkspacePath(withEntries ? item?.path : item),
    title: withEntries ? safeDisplayText(item?.title) : '',
  })));
  const directoryPaths = new Set(harness.conversationDirectoryPaths?.() ?? []);
  const paths = [...new Set([...(current ? [current] : []), ...entries.map((item) => item.path).filter(Boolean)])]
    .filter((path) => includeConversationDirectories || path === current || !directoryPaths.has(path));
  const titles = {};
  if (includeTitles) {
    for (const item of entries) {
      if (item.path && item.title && !titles[item.path]) titles[item.path] = item.title;
    }
  }
  harness.assertWorkspaceScope?.();
  return { current: current ?? null, paths, ...(includeTitles ? { titles } : {}) };
}

export function splitWorkspaceCommandMessage(message) {
  const messages = [];
  let offset = 0;
  while (offset < message.length) {
    let end = Math.min(offset + MAX_COMMAND_MESSAGE_LENGTH, message.length);
    if (end < message.length) {
      const lineBreak = message.lastIndexOf('\n', end - 1);
      if (lineBreak >= offset) {
        end = lineBreak + 1;
      } else {
        const trailing = message.charCodeAt(end - 1);
        const leading = message.charCodeAt(end);
        if (trailing >= 0xd800 && trailing <= 0xdbff
          && leading >= 0xdc00 && leading <= 0xdfff) end -= 1;
      }
    }
    messages.push(message.slice(offset, end));
    offset = end;
  }
  return messages;
}

/**
 * The shared listing behind /ws, /workspace, /wsl, /workspaces and
 * /workspacelist. Text stays byte-compatible with the pre-merge list so a
 * channel without an interactive picker keeps exactly what it always showed;
 * `listing` is the machine-readable half a channel may render as a picker.
 */
async function workspaceListingCommand(harness, { includeConversationDirectories = false } = {}) {
  if (typeof harness?.listWorkspaces !== 'function') {
    return commandResult(t('当前机器人暂不支持列出工作区。'));
  }
  try {
    const { current, paths, titles } = await workspacePathSnapshot(harness, {
      includeTitles: true, includeConversationDirectories,
    });
    if (paths.length === 0) {
      return commandResult(t('当前 Harness Host 上没有仍然存在的已登记工作区。'));
    }
    const lines = [
      t('当前 Harness Host 上存在的工作区（{count}）：', { count: paths.length }),
      ...paths.map((workspace, index) => (
        `${index + 1}. ${workspace}${workspace === current ? t('（当前）') : ''}`
      )),
      '',
      t('切换用法：/workspace 工作区序号或绝对路径'),
      t('对话专属：/conv 工作区序号或绝对路径（仅影响当前对话）'),
      t('查看会话：/sessionlist 工作区序号或绝对路径'),
      t('不带工作区参数时，/sessionlist 默认列出当前对话的有效工作区。'),
    ];
    const message = lines.join('\n');
    return commandResult(message, splitWorkspaceCommandMessage(message), {
      listing: { current: current ?? null, paths, titles: titles ?? {} },
    });
  } catch (error) {
    if (error?.code === 'workspace-bot-not-found') {
      return commandResult(t('机器人正在移除或已重新接入，无法列出原会话的工作区。'));
    }
    return commandResult(t('暂时无法获取工作区列表，请稍后重试。'));
  }
}

async function runWorkspaceListCommand(match, harness) {
  const includeConversationDirectories = match[1]?.trim().toLowerCase() === 'all';
  if (match[1]?.trim() && !includeConversationDirectories) return commandResult(t('用法：/workspacelist'));
  return workspaceListingCommand(harness, { includeConversationDirectories });
}

export async function conversationSessionWorkspace(harness, conversationKey, options = {}) {
  if (typeof conversationKey === 'string' && conversationKey) {
    if (typeof harness?.resolveConversationWorkspace === 'function') {
      return harness.resolveConversationWorkspace(conversationKey, options);
    }
    if (typeof harness?.currentConversationWorkspace === 'function') {
      return harness.currentConversationWorkspace(conversationKey);
    }
  }
  return harness?.currentWorkspace?.() ?? null;
}

async function conversationEffectiveWorkspace(harness, conversationKey, options) {
  if (typeof conversationKey !== 'string' || !conversationKey) return null;
  const [current] = await existingWorkspacePaths([await conversationSessionWorkspace(harness, conversationKey, options)]);
  harness.assertWorkspaceScope?.();
  return current ?? null;
}

export async function resolveSessionListWorkspace(selector, harness, options = {}) {
  if (!selector) {
    // With no explicit selector the listing follows the conversation's effective
    // workspace, so /conv B makes /sessionlist list B instead of the bot default.
    if (options.conversationKey) {
      const effective = await conversationEffectiveWorkspace(harness, options.conversationKey, options);
      if (effective) return { workspace: effective };
    }
    if (typeof harness?.currentWorkspace !== 'function') {
      return { error: t('当前机器人没有可用的工作区。') };
    }
    const selected = await selectedWorkspacePath(harness.currentWorkspace());
    harness.assertWorkspaceScope?.();
    return selected;
  }

  if (/^\d+$/u.test(selector)) {
    if (typeof harness?.listWorkspaces !== 'function') {
      return { error: t('当前机器人暂不支持按序号选择工作区。') };
    }
    // Explicit workspace numbers must keep the bot-wide /workspacelist order;
    // only a missing selector follows the bound conversation's actual group.
    const { paths } = await workspacePathSnapshot(harness, { ...options, conversationKey: undefined });
    const position = Number(selector);
    if (!Number.isSafeInteger(position) || position < 1 || position > paths.length) {
      return { error: t('工作区序号不存在，请先执行 /workspacelist。') };
    }
    return { workspace: paths[position - 1] };
  }

  const selected = await selectedWorkspacePath(selector);
  harness.assertWorkspaceScope?.();
  return selected;
}

function formatSessionRelativeTime(value) {
  const ms = typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (ms === null) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) return t('今天 {time}', { time: hm });
  if (dayDiff === 1) return t('昨天 {time}', { time: hm });
  if (dayDiff === 2) return t('前天 {time}', { time: hm });
  if (date.getFullYear() === now.getFullYear()) {
    return t('{month}月{day}日 {time}', { month: date.getMonth() + 1, day: date.getDate(), time: hm });
  }
  return t('{year}年{month}月{day}日', { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

/**
 * One numbered row. `boundSessionId` marks the Session this conversation is
 * already bound to, so a reader can tell where they are instead of looking up
 * the ID by hand.
 */
// Archived Sessions are listed only on request: the default answer should be
// the set a user can bind by index, not the whole history of the Workspace.
function splitArchived(sessions) {
  const live = [];
  const archived = [];
  for (const session of sessions) {
    (session?.archived === true ? archived : live).push(session);
  }
  return { live, archived };
}

function sessionRowText(session, boundSessionId) {
  const sessionId = safeDisplayText(session?.sessionId);
  if (!sessionId) throw new TypeError('Harness returned an invalid session id');
  const title = session?.summaryAvailable === false
    ? t('标题暂不可用')
    : safeDisplayText(session?.title) || t('暂无标题');
  const timeText = formatSessionRelativeTime(session?.time);
  const annotation = `${timeText ? ` · ${timeText}` : ''}`
    + `${session?.archived === true ? t('（已归档）') : ''}`
    + `${boundSessionId && sessionId === boundSessionId ? t('（当前绑定）') : ''}`;
  return `${title}${annotation}\n   ID: ${sessionId}`;
}

function sessionListRow(session, index, boundSessionId) {
  return `${index}. ${sessionRowText(session, boundSessionId)}`;
}

/**
 * Rows for one Workspace. Only the live (non-archived) Sessions get numbers,
 * and those numbers are the same order `/session N` resolves against, so the
 * list and the index always agree. Archived rows are unnumbered extras.
 */
function sessionRows(sessions, boundSessionId, { includeArchived = false } = {}) {
  const { live, archived } = splitArchived(sessions);
  const rows = [];
  let invalid = 0;
  for (const [index, session] of live.entries()) {
    try {
      rows.push(sessionListRow(session, index + 1, boundSessionId));
    } catch {
      invalid += 1;
    }
  }
  const extra = [];
  if (includeArchived) {
    for (const session of archived) {
      try {
        extra.push(`• ${sessionRowText(session, boundSessionId)}`);
      } catch {
        invalid += 1;
      }
    }
  }
  return { rows, extra, archivedCount: archived.length, invalid };
}

function sessionListMessage(
  workspace,
  { rows, extra, archivedCount, invalid },
  { currentWorkspace = false, includeArchived = false } = {},
) {
  const notes = [];
  if (invalid > 0) notes.push(t(SESSION_LIST_GROUP_INVALID, { count: invalid }));
  if (!includeArchived && archivedCount > 0) {
    notes.push(t(SESSION_LIST_ARCHIVED_HIDDEN, { count: archivedCount }));
  }
  if (rows.length === 0 && extra.length === 0) {
    const head = t('工作区：{workspace}', { workspace });
    return notes.length
      ? [head, ...notes].join('\n')
      : t(`工作区：{workspace}
该工作区暂无会话。`, { workspace });
  }
  return [
    t('工作区：{workspace}', { workspace }),
    t('会话（{count}）：', { count: rows.length }),
    '',
    ...rows,
    ...(extra.length > 0 ? ['', t(SESSION_LIST_ARCHIVED_HEADER), ...extra] : []),
    ...(notes.length > 0 ? ['', ...notes] : []),
    '',
    currentWorkspace
      ? t('绑定用法：/session Session ID 或当前工作区序号（/session N）')
      : t(`绑定用法：/session Session ID
提示：/session N 只按机器人当前工作区的序号绑定。`),
  ].join('\n');
}

async function currentSessionListWorkspace(harness, conversationKey) {
  const effective = await conversationEffectiveWorkspace(harness, conversationKey);
  if (effective) return effective;
  if (typeof harness?.currentWorkspace !== 'function') return null;
  const [current] = await existingWorkspacePaths([harness.currentWorkspace()]);
  harness.assertWorkspaceScope?.();
  return current ?? null;
}

// Read-only decoration: a stale bot scope must degrade to "no marker" instead of
// failing a listing that is otherwise complete.
export function boundSessionIdFor(source, conversationKey) {
  if (typeof source?.sessionFor !== 'function') return '';
  if (typeof conversationKey !== 'string' || !conversationKey) return '';
  try {
    const sessionId = safeDisplayText(source.sessionFor(conversationKey));
    return validSessionId(sessionId) ? sessionId : '';
  } catch {
    return '';
  }
}

function workspaceGroupLabel(path, titles) {
  const title = safeDisplayText(titles?.[path]);
  return title ? `${title} — ${path}` : path;
}

async function listWorkspaceSessionsOrNull(harness, workspace) {
  try {
    const listed = await harness.listWorkspaceSessions(workspace);
    if (!listed || !Array.isArray(listed.sessions)) {
      throw new TypeError('Harness returned an invalid workspace session list');
    }
    return listed.sessions;
  } catch (error) {
    if (error?.code === 'workspace-bot-not-found') throw error;
    return null;
  }
}

/**
 * `/sessionlist --all`: every registered Workspace in one answer. A Workspace
 * whose session list cannot be read is left out rather than failing the whole
 * command, so one broken Workspace never hides the others.
 */
async function allWorkspacesSessionListing(harness, limit, conversationKey, { includeArchived = false } = {}) {
  if (typeof harness?.listWorkspaces !== 'function'
    && typeof harness?.listWorkspaceEntries !== 'function') {
    return commandResult(t('当前机器人暂不支持跨工作区列出会话。'));
  }
  const { current, paths, titles } = await workspacePathSnapshot(harness, {
    includeTitles: true,
    conversationKey,
  });
  if (paths.length === 0) {
    return commandResult(t('当前 Harness Host 上没有仍然存在的已登记工作区。'));
  }
  const boundSessionId = boundSessionIdFor(harness, conversationKey);
  const shownLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : ALL_WORKSPACES_DEFAULT_LIMIT;
  const groups = [];
  let failed = 0;
  for (const workspace of paths) {
    const sessions = await listWorkspaceSessionsOrNull(harness, workspace);
    if (sessions === null) {
      failed += 1;
      continue;
    }
    groups.push({ workspace, sessions });
  }
  harness.assertWorkspaceScope?.();
  if (groups.length === 0) {
    return commandResult(t('暂时无法获取工作区会话列表，请稍后重试。'));
  }
  // Rows are built once per group and every count below derives from them, so a
  // group's total, its truncation note and its invalid-record note always agree.
  const prepared = groups.map((group) => ({
    ...group,
    ...sessionRows(group.sessions, boundSessionId, { includeArchived }),
  }));
  const total = prepared.reduce((sum, group) => sum + group.rows.length, 0);
  const lines = [t(SESSION_LIST_ALL_HEADER, { workspaces: prepared.length, sessions: total })];
  if (current) lines.push(t(SESSION_LIST_ALL_CURRENT, { workspace: current }));
  if (failed > 0) lines.push(t(SESSION_LIST_ALL_SKIPPED, { count: failed }));
  lines.push(t(`绑定用法：/session Session ID
提示：/session N 只按机器人当前工作区的序号绑定。`));
  for (const group of prepared) {
    const label = workspaceGroupLabel(group.workspace, titles);
    lines.push('', t(SESSION_LIST_GROUP_HEADER, {
      workspace: `${label}${group.workspace === current ? t('（当前）') : ''}`,
      count: group.rows.length,
    }));
    const shown = group.rows.slice(0, shownLimit);
    lines.push(...shown);
    if (group.extra.length > 0) {
      lines.push('', t(SESSION_LIST_ARCHIVED_HEADER), ...group.extra);
    }
    if (group.invalid > 0) {
      lines.push(t(SESSION_LIST_GROUP_INVALID, { count: group.invalid }));
    } else if (group.rows.length === 0 && group.extra.length === 0) {
      lines.push(t(SESSION_LIST_GROUP_EMPTY));
    }
    if (!includeArchived && group.archivedCount > 0) {
      lines.push(t(SESSION_LIST_ARCHIVED_HIDDEN, { count: group.archivedCount }));
    }
    if (shown.length < group.rows.length) {
      lines.push(t(SESSION_LIST_GROUP_TRUNCATED, {
        total: group.rows.length,
        shown: shown.length,
      }));
    }
  }
  const message = lines.join('\n');
  return commandResult(message, splitWorkspaceCommandMessage(message));
}

async function runSessionListCommand(match, harness, conversationKey) {
  const request = parseSessionListArgument(match[1]);
  if (request.error) return commandResult(request.error);
  if (typeof harness?.listWorkspaceSessions !== 'function') {
    return commandResult(t('当前机器人暂不支持列出工作区会话。'));
  }
  try {
    if (request.all) {
      return await allWorkspacesSessionListing(harness, request.limit, conversationKey, {
        includeArchived: request.archived === true,
      });
    }
    const resolved = await resolveSessionListWorkspace(request.selector, harness, { conversationKey });
    if (resolved.error) return commandResult(resolved.error);
    const listed = await harness.listWorkspaceSessions(resolved.workspace);
    if (!listed || !Array.isArray(listed.sessions)) {
      throw new TypeError('Harness returned an invalid workspace session list');
    }
    harness.assertWorkspaceScope?.();
    const workspace = normalizedWorkspacePath(listed.workspace) ?? resolved.workspace;
    const currentWorkspace = await currentSessionListWorkspace(harness, conversationKey);
    // Rows are numbered over the live Sessions (the order `/session N` binds
    // against); --limit only truncates what is shown, so a displayed number is
    // always the number that binding uses.
    const includeArchived = request.archived === true;
    const listing = sessionRows(listed.sessions, boundSessionIdFor(harness, conversationKey), {
      includeArchived,
    });
    const rows = request.limit === null ? listing.rows : listing.rows.slice(0, request.limit);
    const message = sessionListMessage(workspace, { ...listing, rows }, {
      currentWorkspace: workspace === currentWorkspace,
      includeArchived,
    });
    return commandResult(message, splitWorkspaceCommandMessage(message));
  } catch (error) {
    if (error?.code === 'workspace-bot-not-found') {
      return commandResult(t('机器人正在移除或已重新接入，无法列出原会话的工作区会话。'));
    }
    return commandResult(t('暂时无法获取工作区会话列表，请稍后重试。'));
  }
}

function sessionBindErrorMessage(error) {
  if (error?.code === 'session-id-invalid') {
    return t(`Session ID 格式无效。
{usage}`, { usage: t(SESSION_BIND_USAGE) });
  }
  if (error?.code === 'session-not-registered' || isSessionNotFound(error?.code)) {
    return t('未找到该会话，请先执行 /sessionlist 确认 Session ID。');
  }
  if (error?.code === 'session-subagent-unsupported') {
    return t('子代理会话不能绑定到机器人对话，请选择普通会话。');
  }
  if (error?.code === 'session-workspace-ambiguous') {
    return t('该会话的工作区归属不明确，暂时无法绑定。');
  }
  if (error?.code === 'session-summary-unavailable') {
    return t('暂时无法读取该会话的信息，请稍后重试。');
  }
  if (error?.code === 'workspace-bot-not-found') {
    return t('机器人正在移除或已重新接入，无法绑定原对话的会话。');
  }
  if ([WORKSPACE_SESSION_STALE, 'agent-busy', 'session-conflict', 'workspace-conflict']
    .includes(error?.code)) {
    return t('工作区或会话状态已发生变化，请重试。');
  }
  return t('暂时无法绑定会话，请稍后重试。');
}

// A single token that is neither an index nor an explicit Session ID is a
// title keyword. Anything with control characters or an absurd length is not a
// query at all, so it keeps failing as a malformed /session argument.
function sessionTitleQuery(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SESSION_TITLE_QUERY_LENGTH
    && validSessionId(value)
    && !SESSION_ID_PREFIX.test(value);
}

/**
 * Title search across Workspaces. `workspacePathSnapshot` puts the
 * conversation's effective Workspace first, so a local hit is visited before a
 * same-named Session elsewhere and can be preferred by the caller. One
 * unreadable Workspace is counted and skipped; a stale bot scope aborts.
 *
 * Archived Sessions are never bound by a keyword: a keyword is a guess, and
 * moving an archived Session into this chat's Workspace is exactly the kind of
 * side effect a guess must not have. They are collected separately so the
 * answer can name them instead of pretending nothing matched.
 */
async function sessionTitleMatches(harness, conversationKey, keyword) {
  const { current, paths, titles } = await workspacePathSnapshot(harness, {
    includeTitles: true,
    conversationKey,
  });
  const needle = keyword.toLowerCase();
  const matches = [];
  const archivedMatches = [];
  let archivedExactSessionId = null;
  let exactSessionId = null;
  let failed = 0;
  for (const workspace of paths) {
    const sessions = await listWorkspaceSessionsOrNull(harness, workspace);
    if (sessions === null) {
      failed += 1;
      continue;
    }
    for (const session of sessions) {
      const sessionId = session?.sessionId;
      if (!validSessionId(sessionId)) continue;
      const archived = session?.archived === true;
      // An ID remains an exact match even when its title is empty or does not
      // contain the ID. Keep looking after the title candidate cap as well.
      if (sessionId === keyword) {
        if (archived) archivedExactSessionId = sessionId;
        else exactSessionId = sessionId;
      }
      const title = safeDisplayText(session?.title);
      if (!title) continue;
      if (!title.toLowerCase().includes(needle)) continue;
      const candidate = {
        sessionId,
        title,
        workspace,
        workspaceLabel: workspaceGroupLabel(workspace, titles),
      };
      if (archived) {
        if (archivedMatches.length <= MAX_SESSION_TITLE_MATCHES) archivedMatches.push(candidate);
      } else if (matches.length <= MAX_SESSION_TITLE_MATCHES) {
        matches.push(candidate);
      }
    }
  }
  harness.assertWorkspaceScope?.();
  return { current, matches, archivedMatches, archivedExactSessionId, failed, exactSessionId };
}

function sessionTitleCandidatesMessage(keyword, matches, header = SESSION_TITLE_AMBIGUOUS) {
  const shown = matches.slice(0, MAX_SESSION_TITLE_MATCHES);
  const lines = [t(header, { keyword }), ''];
  for (const [index, match] of shown.entries()) {
    lines.push(
      `${index + 1}. ${match.title}`,
      t('工作区：{workspace}', { workspace: match.workspaceLabel }),
      `   ID: ${match.sessionId}`,
    );
  }
  lines.push('');
  if (matches.length > shown.length) {
    lines.push(t(SESSION_TITLE_AMBIGUOUS_TRUNCATED, { count: shown.length }));
  }
  lines.push(t(SESSION_BIND_USAGE));
  return lines.join('\n');
}

async function runSessionBindCommand(command, harness, conversationKey) {
  const match = SESSION_BIND_COMMAND.exec(command);
  let sessionId = match?.[1];
  if (typeof sessionId === 'string'
    && (sessionId.length > MAX_SESSION_ID_LENGTH || UNSAFE_DISPLAY_TEXT.test(sessionId))) {
    return commandResult(t(SESSION_BIND_USAGE));
  }
  let titleQuery = false;
  let titleSearchIncomplete = false;
  let titleBindingWorkspace = null;
  let titleBinding = null;
  if (typeof sessionId === 'string' && /^\d+$/u.test(sessionId)) {
    // Use the same effective-workspace resolver as /sessionlist, so its indexes
    // cannot select a session from the bot default after /conv sets an override.
    if (typeof harness?.listWorkspaceSessions !== 'function'
      || (typeof harness?.currentWorkspace !== 'function'
        && typeof harness?.currentConversationWorkspace !== 'function')) {
      return commandResult(t('当前机器人暂不支持按序号绑定，请使用 /session Session ID。'));
    }
    try {
      const selected = await resolveSessionListWorkspace('', harness, { conversationKey });
      if (selected.error) return commandResult(selected.error);
      const listed = await harness.listWorkspaceSessions(selected.workspace);
      if (!listed || !Array.isArray(listed.sessions)) {
        throw new TypeError('Harness returned an invalid workspace session list');
      }
      harness.assertWorkspaceScope?.();
      // Same rule as the listing: an index addresses the live (non-archived)
      // Sessions it numbers, so an archived Session is only reachable by ID.
      const { live } = splitArchived(listed.sessions);
      const position = Number(sessionId);
      if (!Number.isSafeInteger(position) || position < 1
        || position > live.length) {
        return commandResult(t('会话序号不存在，请先执行 /sessionlist 查看序号。'));
      }
      const selectedSessionId = live[position - 1]?.sessionId;
      if (!validSessionId(selectedSessionId)) {
        throw new TypeError('Harness returned an invalid session id');
      }
      sessionId = selectedSessionId;
    } catch (error) {
      if (error?.code === 'workspace-bot-not-found') {
        return commandResult(sessionBindErrorMessage(error));
      }
      return commandResult(t('暂时无法获取会话列表，请稍后重试。'));
    }
  } else if (sessionTitleQuery(sessionId)
    && typeof harness?.listWorkspaceSessions === 'function'
    && (typeof harness?.listWorkspaces === 'function'
      || typeof harness?.listWorkspaceEntries === 'function')) {
    titleQuery = true;
    try {
      const {
        current, matches, archivedMatches, archivedExactSessionId, failed, exactSessionId,
      } = await sessionTitleMatches(harness, conversationKey, sessionId);
      titleSearchIncomplete = failed > 0;
      const [unique] = matches;
      if (exactSessionId) {
        sessionId = exactSessionId;
        titleQuery = false;
      } else if (matches.length === 0 && archivedMatches.length > 0 && !archivedExactSessionId) {
        // Only archived Sessions matched: name them instead of binding, and let
        // the reader decide whether to bind one by its full ID.
        const message = sessionTitleCandidatesMessage(
          sessionId,
          archivedMatches,
          SESSION_TITLE_ARCHIVED,
        );
        return commandResult(message, splitWorkspaceCommandMessage(message));
      } else if (matches.length > 1) {
        const message = sessionTitleCandidatesMessage(
          sessionId,
          matches,
          failed > 0 ? SESSION_TITLE_SEARCH_INCOMPLETE : SESSION_TITLE_AMBIGUOUS,
        );
        return commandResult(message, splitWorkspaceCommandMessage(message));
      } else if (matches.length === 1) {
        // Only the current conversation's Workspace may be adopted by title.
        // Pass that constraint to the binding transaction so it preserves the
        // bot default and rejects a Workspace change during the search.
        if (failed === 0 && current && unique.workspace === current) {
          sessionId = unique.sessionId;
          titleQuery = false;
          titleBindingWorkspace = current;
          titleBinding = unique;
        } else {
          const message = sessionTitleCandidatesMessage(
            sessionId,
            matches,
            failed > 0 ? SESSION_TITLE_SEARCH_INCOMPLETE : SESSION_TITLE_REMOTE,
          );
          return commandResult(message, splitWorkspaceCommandMessage(message));
        }
      }
      // Zero matches: fall through to the legacy "treat the token as a Session
      // ID" path, so an ID that simply has no title match still binds.
    } catch (error) {
      if (error?.code === 'workspace-bot-not-found') {
        return commandResult(sessionBindErrorMessage(error));
      }
      titleQuery = false;
      titleSearchIncomplete = false;
    }
  }
  if (!validSessionId(sessionId)) return commandResult(t(SESSION_BIND_USAGE));
  if (typeof harness?.bindWorkspaceSession !== 'function') {
    return commandResult(t('当前机器人暂不支持绑定已有会话。'));
  }
  if (typeof conversationKey !== 'string' || !conversationKey) {
    return commandResult(t('当前消息缺少可绑定的会话上下文。'));
  }
  try {
    const bound = titleBindingWorkspace
      ? await harness.bindWorkspaceSession(conversationKey, sessionId, { expectedWorkspace: titleBindingWorkspace })
      : await harness.bindWorkspaceSession(conversationKey, sessionId);
    harness.assertWorkspaceScope?.();
    const workspace = normalizedWorkspacePath(bound?.workspace);
    const boundSessionId = safeDisplayText(bound?.sessionId);
    if (!workspace || !boundSessionId) {
      throw new TypeError('Harness returned an invalid bound session');
    }
    const title = safeDisplayText(bound?.title) || t('暂无标题');
    const message = [
      t('当前聊天已绑定会话：'),
      t('工作区：{workspace}', { workspace }),
      t('标题：{title}', { title }),
      `ID：${boundSessionId}`,
      t('归档：{archived}', { archived: bound?.archived === true ? t('是') : t('否') }),
      t('发送 /history 查看最近对话。'),
    ].join('\n');
    return commandResult(message, splitWorkspaceCommandMessage(message));
  } catch (error) {
    // A keyword that did resolve to one Session must not answer with the
    // generic "cannot read this Session" line: name the match it tried, so the
    // reader can retry with its ID instead of guessing which keyword failed.
    if (titleBinding && (error?.code === 'session-summary-unavailable'
      || error?.code === 'session-id-invalid'
      || error?.code === 'session-not-registered'
      || error?.code === 'session-subagent-unsupported'
      || isSessionNotFound(error?.code))) {
      return commandResult(t(SESSION_TITLE_BIND_FAILED, {
        title: titleBinding.title,
        sessionId: titleBinding.sessionId,
        workspace: titleBinding.workspaceLabel,
      }));
    }
    if (titleQuery && (error?.code === 'session-id-invalid'
      || error?.code === 'session-not-registered'
      || isSessionNotFound(error?.code))) {
      return commandResult(t(
        titleSearchIncomplete ? SESSION_TITLE_SEARCH_INCOMPLETE_MISS : SESSION_TITLE_MISS,
        { keyword: sessionId },
      ));
    }
    return commandResult(sessionBindErrorMessage(error));
  }
}

/**
 * `/sessionarchive <Session ID | 序号>`: asks the Harness to archive one Session.
 * The bot never archives on its own: it resolves the target, refuses the two
 * cases that would leave this chat in a broken state, and reports what the Host
 * said.
 */
async function runSessionArchiveCommand(command, harness, conversationKey) {
  const match = SESSION_ARCHIVE_COMMAND.exec(command);
  const target = match?.[1];
  const stopActivity = Boolean(match?.[2]);
  if (!validSessionId(target)) return commandResult(t(SESSION_ARCHIVE_USAGE));
  if (typeof harness?.archiveWorkspaceSession !== 'function'
    || typeof harness?.listWorkspaceSessions !== 'function') {
    return commandResult(t('当前机器人暂不支持归档会话。'));
  }
  try {
    const boundSessionId = boundSessionIdFor(harness, conversationKey);
    let sessionId = target;
    let title = '';
    let archived = false;

    if (/^\d+$/u.test(target)) {
      const resolved = await resolveSessionListWorkspace('', harness, { conversationKey });
      if (resolved.error) return commandResult(resolved.error);
      const listed = await harness.listWorkspaceSessions(resolved.workspace);
      if (!listed || !Array.isArray(listed.sessions)) {
        throw new TypeError('Harness returned an invalid workspace session list');
      }
      const { live } = splitArchived(listed.sessions);
      const position = Number(target);
      if (!Number.isSafeInteger(position) || position < 1 || position > live.length) {
        return commandResult(t('会话序号不存在，请先执行 /sessionlist 查看序号。'));
      }
      const picked = live[position - 1];
      const pickedId = picked?.sessionId;
      if (!validSessionId(pickedId)) {
        throw new TypeError('Harness returned an invalid session id');
      }
      harness.assertWorkspaceScope?.();
      const preview = [
        t(SESSION_ARCHIVE_PREVIEW, { index: target }),
        t('标题：{title}', { title: safeDisplayText(picked?.title) || t('暂无标题') }),
        t('工作区：{workspace}', { workspace: resolved.workspace }),
        `ID：${pickedId}`,
        t(SESSION_ARCHIVE_PREVIEW_HINT, { sessionId: pickedId }),
      ].join('\n');
      return commandResult(preview, splitWorkspaceCommandMessage(preview));
    } else {
      // Best-effort lookup for a receipt title and the already-archived check;
      // an id no listing shows is still handed to the Host.
      const { paths } = await workspacePathSnapshot(harness, { includeTitles: true });
      for (const workspace of paths) {
        const sessions = await listWorkspaceSessionsOrNull(harness, workspace);
        if (!sessions) continue;
        const found = sessions.find((session) => session?.sessionId === sessionId);
        if (!found) continue;
        title = safeDisplayText(found.title);
        archived = found.archived === true;
        break;
      }
    }

    harness.assertWorkspaceScope?.();
    if (archived) return commandResult(t('该会话已经归档。'));
    if (boundSessionId && boundSessionId === sessionId) {
      return commandResult(t('这是本对话当前绑定的会话，请先 /new 或绑定其他会话，再归档它。'));
    }

    await harness.archiveWorkspaceSession(sessionId, { stopActivity });
    harness.assertWorkspaceScope?.();
    const message = [
      t('已归档会话：'),
      t('标题：{title}', { title: title || t('暂无标题') }),
      `ID：${sessionId}`,
    ].join('\n');
    return commandResult(message, splitWorkspaceCommandMessage(message));
  } catch (error) {
    if (error?.code === 'workspace-bot-not-found') {
      return commandResult(t('机器人正在移除或已重新接入，无法归档原会话的会话。'));
    }
    if (error?.code === 'harness-api-not-found') {
      return commandResult(t('当前 DSH 版本不支持通过机器人归档会话。'));
    }
    if (['agent-busy', 'turn-blocked', 'session-archived'].includes(error?.code)) {
      return commandResult(t('该会话仍有任务在运行，请先 /stop，或使用 /sessionarchive <目标> --stop。'));
    }
    return commandResult(t('暂时无法归档该会话，请稍后重试。'));
  }
}

async function runConversationWorkspaceCommand(command, harness, conversationKey) {
  if (typeof harness?.currentConversationWorkspace !== 'function') {
    return commandResult(t('当前机器人暂不支持按对话设置专属工作区。'));
  }
  if (typeof conversationKey !== 'string' || !conversationKey) {
    return commandResult(t('当前消息缺少可设置的对话上下文。'));
  }
  const argument = THREAD_WORKSPACE_COMMAND.exec(command)?.[1]?.trim() ?? '';
  if (!argument) {
    try {
      const current = harness.currentConversationWorkspace(conversationKey);
      harness.assertWorkspaceScope?.();
      const lines = [t('当前对话工作区：{workspace}', { workspace: current })];
      // 明确区分「显式绑定」与「回落 bot 默认」，否则用户无法判断之后改默认值会不会影响本对话。
      const bound = typeof harness?.hasConversationWorkspaceOverride === 'function'
        && harness.hasConversationWorkspaceOverride(conversationKey) === true;
      lines.push(bound
        ? t('状态：已为该对话显式绑定，之后修改 bot 默认工作区不会影响本对话。')
        : t('状态：未显式绑定，当前跟随 bot 默认工作区。'));
      // 顺带列出可切换的工作区，省得先跑一次 /workspacelist 再回来切。
      try {
        const { paths } = await workspacePathSnapshot(harness);
        if (paths.length > 0) {
          lines.push('', t('可切换的工作区（{count}）：', { count: paths.length }));
          for (const [index, workspace] of paths.entries()) {
            lines.push(`${index + 1}. ${workspace}${workspace === current ? t('（当前）') : ''}`);
          }
        }
      } catch { /* 列表拿不到不影响主信息 */ }
      lines.push('', t('用法：/conv 工作区序号或绝对路径'), t('清除：/conv clear'));
      const message = lines.join('\n');
      return commandResult(message, splitWorkspaceCommandMessage(message));
    } catch (error) {
      if (error?.code === 'workspace-bot-not-found') {
        return commandResult(t('机器人正在移除或已重新接入，无法读取对话工作区。'));
      }
      return commandResult(t('暂时无法读取当前对话工作区，请稍后重试。'));
    }
  }
  if (/^(?:--default|clear)$/iu.test(argument)) {
    try {
      const current = await harness.clearConversationWorkspace(conversationKey);
      harness.assertWorkspaceScope?.();
      return commandResult(t('已清除对话专属工作区，当前使用 bot 默认工作区：{workspace}（之后默认工作区的变化会同步到本对话）', { workspace: current }));
    } catch (error) {
      if (error?.code === 'workspace-bot-not-found') {
        return commandResult(t('机器人正在移除或已重新接入，无法清除对话工作区。'));
      }
      return commandResult(t('暂时无法清除对话工作区，请稍后重试。'));
    }
  }
  if (typeof harness?.switchConversationWorkspace !== 'function') {
    return commandResult(t('当前机器人暂不支持设置对话工作区。'));
  }
  try {
    let selected = argument;
    if (/^\d+$/u.test(argument)) {
      // Match the ordering shown by /workspacelist, /ws and bare /conv.
      const { paths } = await workspacePathSnapshot(harness);
      const position = Number(argument);
      if (!Number.isSafeInteger(position) || position < 1 || position > paths.length) {
        return commandResult(t('工作区序号不存在，请先执行 /workspacelist。'));
      }
      selected = paths[position - 1];
    }
    const current = await harness.switchConversationWorkspace(conversationKey, selected);
    return commandResult(t('当前对话工作区已切换为：{workspace}', { workspace: current }));
  } catch (error) {
    if (['workspace-not-absolute', 'workspace-not-found', 'workspace-not-directory'].includes(error?.code)) {
      return commandResult(t(`{message}
用法：/conv 工作区绝对路径`, { message: error.message }));
    }
    if (error?.code === 'workspace-bot-not-found') {
      return commandResult(t('机器人正在移除或已重新接入，无法切换对话工作区。'));
    }
    throw error;
  }
}

/**
 * One failure mapping for every workspace-switch surface. The text command and
 * the Telegram picker card call the same switch, so their receipts must not
 * drift; returns null for errors this layer deliberately does not classify
 * (the caller decides whether to rethrow or degrade).
 */
export function workspaceSwitchFailureText(error) {
  if (['workspace-not-absolute', 'workspace-not-found', 'workspace-not-directory']
    .includes(error?.code)) {
    return t(`{message}
用法：/workspace 工作区序号或绝对路径`, { message: error.message });
  }
  if (error?.code === 'workspace-bot-not-found') {
    return t('机器人正在移除或已重新接入，无法切换原会话的工作区。');
  }
  return null;
}

export async function runWorkspaceCommand(text, harness, conversationKey) {
  if (!isWorkspaceCommand(text)) return null;
  const config = harness.conversationDirectoryConfig?.();
  if (config?.enabled === true && /^(?:\/(?:workspace|ws|conv|conversation|thread))(?:\s|$)/iu.test(text.trim())) {
    return { message: '', messages: [] };
  }
  const command = text.trim();
  const threadMatch = THREAD_WORKSPACE_COMMAND.exec(command);
  if (threadMatch) {
    return runConversationWorkspaceCommand(command, harness, conversationKey);
  }
  if (SESSION_ARCHIVE_PREFIX.test(command)) {
    return runSessionArchiveCommand(command, harness, conversationKey);
  }
  if (SESSION_BIND_PREFIX.test(command)) {
    return runSessionBindCommand(command, harness, conversationKey);
  }
  const sessionListMatch = SESSION_LIST_COMMAND.exec(command);
  if (sessionListMatch) return runSessionListCommand(sessionListMatch, harness, conversationKey);
  const listMatch = WORKSPACE_LIST_COMMAND.exec(command);
  if (listMatch) return runWorkspaceListCommand(listMatch, harness);
  const match = WORKSPACE_COMMAND.exec(command);
  if (!match) return null;
  const workspace = match[1]?.trim();
  // Merged command: no argument opens the same listing as /wsl, so a channel
  // with an inline keyboard can make the list itself the switcher.
  if (!workspace) return workspaceListingCommand(harness);
  if (typeof harness?.switchWorkspace !== 'function') {
    return commandResult(t('当前机器人暂不支持切换工作区。'));
  }
  try {
    let selected = workspace;
    if (/^\d+$/u.test(workspace)) {
      if (typeof harness?.listWorkspaces !== 'function') {
        return commandResult(t('当前机器人暂不支持按序号选择工作区。'));
      }
      const { paths } = await workspacePathSnapshot(harness);
      const position = Number(workspace);
      if (!Number.isSafeInteger(position) || position < 1 || position > paths.length) {
        return commandResult(t('工作区序号不存在，请先执行 /workspacelist。'));
      }
      selected = paths[position - 1];
    }
    const current = await harness.switchWorkspace(selected);
    return commandResult(t('工作区已切换为：{workspace}', { workspace: current }));
  } catch (error) {
    const failure = workspaceSwitchFailureText(error);
    if (failure) return commandResult(failure);
    throw error;
  }
}

export function isWorkspaceCommand(text) {
  if (typeof text !== 'string') return false;
  const command = text.trim();
  return SESSION_BIND_PREFIX.test(command)
    || SESSION_ARCHIVE_PREFIX.test(command)
    || SESSION_LIST_COMMAND.test(command)
    || WORKSPACE_LIST_COMMAND.test(command)
    || WORKSPACE_COMMAND.test(command)
    || THREAD_WORKSPACE_COMMAND.test(command);
}
