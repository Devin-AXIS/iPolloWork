import { t } from '../shared/i18n.mjs';

/** Static first-chat actions avoid catalog requests during the welcome reply deadline. */
export function wecomIntroductionMenu() {
  return { title: t('欢迎使用 iPolloWork'), description: t('选择下方操作，或直接发送消息开始。'), entries: [
    [t('新会话'), '/new'], [t('切换模型'), '/menu models'], [t('切换智能体'), '/menu presets'],
    [t('查看状态'), '/status'], [t('停止任务'), '/stop'], [t('更多操作'), '/help'],
  ] };
}

const MENU_COMMAND = /^\/m(?:enu)?(?:\s+(sessions|workspaces|models|presets)(?:\s+(\d+))?)?$/iu;

export function parseWecomMenu(text) {
  const match = MENU_COMMAND.exec(text.trim());
  return match ? { section: match[1]?.toLowerCase() ?? 'main', page: Number(match[2] ?? 0) } : null;
}

function clean(value, length = 80) {
  return [...String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ')].slice(0, length).join('');
}

function selector(key, title, entries, currentLabel, currentCommand, moreCommand) {
  const choices = entries.filter(([, command]) => command !== currentCommand);
  const visible = choices.slice(0, choices.length > 9 ? 8 : 9);
  return {
    key, title,
    entries: [[currentLabel || t('保持当前'), null], ...visible,
      ...(choices.length > 9 ? [[t('更多选项…'), moreCommand]] : [])],
  };
}

export function wecomSettings({ sessions = [], models = [], presets = [], sessionId,
  currentModel, currentPreset, presetLabel } = {}) {
  return {
    title: t('🤖 助手中心'),
    description: t('选择会话、模型或预设后，点击应用设置。'),
    selectors: [
      selector('session', t('会话'), sessions,
        sessions.find(([, command]) => command === `/session ${sessionId}`)?.[0] || t('新会话'),
        `/session ${sessionId}`, '/menu sessions'),
      selector('model', t('模型'), models,
        models.find(([, command]) => command === currentModel)?.[0] || t('跟随默认模型'),
        currentModel, '/menu models'),
      selector('preset', t('预设'), presets, presetLabel || t('跟随 Host 默认'),
        currentPreset, '/menu presets'),
    ],
    entries: [[t('应用设置'), 'apply']],
  };
}

export function wecomMenu({ workspace, workspaces = [] } = {}) {
  return {
    title: t('工作区与任务'),
    selectors: [selector('workspace', t('工作区'), workspaces,
      workspace, `/workspace ${workspace}`, '/menu workspaces')],
    entries: [
      [t('切换工作区'), 'select:workspace'],
      [t('🆕 新会话'), '/new'],
      [t('⏹ 停止'), '/stop'], [t('📐 压缩'), '/compact'],
      [t('📊 状态'), '/status'], [t('📖 帮助'), '/help'],
    ],
  };
}

// A native selector carries names; buttons only apply or navigate the selection.
export function wecomList({ title, section, entries, page = 0, description = '' }) {
  const pages = Math.max(1, Math.ceil(entries.length / 10));
  const current = Math.min(Math.max(0, page), pages - 1);
  const visible = entries.slice(current * 10, current * 10 + 10);
  const buttons = visible.length ? [[t('应用选择'), 'select:choice']] : [];
  if (current > 0) buttons.push([t('上一页'), `/menu ${section} ${current - 1}`]);
  if (current + 1 < pages) buttons.push([t('下一页'), `/menu ${section} ${current + 1}`]);
  buttons.push([t('返回'), '/menu']);
  return {
    title,
    description: `${current + 1} / ${pages}${description ? ` · ${description}` : ''}`,
    detail: visible.length ? '' : t('暂无可用选项。'),
    selectors: visible.length ? [{ key: 'choice', title, entries: visible }] : [],
    entries: buttons,
  };
}

export function wecomTemplateCard(menu, taskId) {
  const selections = menu.selectors?.map((item) => ({
    question_key: item.key, title: clean(item.title, 13), selected_id: '0',
    option_list: item.entries.map(([label], index) => ({ id: String(index), text: clean(label, 60) })),
  })) ?? [];
  const multiple = selections.length > 1;
  return {
    card_type: multiple ? 'multiple_interaction' : 'button_interaction',
    task_id: taskId,
    main_title: { title: clean(menu.title, 36),
      ...(menu.description ? { desc: clean(menu.description, 100) } : {}) },
    ...(menu.detail ? { sub_title_text: menu.detail.slice(0, 500) } : {}),
    ...(multiple ? { select_list: selections, submit_button: { text: menu.entries[0][0], key: '0' } }
      : { ...(selections.length ? { button_selection: selections[0] } : {}),
    button_list: menu.entries.map(([label], index) => ({
      text: clean(label, 36), key: String(index), style: index === 0 ? 1 : 2,
    })) }),
  };
}

export function wecomMenuText(menu) {
  return [menu.title, menu.description, menu.detail,
    ...menu.selectors?.flatMap((item) => item.entries.filter(([, command]) => command)
      .map(([label, command]) => `${label}：${command}`)) ?? [],
    ...menu.entries.filter(([, command]) => command.startsWith('/'))
      .map(([label, command]) => `${label}：${command}`)].filter(Boolean).join('\n');
}
