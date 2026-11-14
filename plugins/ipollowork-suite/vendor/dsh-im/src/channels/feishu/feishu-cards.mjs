/**
 * Feishu interactive-card builders for the dsh-im menu / session-list /
 * workspace-list UX. All builders return the JSON string the
 * `im.message.create` API expects as `content` for `msg_type: interactive`
 * (card schema 2.0; callback buttons live inside a column_set/column layout).
 *
 * The session list lays each row out as a `column_set` (fixed-width ⭐
 * watch-toggle column + weighted session-button column), which is how V2
 * expresses a row of buttons.
 *
 * Buttons carry a small `{ action }` value object that `card.action.trigger`
 * events echo back (when the app subscribes that event); every numbered
 * button also has a numeric label so the number-reply fallback stays usable
 * without button callbacks.
 */

import { t } from '../shared/i18n.mjs';
import { SESSION_NAV_HELP_LINES } from '../shared/command-catalog.mjs';
import { workspaceLabels } from '../shared/workspace-labels.mjs';
import { normalizeFeishuStepCardPanels } from './step-push-mode.mjs';

export const MENU_PAGE_SIZE = 10;
export const MODEL_PAGE_SIZE = 20;
const MODEL_CARD_TEXT_LIMIT = 200;

/** 预设下拉中「跟随默认」(null) 的哨兵值，供 initial_index 命中与回调识别。 */
export const PRESET_FOLLOW_DEFAULT_SENTINEL = '__preset_follow_default__';
export const REASONING_DEFAULT_SENTINEL = '__reasoning_default__';

function plainText(content) {
  return { tag: 'plain_text', content: String(content) };
}

function markdown(content) {
  return { tag: 'lark_md', content: String(content) };
}

/** Full-width button wrapped in a column_set. */
function button(content, actionValue) {
  return {
    tag: 'column_set',
    flex_mode: 'none',
    columns: [{
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [{
        tag: 'button',
        text: plainText(content),
        type: 'default',
        width: 'fill',
        behaviors: [{ type: 'callback', value: { action: actionValue } }],
      }],
    }],
  };
}

/** The raw button element (without the full-width column_set wrapper). */
function buttonElement(content, actionValue) {
  return {
    tag: 'button',
    text: plainText(content),
    type: 'default',
    width: 'fill',
    behaviors: [{ type: 'callback', value: { action: actionValue } }],
  };
}

/**
 * Two buttons side by side in a `column_set`.
 * `leftContent` / `leftAction` and `rightContent` / `rightAction` define
 * each button's label and callback action value.
 */
function buttonPair(leftContent, leftAction, rightContent, rightAction) {
  return {
    tag: 'column_set',
    flex_mode: 'none',
    columns: [
      { tag: 'column', width: 'weighted', weight: 1, elements: [buttonElement(leftContent, leftAction)] },
      { tag: 'column', width: 'weighted', weight: 1, elements: [buttonElement(rightContent, rightAction)] },
    ],
  };
}

/**
 * Feishu schema 2.0 single-select (`select_static`) does NOT support a
 * `selected` field on options (that triggers 230099 parse json err). The
 * supported way to show a default value is `initial_index` (1-based option
 * order; 0 = show none). Build it from the option array + current value.
 */
function initialIndex(options, currentValue) {
  const idx = options.findIndex((o) => o.value === currentValue);
  return idx >= 0 ? idx + 1 : 0;
}

