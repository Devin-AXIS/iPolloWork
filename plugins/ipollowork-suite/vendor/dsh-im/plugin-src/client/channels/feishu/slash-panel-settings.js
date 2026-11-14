import * as React from 'react';

import { h, localizeText } from '../../i18n.js';
import {
  FEISHU_ENDPOINTS,
  normalizeBotsSnapshot,
  presentError,
  unwrapRpcResult,
} from './api.js';
import {
  SLASH_COMMAND_MANIFEST,
  SLASH_PANEL_MODES,
  normalizeSlashPanelConfig,
} from '../../../../src/channels/feishu/slash-command-panel.mjs';

const MANIFEST_BY_NAME = new Map(SLASH_COMMAND_MANIFEST.map((entry) => [entry.command, entry]));
const ALL_COMMANDS = Object.freeze(SLASH_COMMAND_MANIFEST.map((entry) => entry.command));

function PanelButton({ children, disabled = false, onClick, ...props }) {
  return h('button', {
    ...props,
    type: 'button',
    className: 'dim-deliveryButton',
    disabled,
    onClick,
  }, children);
}

function panelSignature(panel) {
  const normalized = normalizeSlashPanelConfig(panel);
  return `${normalized.mode}:${normalized.order.join(',')}`;
}

function commandText(name) {
  const entry = MANIFEST_BY_NAME.get(name);
  return `/${name} — ${entry?.default ?? name}`;
}

/**
 * "指令面板" settings page: which commands the Feishu "/" panel offers, and in
 * which order.
 *
 * The panel lives on Feishu's side per app, so saving only records the choice;
 * the Host re-syncs the app in the background (creating and removing commands,
 * one per second, because Feishu returns the panel in creation order).
 */
