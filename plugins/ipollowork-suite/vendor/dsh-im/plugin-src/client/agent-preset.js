import * as React from 'react';

import { h } from './i18n.js';
import { COORDINATOR_PRESET } from '../../../../src/shared/coordinator.ts';

export const SET_AGENT_PRESET_ENDPOINT = 'bot.preset.set';

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

export const EMPTY_AGENT_PRESET_CATALOG = Object.freeze({
  defaultId: '',
  items: Object.freeze([]),
});

export const AgentPresetCatalogContext = React.createContext(EMPTY_AGENT_PRESET_CATALOG);

export function normalizeAgentPresetId(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return PRESET_ID.test(id) ? id : '';
}

export function normalizeAgentPresetCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { defaultId: '', items: [] };
  }
  const items = [];
  const seen = new Set();
  for (const entry of Array.isArray(value.items) ? value.items : []) {
    const id = typeof entry === 'string'
      ? normalizeAgentPresetId(entry)
      : normalizeAgentPresetId(entry?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = typeof entry?.label === 'string' && entry.label.trim()
      ? entry.label.trim().slice(0, 128)
      : typeof entry?.name === 'string' && entry.name.trim()
        ? entry.name.trim().slice(0, 128)
        : id;
    items.push({ id, label });
  }
  return {
    defaultId: normalizeAgentPresetId(value.defaultId),
    items,
  };
}

export function AgentPresetEditor({ agentPreset = '', disabled = false, onSave }) {
  const catalog = React.useContext(AgentPresetCatalogContext) ?? EMPTY_AGENT_PRESET_CATALOG;
  const helpId = React.useId();
  const current = normalizeAgentPresetId(agentPreset);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  if (catalog.defaultId === COORDINATOR_PRESET && current === COORDINATOR_PRESET) {
    return h('div', { className: 'dim-preset' },
      h('div', { className: 'dim-presetHeader' }, h('span', { className: 'dim-presetTitle' }, '总助手')),
      h('p', null, '自动处理任务，按需调用固定专家或临时助手，无需为专家分别扫码。'),
      h('p', null, '已有会话保持不变，发送 /new 后由总助手接待。'));
  }

  const items = [];
  const seen = new Set();
  for (const item of Array.isArray(catalog.items) ? catalog.items : []) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const currentUnavailable = Boolean(current && !seen.has(current));
  if (currentUnavailable) items.push({ id: current, label: current, unavailable: true });

  const inheritLabel = '跟随 Host 默认';

  const change = async (event) => {
    const next = event.target.value;
    if (next === current || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(next || null);
    } catch (cause) {
      setError(cause?.message ?? 'Agent Preset 修改失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  return h('div', { className: 'dim-preset' },
    h('div', { className: 'dim-presetHeader' },
      h('span', { className: 'dim-presetTitle' },
        h('span', null, 'Agent Preset'),
        h('span', { className: 'dim-presetHelp' },
          h('button', {
            type: 'button',
            className: 'dim-presetHelpButton',
            'aria-label': '查看 Agent Preset 说明',
            'aria-describedby': helpId,
          }, h('span', { 'aria-hidden': 'true' }, '?')),
          h('span', {
            id: helpId,
            className: 'dim-presetTooltip',
            role: 'tooltip',
          }, '只影响新建会话；若当前聊天已有会话，先发送 /new，再发送普通消息生效。'))),
      saving ? h('span', { className: 'dim-presetStatus' }, '保存中…') : null),
    React.createElement('select', {
      className: 'dim-presetSelect',
      value: current,
      disabled: disabled || saving,
      'aria-label': 'Agent Preset',
      onChange: (event) => { void change(event); },
    },
      h('option', { value: '' }, inheritLabel),
      ...items.map((item) => h(
        'option',
        { key: item.id, value: item.id },
        item.unavailable
          ? [item.id, '（已不可用）']
          : item.label && item.label !== item.id ? `${item.label}（${item.id}）` : item.id,
      )),
    ),
    error || currentUnavailable ? h(
      'p',
      { className: 'dim-presetError', role: error ? 'alert' : 'status' },
      error ?? '当前 Agent Preset 已不可用，请选择其他 Preset 或跟随 Host 默认。',
    ) : null,
  );
}