function cleanTitle(value) {
  return String(value ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function safeTitle(value) {
  return cleanTitle(value) || t('暂无标题');
}

function cardWith(headerText, elements) {
  return JSON.stringify({
    schema: '2.0',
    header: { title: plainText(headerText), template: 'blue' },
    body: { elements },
  });
}

// ── Shared helper: a "back to menu" button ────────────────────────────────

function backButton() {
  return button(t('🔙 返回菜单'), 'back_to_menu');
}

// ── Main menu card ────────────────────────────────────────────────────────

/**
 * The hub menu card — a single entry point covering every command, organized
 * by operating flow:
 *   1. 会话 · 工作区（高频率）→ 会话下拉 · 工作区下拉 · 新会话 · 全部会话
 *   2. 任务控制 → 停止 · 压缩 · 补充指令下拉
 *   3. 配置 → 预设下拉 · 模型下拉 · 归档切换
 *   4. 系统 → 状态 · 帮助
 * `ctx` bundle:
 *   - workspaces: string[]          (工作区下拉选项)
 *   - workspaceTitles: object      (可选，按绝对路径索引的工作区名称)
 *   - currentWorkspace: string|null (当前工作区,下拉高亮)
 *   - currentSession: {id,title}|null (当前绑定会话,续写目标)
 *   - sessions: {id,title}[]        (最近会话,供会话下拉切换)
 *   - archiveVisible: boolean       (归档显隐开关当前值)
 *   - presetCatalog: object|null    (预设目录, {items,defaultId,_currentId})
 *   - modelCatalog: object|null     (模型目录, {groups,current})
 *   - newSessionAction: {id,status,message?}|null (新会话按钮的执行状态)
 * Number fallback: 1=续写 2=新会话 3=会话列表 4=状态
 * 5=补全权限 6=帮助.
 */
export function menuCard(ctx) {
  const {
    workspaces = [],
    workspaceTitles = {},
    currentWorkspace = null,
    currentSession = null,
    sessions = [],
    archiveVisible = false,
    presetCatalog = null,
    modelCatalog = null,
    newSessionAction = null,
  } = ctx || {};

  // currentSession 提供 id/title；为兼容旧调用，也接受 currentSessionTitle
  const currentSessionId = currentSession?.id ?? null;
  const currentSessionTitle = currentSession?.title ?? ctx?.currentSessionTitle ?? null;

  const sessionOptions = (Array.isArray(sessions) ? sessions : []).slice(0, 20);
  const hasSessions = sessionOptions.length > 0;
  const hasWorkspaces = Array.isArray(workspaces) && workspaces.length > 0;
  const elements = [];

  let newSessionLabel = t('🆕 新会话');
  if (newSessionAction?.status === 'processing') {
    newSessionLabel = t('正在开启…');
    elements.push({ tag: 'div', text: plainText(t('正在开启新会话…')) });
  } else if (newSessionAction?.status === 'success') {
    newSessionLabel = t('已执行：新会话');
    elements.push({ tag: 'div', text: plainText(t('已执行：新会话。发送消息即可开始。')) });
  } else if (newSessionAction?.status === 'failed') {
    elements.push({ tag: 'div', text: plainText(t('新会话操作失败：{message}', {
      message: newSessionAction.message || t('卡片操作失败，请稍后重试。'),
    })) });
  }

  // ── 设置区 ──────────────────────────────────────────────────
  elements.push({ tag: 'div', text: markdown(t('**设置**')) });

  // ── 四个下拉菜单 2×2 网格 ────────────────────────────────────

  // 第 1 行：会话 + 工作区
  let sessionDropdown = null;
  if (hasSessions) {
    const sessionPickOptions = sessionOptions.map((s) => ({
      text: { tag: 'plain_text', content: `${s.id === currentSessionId ? '✓ ' : ''}${safeTitle(s.title)}` },
      value: s.id,
    }));
    sessionDropdown = {
      tag: 'select_static',
      name: 'session_pick',
      placeholder: {
        tag: 'plain_text',
        content: currentSessionId ? t('切换会话') : t('选择会话（当前未绑定）'),
      },
      initial_index: initialIndex(sessionPickOptions, currentSessionId),
      options: sessionPickOptions,
      behaviors: [{ type: 'callback', value: { action: 'session_pick' } }],
    };
  }

  let workspaceDropdown = null;
  if (hasWorkspaces) {
    const labels = workspaceLabels(workspaces, workspaceTitles);
    const wsOptions = workspaces.slice(0, 20).map((path, index) => ({
      text: { tag: 'plain_text', content: `${path === currentWorkspace ? '✓ ' : ''}${labels[index].numbered ? `${index + 1}. ` : ''}${labels[index].label}` },
      value: path,
    }));
    workspaceDropdown = {
      tag: 'select_static',
      name: 'workspace_pick',
      placeholder: { tag: 'plain_text', content: t('切换工作区') },
      initial_index: initialIndex(wsOptions, currentWorkspace),
      options: wsOptions,
      behaviors: [{ type: 'callback', value: { action: 'workspace_pick' } }],
    };
  }

  // 第 2 行：预设 + 模型
  const presetItems = Array.isArray(presetCatalog?.items) ? presetCatalog.items : [];
  const curPresetId = presetCatalog?._currentId ?? null;
  const presetFollowDefault = curPresetId === null;
  let presetDropdown = null;
  if (presetItems.length >= 1) {
    const setPresetOptions = presetItems.slice(0, 30).map((item) => ({
      text: { tag: 'plain_text', content: `${item.id === curPresetId ? '✓ ' : ''}${item.label}` },
      value: item.id,
    }));
    const presetSelected = presetFollowDefault ? PRESET_FOLLOW_DEFAULT_SENTINEL : curPresetId;
    setPresetOptions.unshift({
      text: { tag: 'plain_text', content: `${presetFollowDefault ? '✓ ' : ''}${t('跟随默认')}` },
      value: PRESET_FOLLOW_DEFAULT_SENTINEL,
    });
    presetDropdown = {
      tag: 'select_static',
      name: 'preset_pick',
      placeholder: { tag: 'plain_text', content: t('切换预设') },
      initial_index: initialIndex(setPresetOptions, presetSelected),
      options: setPresetOptions,
      behaviors: [{ type: 'callback', value: { action: 'preset_pick' } }],
    };
  }

  const groups = Array.isArray(modelCatalog?.groups) ? modelCatalog.groups : [];
  const curModel = modelCatalog?.current;
  const curModelId = curModel ? `${curModel.provider}/${curModel.model}` : null;
  const flat = [];
  for (const group of groups) {
    for (const model of (group.models || [])) {
      flat.push({
        id: `${group.id}/${model.id}`,
        name: `${group.name} - ${model.name}`,
        reasoning: model.reasoning,
      });
    }
  }
  let modelDropdown = null;
  let reasoningDropdown = null;
  if (flat.length > 1) {
    // Keep the compact menu within Feishu select limits; the dedicated model
    // card exposes the complete catalog.
    const setModelOptions = flat.slice(0, 30).map((opt) => ({
      text: { tag: 'plain_text', content: `${opt.id === curModelId ? '✓ ' : ''}${opt.name}` },
      value: opt.id,
    }));
    modelDropdown = {
      tag: 'select_static',
      name: 'model_pick',
      placeholder: { tag: 'plain_text', content: t('切换模型') },
      initial_index: initialIndex(setModelOptions, curModelId),
      options: setModelOptions,
      behaviors: [{ type: 'callback', value: { action: 'model_pick' } }],
    };
  }
  const selectedModel = flat.find((opt) => opt.id === curModelId);
  const efforts = Array.isArray(selectedModel?.reasoning?.efforts)
    ? selectedModel.reasoning.efforts.filter((effort) => typeof effort?.id === 'string' && effort.id)
    : [];
  if (efforts.length > 0) {
    const currentEffort = curModel?.reasoningEffort ?? selectedModel.reasoning.defaultEffort;
    const effortOptions = [
      { id: REASONING_DEFAULT_SENTINEL, name: t('默认等级') },
      ...efforts.map((effort) => ({ id: effort.id, name: effort.name || effort.id })),
    ].map((effort) => ({
      text: { tag: 'plain_text', content: `${effort.id === (currentEffort ?? REASONING_DEFAULT_SENTINEL) ? '✓ ' : ''}${effort.name}` },
      value: effort.id,
    }));
    reasoningDropdown = {
      tag: 'select_static',
      name: 'reasoning_pick',
      placeholder: { tag: 'plain_text', content: t('切换推理等级') },
      initial_index: initialIndex(effortOptions, currentEffort ?? REASONING_DEFAULT_SENTINEL),
      options: effortOptions,
      behaviors: [{ type: 'callback', value: { action: 'reasoning_pick' } }],
    };
  }

  // 渲染 2×2 网格：图标 + 下拉并列
  // 每一行用 4 列 column_set：图标 | 下拉 | 图标 | 下拉
  function iconCol(icon) {
    return { tag: 'column', width: 'weighted', weight: 0.1, vertical_align: 'center', elements: [{ tag: 'div', text: { tag: 'plain_text', content: icon } }] };
  }
  function dropdownCol(el) {
    return { tag: 'column', width: 'weighted', weight: 1, elements: [el] };
  }

  const row1 = [];
  if (sessionDropdown) row1.push(sessionDropdown);
  if (workspaceDropdown) row1.push(workspaceDropdown);
  if (row1.length === 2) {
    elements.push({
      tag: 'column_set', flex_mode: 'none',
      columns: [iconCol('💬'), dropdownCol(row1[0]), iconCol('📂'), dropdownCol(row1[1])],
    });
  } else if (row1[0]) {
    elements.push(row1[0]);
  }
  if (!hasSessions) {
    elements.push({ tag: 'div', text: markdown(t('当前工作区暂无可用会话。')) });
  }

  const row2 = [];
  const presetBtn = button(t('🤖 切换预设'), 'presets');
  const modelBtn = button(t('🧠 切换模型'), 'models');
  if (presetDropdown) row2.push(presetDropdown); else row2.push(presetBtn);
  if (modelDropdown) row2.push(modelDropdown); else row2.push(modelBtn);
  elements.push({
    tag: 'column_set', flex_mode: 'none',
    columns: [iconCol('🤖'), dropdownCol(row2[0]), iconCol('🧠'), dropdownCol(row2[1])],
  });
  if (reasoningDropdown) {
    elements.push({
      tag: 'column_set', flex_mode: 'none',
      columns: [iconCol('🧠'), dropdownCol(reasoningDropdown)],
    });
  }

  // 新会话 + 全部会话按钮
  const sessionButtons = buttonPair(newSessionLabel, 'new', t('📋 会话/关注'), 'sessions');
  const newSessionButton = sessionButtons.columns[0].elements[0];
  if (newSessionAction?.id) {
    newSessionButton.behaviors[0].value.newSessionActionId = newSessionAction.id;
  }
  if (newSessionAction?.status === 'processing' || newSessionAction?.status === 'success') {
    newSessionButton.disabled = true;
  }
  elements.push(sessionButtons);
  if (!hasSessions && !hasWorkspaces) {
    elements.push(button(t('🗂 工作区列表'), 'workspaces'));
  }
  elements.push({ tag: 'hr' });

  // ── 任务控制（对运行中任务的操作）────────────────────────
  elements.push({ tag: 'div', text: markdown(t('**任务控制**')) });
  elements.push(buttonPair(t('⏹ 停止'), 'stop', t('📐 压缩'), 'compact'));
  elements.push(button(t('🧹 清空上下文'), 'clear'));
  elements.push({ tag: 'hr' });

  // ── 补充指令 + 归档切换（并列）────────────────────────────
  elements.push({
    tag: 'column_set', flex_mode: 'none',
    columns: [
      {
        tag: 'column', width: 'weighted', weight: 1,
        elements: [
          { tag: 'div', text: markdown(t('**补充指令**')) },
          {
            tag: 'select_static',
            name: 'steer_pick',
            placeholder: { tag: 'plain_text', content: t('选择补充指令') },
            initial_index: 0,
            options: [
              ...QUICK_STEER_OPTIONS.map((source) => ({
                text: { tag: 'plain_text', content: t(source) },
                value: t(source),
              })),
              { text: { tag: 'plain_text', content: t('✏️ 更多 / 自定义…') }, value: 'custom' },
            ],
            behaviors: [{ type: 'callback', value: { action: 'steer_pick' } }],
          },
        ],
      },
      {
        tag: 'column', width: 'weighted', weight: 1,
        elements: [
          { tag: 'div', text: markdown(t('🗄 归档：{state}', {
            state: archiveVisible ? t('已显示') : t('已隐藏'),
          })) },
          button(t('切换归档显示'), 'archive_toggle'),
        ],
      },
    ],
  });
  elements.push({ tag: 'hr' });

  // ── 底部操作（系统功能）────────────────────────────────────
  elements.push(buttonPair(t('📊 状态'), 'status', t('📖 帮助'), 'help'));

  // 命令与数字兜底说明
  elements.push({ tag: 'div', text: markdown(t(
    '**数字兜底**\n**1**工作区列表 · **2**新会话 · **3**会话列表 · **4**状态\n**5**🔧补全权限 · **6**帮助',
  )) });
  return cardWith(t('🤖 助手中心'), elements);
}

// ── Preset management card ────────────────────────────────────────────────

/**
 * Preset selection card with a dropdown of available presets.
 * The catalog comes from `harness.agentPresetSettings()`.
 */
export function presetCard(catalog) {
  const { items, defaultId } = catalog;
  const current = catalog._currentId; // injected by the caller
  const currentItem = items.find((i) => i.id === current);
  const defaultItem = items.find((i) => i.id === defaultId);

  const currentText = current === null
    ? t('跟随 Host 默认{default}', { default: defaultItem ? `（${defaultItem.label}）` : '' })
    : currentItem
      ? `${currentItem.label}（${currentItem.id}）`
      : t('{id}（已不可用）', { id: current });

  const elements = [
    { tag: 'div', text: markdown(t('**当前**：{value}', { value: currentText })) },
    { tag: 'div', text: markdown(t('**Host 默认**：{value}', {
      value: defaultItem ? `${defaultItem.label}（${defaultItem.id}）` : t('未设置'),
    })) },
    { tag: 'hr' },
  ];

  if (items.length >= 1) {
    const presetCardOptions = items.map((item) => ({
      text: { tag: 'plain_text', content: `${item.label}（${item.id}）${item.id === current ? ' ✓' : ''}` },
      value: item.id,
    }));
    elements.push(
      {
        tag: 'select_static',
        name: 'preset_pick',
        placeholder: { tag: 'plain_text', content: t('选择预设') },
        initial_index: current === null ? 0 : initialIndex(presetCardOptions, current),
        options: presetCardOptions,
        behaviors: [{ type: 'callback', value: { action: 'preset_pick' } }],
      },
      { tag: 'hr' },
      buttonPair(t('🔄 跟随默认'), 'preset_default', t('🔙 返回菜单'), 'back_to_menu'),
    );
  } else {
    elements.push(
      { tag: 'div', text: markdown(t('当前没有可选择的预设。')) },
      backButton(),
    );
  }
  return cardWith(t('🤖 预设列表'), elements);
}

// ── Model management card ─────────────────────────────────────────────────

/**
 * Model selection card with a dropdown of available models.
 * The catalog comes from `harness.listModels()` or `session.models()`.
 * Groups are shown as text, then a flat dropdown for selection.
 */
export function modelCard(catalog, { page = 0 } = {}) {
  const { groups, current } = catalog;
  const currentId = current ? `${current.provider}/${current.model}` : null;
  const allModels = groups.flatMap((group) => group.models.map((model) => ({
    group, model, id: `${group.id}/${model.id}`,
  })));
  const pages = Math.max(1, Math.ceil(allModels.length / MODEL_PAGE_SIZE));
  const selectedPage = Number.isSafeInteger(page) && page >= 0 ? Math.min(page, pages - 1) : 0;
  const currentOrdinal = currentId ? allModels.findIndex((entry) => entry.id === currentId) : -1;
  const visibleModels = allModels.slice(selectedPage * MODEL_PAGE_SIZE, (selectedPage + 1) * MODEL_PAGE_SIZE);

  const elements = [
    { tag: 'div', text: markdown(t('**当前模型**：{model}', { model: currentId || t('未设置') })) },
    { tag: 'hr' },
  ];

  if (allModels.length === 0) {
    elements.push(
      { tag: 'div', text: markdown(t('当前没有可用模型。')) },
      backButton(),
    );
  } else {
    const currentUnavailable = currentId && currentOrdinal < 0;
    elements.push({ tag: 'div', text: markdown(t('第 {page}/{pages} 页 · 共 {total} 个模型', {
      page: selectedPage + 1, pages, total: allModels.length,
    })) });
    if (currentUnavailable) elements.push({ tag: 'div', text: markdown(t('当前模型不可用：{model}', { model: currentId })) });
    // Bound the Markdown and the picker together, so a large catalog does not
    // produce an oversized card or silently hide selectable entries.
    for (const group of groups) {
      const modelLines = visibleModels.filter((entry) => entry.group === group).map(({ id }) => (
        `${id}${id === currentId ? ' ✓' : ''}`
      ));
      if (modelLines.length) elements.push(
        { tag: 'div', text: markdown(`**${group.name}**\n${modelLines.join('\n')}`) },
      );
    }

    const allOptions = visibleModels.map(({ group, model, id }) => ({
      value: id,
      text: { tag: 'plain_text', content: `${group.name} - ${model.name}`.slice(0, MODEL_CARD_TEXT_LIMIT) },
    }));
    const currentOption = allModels.find((entry) => entry.id === currentId)?.model;
    const efforts = Array.isArray(currentOption?.reasoning?.efforts)
      ? currentOption.reasoning.efforts.filter((effort) => typeof effort?.id === 'string' && effort.id)
      : [];

    elements.push(
      { tag: 'hr' },
      {
        tag: 'select_static',
        name: 'model_pick',
        placeholder: { tag: 'plain_text', content: t('选择模型') },
        initial_index: currentId === null ? 0 : initialIndex(allOptions, currentId),
        options: allOptions.map((opt) => ({
          text: { tag: 'plain_text', content: `${opt.text.content}${opt.value === currentId ? ' ✓' : ''}` },
          value: opt.value,
        })),
        behaviors: [{ type: 'callback', value: { action: 'model_pick' } }],
      },
    );
    if (efforts.length > 0) {
      const currentEffort = current?.reasoningEffort ?? currentOption.reasoning.defaultEffort;
      const effortOptions = [
        { id: REASONING_DEFAULT_SENTINEL, name: t('默认等级') },
        ...efforts.map((effort) => ({ id: effort.id, name: effort.name || effort.id })),
      ].map((effort) => ({
        text: { tag: 'plain_text', content: `${effort.id === (currentEffort ?? REASONING_DEFAULT_SENTINEL) ? '✓ ' : ''}${effort.name}` },
        value: effort.id,
      }));
      elements.push({
        tag: 'select_static',
        name: 'reasoning_pick',
        placeholder: { tag: 'plain_text', content: t('切换推理等级') },
        initial_index: initialIndex(effortOptions, currentEffort ?? REASONING_DEFAULT_SENTINEL),
        options: effortOptions,
        behaviors: [{ type: 'callback', value: { action: 'reasoning_pick' } }],
      });
    }
    if (pages > 1) {
      elements.push(buttonPair(
        selectedPage > 0 ? t('◀ 上一页') : t('第一页'),
        selectedPage > 0 ? `models:${selectedPage - 1}` : 'models:0',
        selectedPage + 1 < pages ? t('下一页 ▶') : t('最后一页'),
        selectedPage + 1 < pages ? `models:${selectedPage + 1}` : `models:${pages - 1}`,
      ));
    }
    elements.push({ tag: 'hr' }, backButton());
  }
  return cardWith(t('🧠 模型列表'), elements);
}

// ── Status card ───────────────────────────────────────────────────────────

/**
 * System status card showing connection, workspace, preset, model and session
 * count. `info` is an object with keys:
 *   - connected: boolean
 *   - workspace: string | null
 *   - preset: string | null
 *   - model: string | null
 *   - sessionCount: number
 */
export function statusCard(info) {
  const elements = [
    { tag: 'div', text: markdown(t('{icon} 飞书机器人{state}', {
      icon: info.connected ? '✅' : '❌',
      state: info.connected ? t('已连接') : t('未连接'),
    })) },
    { tag: 'div', text: markdown(t('📂 工作区：`{workspace}`', { workspace: info.workspace || t('未设置') })) },
    { tag: 'div', text: markdown(t('🤖 预设：{preset}', { preset: info.preset || t('未设置') })) },
    { tag: 'div', text: markdown(t('🧠 模型：{model}', { model: info.model || t('未设置') })) },
    { tag: 'div', text: markdown(t('💬 会话：{count} 个', { count: info.sessionCount })) },
    { tag: 'hr' },
    backButton(),
  ];
  return cardWith(t('📊 系统状态'), elements);
}

// ── Help card ─────────────────────────────────────────────────────────────

/**
 * Plain-text command reference advertised when no interactive card is
 * available (e.g. non-interactive clients), so every command stays
 * discoverable without card callbacks.
 */
export function menuHelpText() {
  return [
    '🤖 助手菜单（回复数字即可，无需记命令）',
    '',
    '📋 会话 / 工作区',
    '/sessionlist 或 /sessions  列出工作区会话',
    '/sessionlist --all  跨工作区汇总会话（每个工作区默认显示 10 个，可用 --limit N 调整）',
    '/sessionlist --limit N  仅列出当前工作区前 N 个会话',
    '/session Session ID、当前工作区序号或标题关键词  将当前聊天绑定到指定会话',
    '/workspacelist  列出工作区',
    '/workspace 工作区序号或绝对路径  切换工作区',
    '/ws、/wsl、/workspaces  工作区命令别名',
    '/new  开启全新会话',
    ...SESSION_NAV_HELP_LINES.map((line) => t(line)),
    '',
    '📊 状态 / 压缩',
    '/status  连接状态',
    '/version  查看插件版本',
    '/compact  压缩当前会话上下文',
    '/clear  清空当前会话上下文（保留 Session 绑定和历史记录）',
    '/history [数量]  查看最近历史消息（默认 3 条，最多 5 条）',
    '/archived on/off  会话列表显示/隐藏归档',
    '',
    '👁 关注',
    '/watch ID  关注会话（完成后推送）',
    '/watchlist  关注列表',
    '/unwatch ID  取消关注',
    '',
    '🤖 预设 / 模型',
    '/presetlist 或 /presets  列出可用 Agent Preset',
    '/preset [序号或完整ID]  查看或设置当前机器人 Agent Preset',
    '纯数字 ID：/preset id:<ID>',
    '/preset --default  跟随 Host 默认',
    '/permissionlist  按序号列出权限档位',
    '/permission [序号或完整ID]  查看或切换当前会话权限',
    '纯数字 ID：/permission id:<ID>',
    '/models  列出模型',
    '/reasoninglist 或 /reasonings  按序号列出当前模型可用推理等级',
    '/reasoning [序号、等级ID或 --default]  查看或切换当前推理等级',
    '/model [序号或完整模型ID] [推理等级ID]  查看或切换当前会话模型',
    '',
    '📦 批量输入（仅私聊）',
    '/batch  开始批量输入（仅私聊，最多 10 条文字）',
    '/send  提交当前批次',
    '/cancel  取消当前批次',
    '',
    '🎮 任务控制',
    '/stop  停止当前任务',
    '/steer 指令  给 Agent 补充指令',
    '/repair  补全飞书权限与卡片回调',
  ].map((line) => t(line)).join('\n');
}

/**
 * Help card with all available commands and their descriptions.
 */
const HELP_CARD_FEATURES = [
  '**📋 卡片功能**',
  '',
  '1. 会话下拉 — 切换当前绑定会话',
  '2. 工作区下拉 — 切换工作区',
  '3. 🤖 预设下拉 — 切换 Agent 预设',
  '4. 🧠 模型下拉 — 切换模型',
  '5. 🆕 新会话 — 开启全新会话',
  '6. 📋 会话/关注 — 查看/绑定会话，管理关注',
  '7. ⏹ 停止 — 停止当前任务',
  '8. 📐 压缩 — 压缩当前会话上下文',
  '9. 🧹 清空上下文 — 清空上下文并保留绑定和历史记录',
  '10. 补充指令 — 给 Agent 发送指令',
  '11. 🗄 归档切换 — 显示/隐藏归档会话',
  '12. 📊 状态 — 查看系统连接状态',
  '13. 📖 帮助 — 查看本帮助',
].join('\n');

const HELP_TEXT_COMMANDS = [
  '**⌨️ 文本命令**',
  '',
  '`/m` — 打开菜单卡片',
  '`/new` — 开启全新会话',
  '`/session Session ID、当前工作区序号或标题关键词` — 绑定已有会话',
  '`/sessionlist [工作区]` 或 `/sessions [工作区]` — 列出会话',
  '`/sessionlist --all` 或 `/sessions --all` — 跨工作区汇总会话（每个工作区默认显示 10 个，可用 --limit N 调整）',
  '`/sessionlist --limit N` 或 `/sessions --limit N` — 仅列出当前工作区前 N 个会话',
  '`/workspace 工作区序号或绝对路径` — 切换工作区',
  '`/workspacelist` — 列出工作区',
  '`/status` — 查看连接状态',
  '`/compact` — 压缩上下文',
  '`/clear` — 清空上下文并保留 Session 绑定和历史记录',
  '`/stop` — 停止当前任务',
  '`/steer 指令` — 补充指令',
  '`/watch ID` — 关注会话',
  '`/watchlist` — 关注列表',
  '`/unwatch ID` — 取消关注',
  '`/archived on/off` — 归档显隐',
  '`/presetlist` 或 `/presets` — 列出预设',
  '`/preset [序号/ID]` — 切换预设',
  '`/preset --default` — 跟随默认',
  '`/models` — 列出模型',
  '`/reasoninglist` 或 `/reasonings` — 按序号列出当前模型可用推理等级',
  '`/reasoning [序号、等级ID或 --default]` — 查看或切换当前推理等级',
  '`/model [序号或完整模型ID] [推理等级ID]` — 查看或切换当前会话模型',
  '`/batch` — 开启批量输入（仅私聊，最多 10 条文字）',
  '`/send` — 提交当前批次',
  '`/cancel` — 取消当前批次',
  '`/repair` — 补全飞书权限与卡片回调',
].join('\n');

const HELP_NUMBER_FALLBACK = [
  '**💡 数字兜底**',
  '回复数字快速操作：',
  '**1**工作区列表 · **2**新会话 · **3**会话/关注',
    '**4**状态 · **5**补全权限 · **6**帮助',
].join('\n');

export function helpCard(extraTextLines = []) {
  const extraText = Array.isArray(extraTextLines) && extraTextLines.length > 0
    ? ('\n' + extraTextLines.join('\n'))
    : '';
  const elements = [
    { tag: 'div', text: markdown(t(HELP_CARD_FEATURES)) },
    { tag: 'hr' },
    { tag: 'div', text: markdown([
      t(HELP_TEXT_COMMANDS),
      t('`/permissionlist` — 按序号列出权限档位'),
      t('`/permission [序号/ID]` — 查看或切换当前会话权限'),
      t('/ws、/wsl、/workspaces  工作区命令别名'),
      t('`/version` — 查看插件版本'),
      t('/history [数量]  查看最近历史消息（默认 3 条，最多 5 条）'),
    ].join('\n') + extraText) },
    { tag: 'hr' },
    { tag: 'div', text: markdown(t(HELP_NUMBER_FALLBACK)) },
    { tag: 'hr' },
    backButton(),
  ];
  return cardWith(t('📖 帮助'), elements);
}

// ── One-shot callback probe (repair verification) ─────────────────────────

/** One-shot callback probe used only after an existing app was re-authorized. */
export function cardActionProbeCard(nonce) {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    throw new TypeError('A safe card-action probe nonce is required');
  }
  return cardWith(t('🧪 验证卡片按钮'), [
    {
      tag: 'div',
      text: markdown(t('授权已提交。请点击下方按钮；机器人真实收到回调后才会判定修复成功。')),
    },
    {
      tag: 'column_set',
      flex_mode: 'none',
      columns: [{
        tag: 'column',
        width: 'weighted',
        weight: 1,
        elements: [{
          tag: 'button',
          text: plainText(t('完成验证')),
          type: 'primary',
          width: 'fill',
          behaviors: [{
            type: 'callback',
            value: { action: 'repair_verify', nonce },
          }],
        }],
      }],
    },
  ]);
}

// ── Session list card (preserved, with back button) ───────────────────────

/**
 * One page of the workspace's sessions. Each row is a `column_set` pair:
 * the fixed-width ⭐ watch toggle (`⭐关注` / `⭐取关` for already-watched
 * sessions) followed by the session button that carries the page-local
 * number label (reply-number fallback = bind). Archived sessions are marked
 * in the label. `watchedSessionIds` is a Set-like of ids this conversation
 * already watches.
 */
export function sessionListCard(workspace, sessions, page, total, watchedSessionIds = new Set(), boundSessionId = '') {
  const start = page * MENU_PAGE_SIZE;
  const slice = sessions.slice(start, start + MENU_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / MENU_PAGE_SIZE));
  const watched = (id) => typeof watchedSessionIds?.has === 'function' && watchedSessionIds.has(id);
  /** One row: fixed 90px watch toggle + the session button filling the rest. */
  const row = (watchButton, sessionButton) => ({
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: 'default',
    columns: [
      { tag: 'column', width: '90px', vertical_align: 'center', elements: [watchButton] },
      { tag: 'column', width: 'weighted', weight: 1, vertical_align: 'center', elements: [sessionButton] },
    ],
  });
  const elements = [
    { tag: 'div', text: markdown(t('**工作区**：{workspace}\n共 **{total}** 个会话{paging}', {
      workspace: `\`${workspace}\``,
      total,
      paging: total > MENU_PAGE_SIZE
        ? t('（第 {page}/{pageCount} 页）', { page: page + 1, pageCount })
        : '',
    })) },
    ...slice.map((session, offset) => {
      // Page-local numbering: number replies resolve against this page.
      const label = `${offset + 1}. ${safeTitle(session.title)}`
        + `${session.archived === true ? t('（已归档）') : ''}`
        + `${session.sessionId === boundSessionId ? t('（当前绑定）') : ''}`;
      const watching = watched(session.sessionId);
      return row(
        buttonElement(watching ? t('⭐ 取消关注') : t('☆ 关注'), watching ? `unwatch:${session.sessionId}` : `watch:${session.sessionId}`),
        buttonElement(label, `use:${session.sessionId}`),
      );
    }),
  ];
  if (page > 0) elements.push(button(t('◀ 上一页'), `sessions:${page - 1}`));
  if (page + 1 < pageCount) elements.push(button(t('下一页 ▶'), `sessions:${page + 1}`));
  elements.push(
    { tag: 'hr' },
    buttonPair(t('🔙 返回菜单'), 'back_to_menu', t('🔍 关注列表'), 'watchlist'),
    { tag: 'div', text: markdown(t('回复数字（1~N）绑定本页会话。')) },
  );
  return cardWith(t('📂 会话列表'), elements);
}

