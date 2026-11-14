import { randomBytes } from 'node:crypto';
import { ApiError } from '@tencent-connect/qqbot-nodejs';
import { conversationSessionWorkspace, workspacePathSnapshot } from '../shared/workspace-command.mjs';
import { t } from '../shared/i18n.mjs';

export const QQ_MENU_TTL_MS = 15 * 60_000;
const PAGE_SIZE = 6;
const MAX_MENUS = 256;
const SECTIONS = new Set(['main', 'sessions', 'workspaces', 'presets', 'models', 'steer', 'custom', 'status', 'help']);
const clean = (value, limit = 160) => [...String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ')].slice(0, limit).join('');
const command = (label, text) => ({ label, action: { kind: 'command', text } });
const section = (label, name) => ({ label, action: { kind: 'section', name } });
const back = () => section(t('返回主菜单'), 'main');

export function isQqMenuCommand(text) {
  return typeof text === 'string' && /^\/(?:m|menu)(?=$|\s)/iu.test(text.trim());
}

export function parseQqMenuCommand(text) {
  const match = /^\/(?:m|menu)(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(\S+))?$/iu.exec(text.trim());
  if (!match) return { error: true };
  const name = match[1]?.toLowerCase() ?? 'main';
  if (SECTIONS.has(name) && !match[2]) return { name };
  if (name === 'pick' && /^[a-f0-9]{24}$/u.test(match[2] ?? '') && /^\d{1,2}$/u.test(match[3] ?? '')) {
    return { token: match[2], number: Number(match[3]) };
  }
  return { error: true };
}

// A menu belongs to its actor and route. The exact displayed actions, including
// paginated choices, stay in memory; clients only send an opaque token + index.
export class QqMenuStore {
  #entries = new Map();
  #now;
  constructor({ now = Date.now } = {}) { this.#now = now; }
  #key(route, actor) { return `${route}\0${actor}`; }
  has(route, actor) { return this.#entries.has(this.#key(route, actor)); }
  tokenFor(route, actor) { return this.#entries.get(this.#key(route, actor))?.token; }
  clear(route, actor) { this.#entries.delete(this.#key(route, actor)); }
  begin(route, actor, context) {
    const key = this.#key(route, actor);
    const entry = { ...context, token: randomBytes(12).toString('hex'),
      expiresAt: this.#now() + QQ_MENU_TTL_MS, used: false, view: null };
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    while (this.#entries.size > MAX_MENUS) this.#entries.delete(this.#entries.keys().next().value);
    return entry;
  }
  publish(route, actor, entry, view) {
    if (this.#entries.get(this.#key(route, actor)) !== entry) return false;
    entry.view = view;
    return true;
  }
  take(route, actor, number, token, context) {
    const entry = this.#entries.get(this.#key(route, actor));
    if (!entry || entry.used || !entry.view || entry.expiresAt <= this.#now()
      || (token && token !== entry.token)) return { error: t('这个菜单已过期，请回复 /m 重新打开。') };
    if (entry.workspace !== context.workspace || entry.sessionWorkspace !== context.sessionWorkspace
      || entry.sessionId !== context.sessionId) {
      entry.used = true;
      return { error: t('会话或工作区已变化，请重新发送 /m。') };
    }
    const choice = entry.view.entries[number - 1];
    if (!Number.isSafeInteger(number) || number < 1 || !choice) {
      return { error: t('菜单没有这个编号，回复 /m 重新打开。') };
    }
    // Claim before awaiting anything: retries cannot repeat a destructive action.
    entry.used = true;
    return { action: choice.action, context: entry };
  }
}

export function qqMenuPage(list, requestedPage = 0) {
  const pages = Math.max(1, Math.ceil(list.choices.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const entries = list.choices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  if (page > 0) entries.push({ label: t('上一页'), action: { kind: 'page', list, page: page - 1 } });
  if (page + 1 < pages) entries.push({ label: t('下一页'), action: { kind: 'page', list, page: page + 1 } });
  entries.push(back());
  return { title: list.title, detail: [list.detail, t('第 {page} / {pages} 页', { page: page + 1, pages }),
    list.choices.length ? '' : t('暂无可用选项。')].filter(Boolean).join('\n'), entries, columns: 2 };
}

async function catalogFor(harness, sessionId, key, options) {
  const session = sessionId ? harness.workspaceSession?.(sessionId, key) : null;
  return typeof session?.models === 'function' ? session.models(options) : harness.listModels(options);
}

export async function qqMenuView(name, harness, state, key, { signal, busy = false } = {}) {
  const workspace = harness.currentWorkspace?.();
  const sessionWorkspace = await conversationSessionWorkspace(harness, key, { signal });
  const sessionId = state.sessionFor(key);
  const options = { signal };
  const archived = state.includesArchivedSessions?.() === true;
  const visibleSessions = (listed) => (listed?.sessions ?? []).filter((item) => archived || item.archived !== true);
  if (name === 'main' || name === 'status') {
    if (name === 'status') await harness.ensureRunning(options);
    const results = await Promise.allSettled([
      harness.listWorkspaceSessions?.(sessionWorkspace, options),
      catalogFor(harness, sessionId, key, options),
      harness.agentPresetSettings?.(options),
    ]);
    signal?.throwIfAborted();
    const [listed, catalog, settings] = results.map((r) => r.status === 'fulfilled' ? r.value : null);
    const bound = listed?.sessions?.find((item) => item.sessionId === sessionId);
    const presetId = settings?.agentPreset ?? settings?.agentPresetCatalog?.defaultId;
    const preset = settings?.agentPresetCatalog?.items?.find((item) => item.id === presetId);
    const model = catalog?.groups?.find((group) => group.id === catalog.current?.provider)
      ?.models?.find((item) => item.id === catalog.current?.model);
    const detail = [
      name === 'status' ? t('QQ 机器人与 DeepSeek Harness 连接正常。') : '',
      t('工作区：{workspace}', { workspace: clean(workspace) || t('未设置') }),
      t('当前会话：{session}', { session: clean(bound?.title || sessionId) || t('新会话') }),
      t('模式／预设：{preset}', { preset: clean(preset?.label || presetId) || t('跟随 Host 默认') }),
      t('当前模型：{model}', { model: clean(model?.name || catalog?.current?.model) || t('暂不可用') }),
      t('归档会话：{state}', { state: archived ? t('显示') : t('隐藏') }),
      t('任务状态：{state}', { state: busy ? t('处理中') : t('空闲') }),
      results.some((r) => r.status === 'rejected') ? t('部分设置暂未加载，可进入对应列表重试。') : '',
    ].filter(Boolean).join('\n');
    return { title: name === 'main' ? t('🤖 助手中心') : t('📊 状态'), detail,
      columns: 3, entries: name === 'status' ? [back()] : [
        section(t('💬 会话选择'), 'sessions'), section(t('📁 工作区'), 'workspaces'), section(t('🤖 模式／预设'), 'presets'),
        section(t('🧠 模型'), 'models'), command(t('🆕 新会话'), '/new'), section(t('📋 会话列表'), 'sessions'),
        command(t('⏹ 停止'), '/stop'), command(t('📐 压缩'), '/compact'), command(t('🧹 清空上下文'), '/clear'), section(t('💬 补充指令'), 'steer'),
        { label: t('切换归档显示'), action: { kind: 'archive', include: !archived } },
        section(t('📊 状态'), 'status'), section(t('📖 帮助'), 'help'),
      ] };
  }
  if (name === 'sessions') {
    const listed = await harness.listWorkspaceSessions(sessionWorkspace, options);
    return qqMenuPage({ title: t('📋 会话列表'), detail: clean(sessionWorkspace), choices: visibleSessions(listed).map((item) =>
      command(`${item.sessionId === sessionId ? '✓ ' : ''}${clean(item.title || item.sessionId, 70)}${item.archived ? t('（已归档）') : ''}`, `/session ${item.sessionId}`)) });
  }
  if (name === 'workspaces') {
    const { paths } = await workspacePathSnapshot(harness, options);
    return qqMenuPage({ title: t('📁 工作区'), choices: paths.map((path) =>
      command(`${path === workspace ? '✓ ' : ''}${clean(path)}`, `/workspace ${path}`)) });
  }
  if (name === 'models') {
    const catalog = await catalogFor(harness, sessionId, key, options);
    return qqMenuPage({ title: t('🧠 模型'), detail: catalog.failures?.length ? t('部分模型暂不可用，可稍后重试。') : '',
      choices: catalog.groups.flatMap((group) => group.models.map((model) => command(
        `${catalog.current?.provider === group.id && catalog.current?.model === model.id ? '✓ ' : ''}${clean(group.name, 30)} · ${clean(model.name, 60)}`,
        `/model ${group.id}/${model.id}`))) });
  }
  if (name === 'presets') {
    const settings = await harness.agentPresetSettings(options);
    return qqMenuPage({ title: t('🤖 模式／预设'), detail: t('预设仅用于之后的新会话。'), choices: [
      command(`${settings.agentPreset === null ? '✓ ' : ''}${t('跟随 Host 默认')}`, '/preset --default'),
      ...settings.agentPresetCatalog.items.map((item) => command(
        `${settings.agentPreset === item.id ? '✓ ' : ''}${clean(item.label || item.id, 70)}`,
        `/preset ${/^\d+$/u.test(item.id) ? 'id:' : ''}${item.id}`)),
    ] });
  }
  if (name === 'steer') return { title: t('💬 补充指令'), columns: 2,
    detail: t('给当前正在运行的任务补充指令。'), entries: [
      ...['继续', '加速运行', '总结当前进展', '更简洁些', '更详细些'].map((text) => command(t(text), `/steer ${t(text)}`)),
      section(t('自定义指令'), 'custom'), back(),
    ] };
  if (name === 'custom') return { title: t('自定义指令'), detail: t('请发送 /steer 你的补充指令。'), entries: [back()] };
  return { title: t('📖 帮助'), detail: [
    t('发送 /m 打开助手中心，点击按钮或回复当前列表的数字选择。'),
    t('设置：会话、工作区、模式／预设、模型。'),
    t('会话：新会话、会话列表、归档显示切换。'),
    t('任务：停止、压缩、清空上下文、快捷或自定义补充指令。'),
    t('信息：状态、帮助。'),
    t('菜单有效期为 15 分钟；发送普通消息会退出数字选择。'),
    t('回答问题、审批和批量输入时，数字优先用于当前交互。'),
    t('完整命令说明：/help'),
  ].join('\n'), entries: [back()] };
}

export function qqMenuText(view, { fallback = false } = {}) {
  return [view.title, view.detail, '', ...view.entries.map((entry, index) => `${index + 1}. ${entry.label}`), '',
    fallback ? t('当前无法展示按钮，请回复数字选择。') : t('点击按钮或回复数字选择，/m 返回主菜单。'),
    t('回答问题、审批和批量输入时，请先完成当前交互。'),
  ].filter((line) => line !== undefined).join('\n');
}

export function qqMenuKeyboard(view, token) {
  const buttons = view.entries.map((entry, index) => ({
    id: `${token}_${index + 1}`,
    render_data: { label: view.columns === 3
      ? clean(entry.label, 24).replace(t('模式／预设'), t('预设')).replace(t('切换归档显示'), t('归档显示'))
      : `${index + 1}. ${clean(entry.label, 32)}`, visited_label: t('已选择'), style: 0 },
    action: { type: 2, permission: { type: 2 }, data: `/m pick ${token} ${index + 1}`, enter: true,
      unsupport_tips: t('请回复数字选择，或发送 /m 重新打开菜单。') },
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += view.columns ?? 2) rows.push({ buttons: buttons.slice(i, i + (view.columns ?? 2)) });
  return { content: { rows } };
}

export async function sendQqMenu(bot, target, view, token, { logger = console } = {}) {
  if (typeof bot.send === 'function') {
    try {
      const content = qqMenuText(view).replace(/[\\`*_{}\[\]()<>#|!]/gu, '\\$&');
      return await bot.send({ target, msgType: 2, markdown: { content }, keyboard: qqMenuKeyboard(view, token) });
    } catch (error) {
      // A timeout may have delivered already. Only a definite provider rejection
      // permits another send, so a network fault never creates duplicate menus.
      if (!(error instanceof ApiError) || error.httpStatus < 400 || error.httpStatus >= 500 || error.httpStatus === 429) throw error;
      logger.warn?.('[dsh-im:qq] menu rejected; using numbered text:', error.bizCode);
    }
  }
  return bot.sendText(target, qqMenuText(view, { fallback: true }));
}