export function FeishuSlashPanelSettingsPage({ account, rpcCall, onSaved }) {
  const incoming = React.useMemo(() => normalizeSlashPanelConfig(account.slashPanel), [account.botId, panelSignature(account.slashPanel)]);
  const [mode, setMode] = React.useState(incoming.mode);
  const [order, setOrder] = React.useState(() => [...incoming.order]);
  const [pending, setPending] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  /** Bot ids waiting for the reader to confirm a copy, or null when idle. */
  const [syncTargets, setSyncTargets] = React.useState(null);
  const [syncNotice, setSyncNotice] = React.useState(null);
  const [error, setError] = React.useState(null);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A status refresh must not discard what the reader is editing; once saved,
  // the next snapshot becomes the new baseline.
  React.useEffect(() => {
    if (dirty) return;
    setMode(incoming.mode);
    setOrder([...incoming.order]);
  }, [incoming.mode, incoming.order, dirty]);

  const edit = React.useCallback((update) => {
    setSaved(false);
    setDirty(true);
    update();
  }, []);

  const move = (index, offset) => edit(() => {
    const next = [...order];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  });

  const remove = (index) => edit(() => setOrder(order.filter((_, at) => at !== index)));

  const add = () => {
    if (!pending || order.includes(pending)) return;
    edit(() => setOrder([...order, pending]));
    setPending('');
  };

  /** The panel this page currently shows, in the shape the Host stores. */
  const draftPanel = () => (mode === SLASH_PANEL_MODES.CUSTOM
    ? { mode: SLASH_PANEL_MODES.CUSTOM, order: [...order] }
    : { mode: SLASH_PANEL_MODES.DEFAULT, order: [] });

  /** Adopt a Host snapshot as the new baseline for this page. */
  const applySnapshot = (value) => {
    const snapshot = normalizeBotsSnapshot(value);
    const bot = snapshot.bots.find((entry) => entry.botId === account.botId);
    const stored = normalizeSlashPanelConfig(bot?.slashPanel);
    setMode(stored.mode);
    setOrder([...stored.order]);
    // Publish the stored panel upwards *before* clearing `dirty`: that re-runs
    // the snapshot effect above, and a still-stale account would put the list
    // the reader just replaced back on screen (and into the next copy payload).
    onSaved?.(stored);
    setDirty(false);
    setSaved(true);
    return snapshot;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (typeof rpcCall !== 'function') throw new Error('飞书指令面板设置暂不可用。');
      const value = unwrapRpcResult(await rpcCall(
        FEISHU_ENDPOINTS.setSlashPanel,
        { botId: account.botId, slashPanel: draftPanel() },
      ));
      if (!mounted.current) return;
      applySnapshot(value);
    } catch (cause) {
      if (!mounted.current) return;
      setError(presentError(cause));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  /**
   * Copy this panel to every other Feishu bot. Each bot keeps its own stored
   * panel, so the copy is one save per bot (the same endpoint the Save button
   * uses) — offline bots pick the panel up when they start.
   */
  const startSyncAll = async () => {
    if (saving || syncing || typeof rpcCall !== 'function') return;
    setSyncing(true);
    setError(null);
    setSyncNotice(null);
    try {
      const snapshot = normalizeBotsSnapshot(unwrapRpcResult(
        await rpcCall(FEISHU_ENDPOINTS.status, {}),
      ));
      const others = snapshot.bots
        .map((entry) => entry.botId)
        .filter((botId) => botId && botId !== account.botId);
      if (!mounted.current) return;
      if (others.length === 0) {
        setSyncNotice({ scope: 'none' });
        return;
      }
      // Ask first: the other bots lose whatever panel they had.
      setSyncTargets(others);
    } catch (cause) {
      if (mounted.current) setError(presentError(cause));
    } finally {
      if (mounted.current) setSyncing(false);
    }
  };

  const confirmSyncAll = async () => {
    const targets = syncTargets;
    if (!targets || syncing || typeof rpcCall !== 'function') return;
    setSyncing(true);
    setError(null);
    setSyncTargets(null);
    const payload = draftPanel();
    let done = 0;
    let failed = 0;
    // The bot on screen goes first so its own state is authoritative even when
    // a later bot fails.
    for (const botId of [account.botId, ...targets]) {
      try {
        const value = unwrapRpcResult(await rpcCall(
          FEISHU_ENDPOINTS.setSlashPanel,
          { botId, slashPanel: payload },
        ));
        if (botId === account.botId && mounted.current) applySnapshot(value);
        done += 1;
      } catch {
        failed += 1;
      }
    }
    if (!mounted.current) return;
    setSyncing(false);
    setSyncNotice({ scope: 'done', done, failed });
  };

  const available = ALL_COMMANDS.filter((name) => !order.includes(name));

  return h('section', {
    className: 'dim-feishuGroupSettings',
    'aria-label': '指令面板设置',
  },
  h('section', {
    className: 'dim-feishuGroupControl',
    'aria-labelledby': 'dim-feishu-slash-panel-title',
  },
  h('div', { className: 'dim-feishuGroupControlHeader' },
    h('h3', { id: 'dim-feishu-slash-panel-title' }, '指令面板'),
    saving
      ? h('span', { className: 'dim-feishuGroupControlStatus', role: 'status' }, '保存中…')
      : saved
        ? h('span', { className: 'dim-feishuGroupControlStatus', role: 'status' }, '已保存，面板稍后同步')
        : null),
  h('p', { className: 'dim-feishuGroupHelp' },
    '面板只决定聊天输入框里打「/」时列出的指令和顺序；被移除的指令仍可手动输入，功能不受影响。同步由机器人后台完成，指令较多时需要一点时间。'),
  h('select', {
    className: 'dim-feishuGroupSelect',
    value: mode,
    'aria-label': '指令面板模式',
    disabled: saving || syncing,
    onChange: (event) => edit(() => {
      const next = event.target.value;
      setMode(next);
      // Switching to a custom panel starts from everything, in the shipped
      // order, so the reader only has to remove what they do not want.
      if (next === SLASH_PANEL_MODES.CUSTOM && order.length === 0) setOrder([...ALL_COMMANDS]);
    }),
  },
  h('option', { value: SLASH_PANEL_MODES.DEFAULT }, '跟随默认（随插件版本更新）'),
  h('option', { value: SLASH_PANEL_MODES.CUSTOM }, '自定义（自己挑指令和顺序）')),
  mode === SLASH_PANEL_MODES.CUSTOM
    ? h(React.Fragment, null,
      order.length === 0
        ? h('p', { className: 'dim-feishuGroupHelp' }, '当前没有选择任何指令，保存后「/」面板会变成空的。')
        : h('ul', { className: 'dim-feishuPanelList' },
          order.map((name, index) => h('li', {
            key: name,
            className: 'dim-feishuPanelRow',
          },
          h('span', { className: 'dim-feishuPanelIndex' }, String(index + 1)),
          h('span', { className: 'dim-feishuPanelCommand' }, commandText(name)),
          h('span', { className: 'dim-feishuPanelRowActions' },
            h(PanelButton, {
              'aria-label': [localizeText('上移'), `/${name}`].join(' '),
              disabled: saving || syncing || index === 0,
              onClick: () => move(index, -1),
            }, '↑'),
            h(PanelButton, {
              'aria-label': [localizeText('下移'), `/${name}`].join(' '),
              disabled: saving || syncing || index === order.length - 1,
              onClick: () => move(index, 1),
            }, '↓'),
            h(PanelButton, {
              'aria-label': [localizeText('移除'), `/${name}`].join(' '),
              disabled: saving || syncing,
              onClick: () => remove(index),
            }, '移除'))))),
      h('div', { className: 'dim-feishuPanelAdd' },
        h('select', {
          className: 'dim-feishuGroupSelect',
          value: pending,
          'aria-label': '添加指令',
          disabled: saving || syncing || available.length === 0,
          onChange: (event) => setPending(event.target.value),
        },
        h('option', { value: '' }, available.length === 0 ? '指令都已加入' : '选择要加入的指令'),
        available.map((name) => h('option', { key: name, value: name }, commandText(name)))),
        h(PanelButton, {
          disabled: saving || syncing || !pending,
          onClick: add,
        }, '加入'),
        h(PanelButton, {
          disabled: saving || syncing || available.length === 0,
          onClick: () => edit(() => setOrder([...ALL_COMMANDS])),
        }, '恢复全部'),
        h(PanelButton, {
          disabled: saving || syncing || order.length === 0,
          onClick: () => edit(() => setOrder([])),
        }, '全部移除')))
    : null,
  h('div', { className: 'dim-feishuPanelFooter' },
    h(PanelButton, {
      'data-kind': 'primary',
      disabled: saving || syncing || !dirty,
      onClick: () => { void save(); },
    }, '保存'),
    h(PanelButton, {
      disabled: saving || syncing,
      onClick: () => { void startSyncAll(); },
    }, '保存并同步到其他机器人')),
  syncTargets
    ? h('div', { className: 'dim-feishuPanelFooter' },
      h('span', { className: 'dim-feishuGroupHelp' },
        [localizeText('将把这套面板设置写入另外'),
          ` ${syncTargets.length} `,
          localizeText('个飞书机器人，它们各自的面板设置会被覆盖。')].join('')),
      h(PanelButton, {
        disabled: syncing,
        onClick: () => { void confirmSyncAll(); },
      }, '确认同步'),
      h(PanelButton, {
        disabled: syncing,
        onClick: () => setSyncTargets(null),
      }, '取消'))
    : null,
  syncing
    ? h('p', { className: 'dim-feishuGroupHelp', role: 'status' }, '正在同步…')
    : null,
  syncNotice?.scope === 'none'
    ? h('p', { className: 'dim-feishuGroupHelp', role: 'status' }, '这个渠道没有其他飞书机器人，不用同步。')
    : null,
  syncNotice?.scope === 'done'
    ? h('p', { className: 'dim-feishuGroupHelp', role: 'status' },
      syncNotice.failed > 0
        ? [localizeText('已同步到'), ` ${syncNotice.done} `, localizeText('个机器人，'),
          ` ${syncNotice.failed} `, localizeText('个失败。')].join('')
        : [localizeText('已同步到'), ` ${syncNotice.done} `, localizeText('个机器人。')].join(''))
    : null,
  error
    ? h('p', { className: 'dim-feishuGroupError', role: 'alert' }, error)
    : null));
}