// ── Workspace list card (preserved, with back button) ─────────────────────

/** The workspace list card (switch-workspace buttons + reply fallback). */
export function workspaceListCard(paths, current, titles = {}) {
  const labels = workspaceLabels(paths, titles);
  const elements = paths.length === 0
    ? [
        { tag: 'div', text: markdown(t('当前 Host 上没有已登记的工作区。')) },
        backButton(),
      ]
    : [
        { tag: 'div', text: markdown(t('回复数字切换工作区，或点击按钮：')) },
        ...paths.map((path, index) => button(
          `${index + 1}. ${labels[index].label}${path === current ? t('（当前）') : ''}`,
          `workspace:${path}`,
        )),
        { tag: 'hr' },
        backButton(),
      ];
  return cardWith(t('🗂 工作区'), elements);
}

// ── Watch list card (multi-select add/remove + back button) ──────────────

/** Dropdown (multi-select) of sessions not yet watched, to add them in bulk. */
function watchAddSelect(entries, availableSessions) {
  const watched = new Set(entries.map((e) => e.sessionId));
  const options = (Array.isArray(availableSessions) ? availableSessions : [])
    .filter((s) => s?.sessionId && !watched.has(s.sessionId))
    .slice(0, 30)
    .map((s) => ({
      text: { tag: 'plain_text', content: safeTitle(s.title ?? s.sessionId) },
      value: s.sessionId,
    }));
  if (options.length === 0) return null;
  return {
    tag: 'multi_select_static',
    name: 'watch_add',
    placeholder: { tag: 'plain_text', content: t('勾选要关注的会话') },
    options,
    behaviors: [{ type: 'callback', value: { action: 'watch_add', kind: 'multi' } }],
  };
}

