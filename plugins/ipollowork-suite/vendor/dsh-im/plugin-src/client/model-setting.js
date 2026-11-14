import * as React from 'react';

import {
  EMPTY_MODEL_CATALOG,
  modelCatalogEntry,
  modelSelectionId,
  normalizeModelCatalog,
  normalizeModelSelection,
  sameModelSelection,
} from '../../src/channels/shared/model-setting.mjs';
import { h, localizeText } from './i18n.js';
import { ConnectionError, normalizeConnectionError } from './connection-error.js';

export const SET_MODEL_ENDPOINT = 'bot.model.set';
export { EMPTY_MODEL_CATALOG, normalizeModelCatalog, normalizeModelSelection };

export const ModelCatalogContext = React.createContext(EMPTY_MODEL_CATALOG);

function chevron(open = false) {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
    className: 'dim-modelChevron', style: open ? { transform: 'rotate(90deg)' } : undefined },
  h('path', { d: 'm6 4 4 4-4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }));
}

export function ModelEditor({ model = null, disabled = false, onSave }) {
  const catalog = normalizeModelCatalog(React.useContext(ModelCatalogContext));
  const id = React.useId();
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const restoreFocusRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const [pane, setPane] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const current = normalizeModelSelection(model);
  const entry = modelCatalogEntry(catalog, current);
  const currentAvailable = !current || Boolean(entry);
  const reasoning = entry?.reasoning;
  const effort = current?.reasoningEffort;
  const effectiveEffort = effort ?? reasoning?.defaultEffort;
  const effortEntry = reasoning?.efforts.find((level) => level.id === effectiveEffort);
  const effortUnavailable = effort !== undefined
    && !reasoning?.efforts.some((level) => level.id === effort);
  const defaultName = reasoning?.efforts.find((level) => level.id === reasoning.defaultEffort)?.name;
  const defaultLabel = localizeText('跟随模型默认') + (defaultName ? ` · ${defaultName}` : '');
  const effortLabel = !current ? localizeText('跟随默认模型')
    : effort === undefined ? defaultLabel : effortEntry?.name ?? effort;
  const effortHint = !current ? '先选择模型，再设置思考强度。'
    : !currentAvailable ? null
      : effortUnavailable ? '已保存的思考强度已不可用，请选择其他强度或恢复默认。'
        : !reasoning ? '该模型未提供可调节的思考强度。' : null;
  const effortDisabled = !current || !currentAvailable || (!reasoning && effort === undefined);

  const close = (restoreFocus = false) => {
    restoreFocusRef.current = restoreFocus;
    setPane(null);
  };

  React.useEffect(() => {
    // A successful RPC also unlocks the card in its parent. Wait for that
    // commit before focusing the trigger, which cannot be focused disabled.
    if (!pane && !saving && !disabled && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [pane, saving, disabled]);

  React.useEffect(() => {
    if (!pane) return undefined;
    const options = menuRef.current?.querySelectorAll('[role="menuitemradio"]');
    const selected = menuRef.current?.querySelector('[aria-checked="true"]');
    (selected ?? options?.[0])?.focus();
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setPane(null);
    };
    globalThis.document?.addEventListener('mousedown', outside);
    return () => globalThis.document?.removeEventListener('mousedown', outside);
  }, [pane]);

  const save = async (next) => {
    if (savingRef.current || disabled) return;
    if (sameModelSelection(current, next)) { close(true); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(next);
      close(true);
    } catch (cause) {
      setError(normalizeConnectionError(cause, 'model-update-failed', '模型修改失败，请重试。'));
      close(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const option = (key, label, description, selected, next) => h('button', {
    key, type: 'button', role: 'menuitemradio', 'aria-checked': selected,
    className: 'dim-modelOption', disabled: disabled || saving,
    onClick: () => { void save(next); },
  },
  h('span', { className: 'dim-modelOptionCopy' },
    h('span', { className: 'dim-modelOptionName' }, label),
    description ? h('span', { className: 'dim-modelDescription' }, description) : null),
  h('span', { className: 'dim-modelCheck', 'aria-hidden': true }, selected ? '✓' : ''));

  const row = (key, label, value, blocked = false) => h('button', {
    type: 'button', className: 'dim-modelRow', disabled: disabled || saving || blocked,
    'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': pane === key,
    'aria-controls': pane === key ? `${id}-menu` : undefined,
    'aria-describedby': key === 'effort' && effortHint ? `${id}-hint` : undefined,
    onClick: (event) => {
      triggerRef.current = event.currentTarget;
      setPane(pane === key ? null : key);
    },
  }, h('span', { className: 'dim-modelRowLabel' }, label),
  h('span', { className: 'dim-modelValue', title: value }, value), chevron(pane === key));

  return h('div', {
    ref: rootRef, className: 'dim-preset dim-modelSetting',
    onBlur: (event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
    },
    onKeyDown: (event) => {
      if (!pane) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(globalThis.document?.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    },
  },
  h('div', { className: 'dim-presetHeader' },
    h('span', { className: 'dim-presetTitle' }, '模型与思考强度',
      h('span', { className: 'dim-presetHelp' },
        h('button', { type: 'button', className: 'dim-presetHelpButton',
          'aria-label': '查看模型设置说明', 'aria-describedby': `${id}-help` },
        h('span', { 'aria-hidden': true }, '?')),
        h('span', { id: `${id}-help`, className: 'dim-presetTooltip', role: 'tooltip' },
          effortHint && !effortUnavailable
            ? h('span', { id: `${id}-hint` }, effortHint, ' ') : null,
          '只影响新建会话；若当前聊天已有会话，先发送 /new，再发送普通消息生效。'))),
    saving ? h('span', { className: 'dim-presetStatus', role: 'status' }, '保存中…') : null),
  row('model', '模型', entry?.name ?? (current ? modelSelectionId(current) : localizeText('跟随默认模型'))),
  error ? h('div', { role: 'alert' }, h(ConnectionError, { error })) : null,
  row('effort', '思考强度', effortLabel, effortDisabled),
  pane ? h('div', { ref: menuRef, id: `${id}-menu`, role: 'menu',
    'aria-label': pane === 'model' ? '模型' : '思考强度', 'aria-busy': saving,
    className: 'dim-modelMenu' },
  pane === 'model' ? [
    option('default', '跟随默认模型', null, !current, null),
    ...catalog.groups.map((group) => h('section', { key: group.id, role: 'group', 'aria-label': group.name },
      h('div', { className: 'dim-modelGroupTitle' }, group.name),
      ...group.models.map((choice) => {
        const selected = current?.provider === group.id && current?.model === choice.id;
        return option(choice.id, choice.name, choice.description ?? `${group.id}/${choice.id}`,
          selected, selected ? current : { provider: group.id, model: choice.id });
      }))),
  ] : [
    option('provider-default', defaultLabel, '使用模型或服务提供方的默认思考强度。', effort === undefined,
      current ? { provider: current.provider, model: current.model } : null),
    ...(reasoning?.efforts ?? []).map((level) => option(`effort:${level.id}`, level.name, level.description,
      effort === level.id, { ...current, reasoningEffort: level.id })),
  ]) : null,
  effortHint && effortUnavailable ? h('p', { id: `${id}-hint`, className: 'dim-modelHint',
    role: 'status' }, effortHint) : null,
  !error && !currentAvailable ? h('p', { className: 'dim-presetError', role: 'status' },
    '当前模型已不可用，请选择其他模型或跟随默认模型。') : null);
}