/** Dropdown (multi-select) of currently watched sessions, to remove in bulk. */
function watchRemoveSelect(entries) {
  const options = entries.slice(0, 30).map((entry) => ({
    text: { tag: 'plain_text', content: safeTitle(entry.title) },
    value: entry.sessionId,
  }));
  if (options.length === 0) return null;
  return {
    tag: 'multi_select_static',
    name: 'watch_remove',
    placeholder: { tag: 'plain_text', content: t('勾选要取消关注的会话') },
    options,
    behaviors: [{ type: 'callback', value: { action: 'watch_remove', kind: 'multi' } }],
  };
}

/** The watch list for one conversation (multi-select add/remove + buttons). */
export function watchListCard(entries, availableSessions) {
  const watching = Array.isArray(entries) ? entries : [];
  const addSelect = watchAddSelect(watching, availableSessions);
  const removeSelect = watchRemoveSelect(watching);

  const elements = [];
  if (watching.length === 0) {
    elements.push({ tag: 'div', text: markdown(t('当前没有关注的会话。任务完成会自动推送结果。')) });
  } else {
    elements.push({ tag: 'div', text: markdown(t('当前关注 **{count}** 个会话：', { count: watching.length })) });
  }

  if (addSelect) {
    elements.push({ tag: 'hr' }, { tag: 'div', text: markdown(t('**➕ 添加关注**（多选下拉勾选）')) }, addSelect);
  }
  if (removeSelect) {
    elements.push({ tag: 'hr' }, { tag: 'div', text: markdown(t('**➖ 取消关注**（多选下拉勾选）')) }, removeSelect);
  }
  elements.push({ tag: 'hr' }, buttonPair(t('📋 会话列表'), 'sessions', t('🔙 返回菜单'), 'back_to_menu'));
  return cardWith(t('👁 关注列表'), elements);
}

// ── Completion push card ──────────────────────────────────────────────────

/**
 * The completion push card. `title` is the session title, `reason` the
 * turn-end kind (completed / stopped / aborted).
 */
export function completionCard(sessionId, title, reason) {
  const reasonText = reason === 'completed'
    ? t('已完成')
    : reason === 'stopped'
      ? t('已停止')
      : reason === 'aborted'
        ? t('已中止')
        : reason === 'cancelled'
          ? t('已取消')
          : t('已结束');
  return cardWith(t('✅ 任务完成'), [
    { tag: 'div', text: markdown(`**${safeTitle(title)}**\n\`${sessionId}\``) },
    { tag: 'div', text: markdown(t('**状态**：{reason}', { reason: reasonText })) },
    { tag: 'hr' },
    buttonPair(t('📋 会话列表'), 'sessions', t('🔙 返回菜单'), 'back_to_menu'),
    { tag: 'div', text: markdown(t('绑定该会话后可继续追问，输入文字即可。')) },
  ]);
}

// ── Steer card (补充指令) ─────────────────────────────────────────────────

/** 常用补充指令的快捷选项，供下拉秒选。 */
const QUICK_STEER_OPTIONS = ['继续', '加速运行', '总结当前进展', '更简洁些', '更详细些'];

/** 快捷下拉的最后一项：切换到自定义输入卡片。 */
export const STEER_CUSTOM_SENTINEL = '__steer_custom__';

/** 补充指令卡片：单个下拉，快捷指令 + 「更多/自定义」。 */
export function steerCard({ hasSession }) {
  const hint = hasSession
    ? t('从下方下拉选择补充指令；最后一项可自定义输入。')
    : t('当前没有绑定会话，请先绑定会话再补充指令。');
  const options = QUICK_STEER_OPTIONS.map((source) => ({
    text: { tag: 'plain_text', content: t(source) },
    value: t(source),
  }));
  options.push({ text: { tag: 'plain_text', content: t('✏️ 更多 / 自定义…') }, value: STEER_CUSTOM_SENTINEL });
  const elements = [
    { tag: 'div', text: markdown(hint) },
    { tag: 'hr' },
    {
      tag: 'select_static',
      name: 'steer_quick',
      placeholder: { tag: 'plain_text', content: t('选择补充指令') },
      initial_index: 0,
      options,
      behaviors: [{ type: 'callback', value: { action: 'steer', source: 'quick' } }],
    },
    { tag: 'hr' },
    button(t('🔙 返回菜单'), 'back_to_menu'),
  ];
  return cardWith(t('➕ 补充指令'), elements);
}

/** 自定义输入卡：输入框 + 提交（从下拉「更多/自定义」切过来）。 */
export function customSteerCard() {
  const elements = [
    { tag: 'div', text: markdown(t('输入补充指令后点「提交」，发送给当前运行的任务。')) },
    { tag: 'hr' },
    {
      tag: 'form',
      name: 'steer_form',
      elements: [
        {
          tag: 'input',
          name: 'steer_text',
          placeholder: { tag: 'plain_text', content: t('输入你的补充指令') },
        },
        {
          tag: 'button',
          // Card 2.0 form controls need stable names so the client can
          // construct a submit action (and expose action.name) reliably.
          name: 'steer_submit',
          text: { tag: 'plain_text', content: t('提交') },
          type: 'primary',
          width: 'fill',
          form_action_type: 'submit',
          behaviors: [{ type: 'callback', value: { action: 'steer', source: 'form' } }],
        },
      ],
    },
    { tag: 'hr' },
    button(t('🔙 返回菜单'), 'back_to_menu'),
  ];
  return cardWith(t('➕ 自定义指令'), elements);
}

/**
 * Interactive approval card with approve / reject buttons. Action values carry
 * the approvalId so the card callback can submit the decision:
 *   approve:<approvalId>  /  reject:<approvalId>
 * `requiresMention` is advisory; a button click is itself the operator's
 * explicit intent, so it does not need an @ mention in groups.
 */
export function approvalCard({ toolName, operation, reason, approvalId, resolvedText }) {
  const elements = [];
  if (toolName) {
    elements.push({ tag: 'div', text: markdown(t('工具：{tool}', { tool: String(toolName) })) });
  }
  if (operation) {
    // Cap the operation text so an oversized argument list cannot overflow the
    // card (the plain-text path rejects >6000 chars; here we truncate so the
    // approve/reject buttons still render).
    const MAX_OPERATION_CHARS = 6_000;
    const op = String(operation);
    const shown = op.length > MAX_OPERATION_CHARS
      ? `${op.slice(0, MAX_OPERATION_CHARS)}\n…（操作参数过长，已截断）`
      : op;
    elements.push({ tag: 'div', text: markdown(t('操作参数：\n{operation}', { operation: shown })) });
  }
  if (reason) {
    elements.push({ tag: 'div', text: markdown(t('原因：{reason}', { reason: String(reason) })) });
  }
  elements.push(
    { tag: 'hr' },
    resolvedText
      ? { tag: 'div', text: markdown(resolvedText) }
      : buttonPair(t('✅ 批准'), `approve:${approvalId}`, t('❌ 拒绝'), `reject:${approvalId}`),
  );
  return cardWith(t('🔐 工具审批'), elements);
}

// ── Streaming step card (流式过程卡片) ────────────────────────────────────

/** One streaming step card carries at most this many JSON bytes after the
 *  card has been serialized (Feishu caps card content near 30KB; stay lower
 *  so headers and JSON escaping always fit). */
export const STEP_STREAM_CARD_MAX_BYTES = 24_000;

/**
 * Build one streaming step card from the accumulated process blocks:
 *   { kind: 'message', text }         — interim note / warning / context line
 *   { kind: 'tools', lines: string[] } — tool-call summary panel
 * `status`: 'running' uses the configured panel expansion and ends with an italic status
 * line; 'completed' / 'stopped' collapse the panels and swap the status text;
 * 'sealed' is an overflow spill chunk with no status line at all. Finished
 * turns (and sealed spill chunks) merge every tool/thinking panel into one
 * collapsed "process details" panel so the sealed card stays compact.
 */

export function stepStreamCard(rawBlocks, { status = 'running', stepCardPanels } = {}) {
  const running = status === 'running';
  const panels = normalizeFeishuStepCardPanels(stepCardPanels);
  const elements = [];
  const panelElements = [];
  for (const block of Array.isArray(rawBlocks) ? rawBlocks : []) {
    if (block?.kind === 'tools' || block?.kind === 'notes') {
      const lines = (Array.isArray(block.lines) ? block.lines : [])
        .filter((line) => typeof line === 'string' && line.trim());
      if (lines.length === 0) continue;
      const count = lines.length + (Number(block.omitted) || 0);
      const panel = stepPanel(lines, {
        title: block.kind === 'tools'
          ? t('🛠️ 工具摘要（{count}）', { count })
          : t('💭 思考过程（{count}）', { count }),
        // Finished turns keep both panels inside the collapsed details wrapper.
        expanded: running && (block.kind === 'tools' ? panels.toolsExpanded : panels.thinkingExpanded),
      });
      if (running) elements.push(panel);
      else panelElements.push(panel);
      continue;
    }
    const text = typeof block?.text === 'string' ? block.text.trim() : '';
    if (text) elements.push({ tag: 'markdown', content: text });
  }
  if (!running && panelElements.length > 0) {
    // Finished turns: the tool/thinking panels nest inside one collapsed
    // "process details" wrapper, so the sealed card shows a single line.
    elements.push(processDetailsPanel(panelElements));
  }
  if (elements.length === 0) elements.push({ tag: 'markdown', content: ' ' });
  if (status !== 'sealed') {
    elements.push({ tag: 'markdown', content: `_${stepStatusText(status)}_` });
  }
  return JSON.stringify({
    schema: '2.0',
    header: { title: plainText(t('⚙️ 任务过程')), template: 'blue' },
    body: { elements },
  });
}

/** The collapsed wrapper that holds the per-kind panels on finished turns. */
function processDetailsPanel(children) {
  return {
    tag: 'collapsible_panel',
    expanded: false,
    background_color: 'grey-50',
    border: { color: 'grey', corner_radius: '8px' },
    padding: '8px 8px 8px 8px',
    header: {
      title: { tag: 'plain_text', content: t('📋 过程详情') },
      vertical_align: 'center',
      padding: '8px 8px 8px 8px',
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', color: 'grey', size: '16px 16px' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    elements: children,
  };
}

/** The collapsible grey panel used for tool summaries and thinking notes. */
function stepPanel(lines, { title, expanded }) {
  return {
    tag: 'collapsible_panel',
    expanded: expanded === true,
    background_color: 'grey-50',
    border: { color: 'grey', corner_radius: '8px' },
    padding: '8px 8px 8px 8px',
    header: {
      title: { tag: 'plain_text', content: title },
      vertical_align: 'center',
      padding: '8px 8px 8px 8px',
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', color: 'grey', size: '16px 16px' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    elements: [{ tag: 'markdown', content: lines.join('\n') }],
  };
}

export function stepStatusText(status) {
  if (status === 'completed') return t('已完成');
  if (status === 'stopped') return t('已停止');
  return t('运行中');
}

/**
 * A single card accepts only this many `table` elements. Feishu rejects the
 * whole write with `230099 / ErrCode 11310 card table number over limit`, which
 * leaves the card stuck on its previous content, so the reply never appears.
 *
 * The boundary was established by the maintainer against a live bot: five
 * tables in one card succeeded, six failed, and a folded process panel's tables
 * counted toward the total (3 folded + 2 in the body succeeded, 3 + 3 failed).
 */
export const STEP_STREAM_CARD_MAX_TABLES = 5;

function hasClosingBacktickRun(text, start, length) {
  for (let index = start; index < text.length;) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (text[end] === '`') end += 1;
    if (end - index === length) return true;
    index = end;
  }
  return false;
}

function gfmTableCells(line) {
  const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (normalized.startsWith('    ') || normalized.startsWith('\t')) return null;
  const text = normalized.trim();
  if (!text) return null;

  const cells = [];
  let cell = '';
  let separators = 0;
  let codeRun = 0;
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === '\\' && index + 1 < text.length) {
      cell += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === '`') {
      let end = index + 1;
      while (text[end] === '`') end += 1;
      const length = end - index;
      if (codeRun === length) {
        codeRun = 0;
      } else if (codeRun === 0 && hasClosingBacktickRun(text, end, length)) {
        codeRun = length;
      }
      cell += text.slice(index, end);
      index = end;
      continue;
    }
    if (character === '|' && codeRun === 0) {
      cells.push(cell);
      cell = '';
      separators += 1;
      index += 1;
      continue;
    }
    cell += character;
    index += 1;
  }
  if (separators === 0) return null;
  cells.push(cell);
  if (cells[0].trim() === '') cells.shift();
  if (cells.at(-1)?.trim() === '') cells.pop();
  return cells.length > 0 ? cells : null;
}

/** Locate table headers once for both counting and splitting. */
function markdownTableStarts(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.split('\n');
  const offsets = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const starts = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      fence = opening[1];
      continue;
    }
    const header = gfmTableCells(line);
    const delimiter = gfmTableCells(lines[index + 1] ?? '');
    if (!header || !delimiter || header.length !== delimiter.length
      || !delimiter.every((cell) => /^\s*:?-+:?\s*$/.test(cell))) continue;
    starts.push(offsets[index]);
    index += 1;
    // A delimiter-looking data row is part of this table, not another header.
    while (index + 1 < lines.length && gfmTableCells(lines[index + 1])) index += 1;
  }
  return starts;
}

export function countMarkdownTables(text) {
  return markdownTableStarts(text).length;
}

function splitMarkdownByTableLimit(text, maxTables) {
  const starts = markdownTableStarts(text);
  const parts = [];
  let from = 0;
  for (let index = maxTables; index < starts.length; index += maxTables) {
    parts.push(text.slice(from, starts[index]));
    from = starts[index];
  }
  parts.push(text.slice(from));
  return parts;
}

/** Count the Markdown that stepStreamCard actually renders. */
function stepStreamCardTableCount(blocks) {
  return blocks.reduce((sum, block) => {
    const text = block?.kind === 'notes' || block?.kind === 'tools'
      ? (block.lines ?? []).filter((line) => typeof line === 'string' && line.trim()).join('\n')
      : block?.text;
    return sum + countMarkdownTables(text);
  }, 0);
}

/** Split display copies; the bridge's logical blocks and answer indices stay intact. */
export function splitBlockByTableLimit(block, maxTables = STEP_STREAM_CARD_MAX_TABLES) {
  if (!block || typeof block !== 'object' || !Number.isInteger(maxTables) || maxTables < 1) return [block];
  if (block.kind === 'notes' || block.kind === 'tools') {
    const lines = (block.lines ?? []).filter((line) => typeof line === 'string' && line.trim());
    if (countMarkdownTables(lines.join('\n')) <= maxTables) return [block];
    const groups = [];
    let current = [];
    for (const line of lines) {
      for (const part of splitMarkdownByTableLimit(line, maxTables)) {
        if (current.length && countMarkdownTables([...current, part].join('\n')) > maxTables) {
          groups.push(current);
          current = [];
        }
        current.push(part);
      }
    }
    if (current.length) groups.push(current);
    return groups.map((lines, index) => ({ ...block, lines, omitted: index === 0 ? block.omitted : 0 }));
  }
  if (typeof block.text !== 'string' || countMarkdownTables(block.text) <= maxTables) return [block];
  return splitMarkdownByTableLimit(block.text, maxTables).map((text) => ({ ...block, text }));
}

/**
 * Split accumulated blocks into card-sized chunks at block boundaries,
 * budgeted by the encoded running-status card (the largest render) **and** by
 * the table count, because a card accepts only a handful of tables no matter
 * how small it is. Every chunk keeps at least one block so progress is never
 * dropped. The caller renders all but the last chunk as `sealed` and the last
 * one live.
 */
export function splitStepStreamCardBlocks(
  blocks,
  limit = STEP_STREAM_CARD_MAX_BYTES,
  maxTables = STEP_STREAM_CARD_MAX_TABLES,
  stepCardPanels,
) {
  // A single block can carry more tables than a card accepts — one short answer
  // with six small tables — and splitting only between blocks cannot help. Each
  // block is broken at table boundaries first, so the walk below sees pieces it
  // can actually distribute.
  const list = (Array.isArray(blocks) ? blocks : [])
    .filter(Boolean)
    .flatMap((block) => splitBlockByTableLimit(block, maxTables));
  if (list.length === 0) return [];
  const chunks = [];
  let current = [];
  for (const block of list) {
    const tooLarge = Buffer.byteLength(stepStreamCard([...current, block], { stepCardPanels }), 'utf8') > limit;
    const tooManyTables = stepStreamCardTableCount([...current, block]) > maxTables;
    if (current.length > 0 && (tooLarge || tooManyTables)) {
      chunks.push(current);
      current = [block];
    } else {
      current.push(block);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Interactive question card. Each option is shown in wrapping body text with
 * a short numbered button; the selected option label is submitted via a
 * card callback. Multi-select questions fall back to the plain-text flow (the
 * caller decides), because a multi-select needs a confirm step.
 * A resolvedText replaces the buttons when an image ends the question flow.
 * Action: answer:<interactionId>:<optionLabel>
 */
export function questionCard({ interactionId, header, question, detail, options, index, total, resolvedText }) {
  const elements = [];
  const progress = total > 1 ? `（${index + 1}/${total}）` : '';
  if (header) elements.push({ tag: 'div', text: markdown(String(header)) });
  const qText = typeof question === 'string' && question.trim() ? question : t('请输入你的回答。');
  elements.push({ tag: 'div', text: markdown(String(qText)) });
  if (detail) elements.push({ tag: 'div', text: markdown(String(detail)) });

  if (resolvedText) {
    elements.push({ tag: 'hr' }, { tag: 'div', text: markdown(resolvedText) });
    return cardWith(t('⏹ 提问已结束{progress}', { progress }), elements);
  }

  if (Array.isArray(options) && options.length > 0) {
    elements.push({ tag: 'hr' });
    for (const [optionIndex, option] of options.entries()) {
      const label = typeof option?.label === 'string' ? option.label : '';
      if (!label) continue;
      const description = typeof option?.description === 'string' && option.description.trim()
        ? option.description.trim()
        : '';
      // Long button labels are clipped by Feishu. Keep the complete option in
      // non-interactive body text, numbered like the text-reply fallback.
      const number = optionIndex + 1;
      elements.push({
        tag: 'div',
        text: plainText(`${number}. ${label}${description ? `\n${description}` : ''}`),
      });
      // Action carries the question index so a stale card from a previous
      // question cannot be applied to the current one: answer:<interactionId>:<index>:<label>
      elements.push(button(t('选择 {number}', { number }), `answer:${interactionId}:${index}:${label}`));
    }
    // issue #162：自定义答案入口与 menuCard/steerCard 的「✏️ 更多 / 自定义…」
    // 对齐——文字流本就支持 custom 答案，卡片补上引导入口。
    elements.push(button(t('✏️ 其他答案…'), `answerCustom:${interactionId}:${index}`));
  }
  return cardWith(t('❓ 请补充信息{progress}', { progress }), elements);
}

/**
 * issue #162：提问卡被回答后的已答状态卡——原卡整卡替换为该回执样式：
 * 保留问题与选项文本、标注已选项、不渲染任何按钮（重复点击从根源消失）。
 * 与 questionCard 一样返回 JSON 字符串，调用方直接作为卡 content 使用。
 */
export function answeredQuestionCard({ interactionId, header, question, detail, options, chosen, index, total }) {
  const elements = [];
  const progress = total > 1 ? `（${index + 1}/${total}）` : '';
  if (header) elements.push({ tag: 'div', text: markdown(String(header)) });
  const qText = typeof question === 'string' && question.trim() ? question : t('请输入你的回答。');
  elements.push({ tag: 'div', text: markdown(String(qText)) });
  if (detail) elements.push({ tag: 'div', text: markdown(String(detail)) });
  if (Array.isArray(options) && options.length > 0) {
    elements.push({ tag: 'hr' });
    let chosenShown = false;
    for (const option of options) {
      const label = typeof option?.label === 'string' ? option.label : '';
      if (!label) continue;
      if (label === chosen) chosenShown = true;
      elements.push({ tag: 'div', text: markdown(label === chosen
        ? t('✅ 已选择：{label}', { label })
        : label) });
    }
    // 自定义文本答案不在预设选项里——单独一行展示所选内容。
    if (!chosenShown && typeof chosen === 'string' && chosen.trim()) {
      elements.push({ tag: 'div', text: markdown(t('✅ 已选择：{label}', { label: chosen })) });
    }
  } else if (typeof chosen === 'string' && chosen.trim()) {
    elements.push({ tag: 'div', text: markdown(t('✅ 已选择：{label}', { label: chosen })) });
  }
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'div', text: markdown(t('回答已提交，对话将继续。')) });
  return cardWith(t('✅ 已回答{progress}', { progress }), elements);
}
