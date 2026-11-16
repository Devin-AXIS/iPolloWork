import * as React from 'react';
import { h } from './i18n.js';

export const SIDEBAR_SETTINGS_RPC_CHANNEL = '/dsh-im-sidebar';
export const SIDEBAR_SETTINGS_ENDPOINTS = Object.freeze({
  get: 'settings.sidebar-entry.get', set: 'settings.sidebar-entry.set',
});

function settingsResult(result) {
  if (result?.ok === false) throw new Error(result.error?.message || '无法读取或保存侧边栏设置，请稍后重试。');
  const value = result?.ok === true ? result.value : result;
  if (!['auto', 'show', 'hide'].includes(value?.mode) || typeof value.visible !== 'boolean') {
    throw new Error('侧边栏设置返回了无法识别的响应。');
  }
  return value;
}

/** One small Host read at startup and after management calls. A slow fallback
 * observes changes made by another client without mounting a management panel. */
export function installSidebarVisibilitySync({ rpcCall, setVisible,
  setTimeoutFn = globalThis.setTimeout, clearTimeoutFn = globalThis.clearTimeout,
  pollMs = 30_000,
}) {
  const abort = new AbortController();
  let timer;
  let running = false;
  let pending = false;
  let revision = 0;
  const schedule = (delay) => {
    clearTimeoutFn(timer);
    if (!abort.signal.aborted) timer = setTimeoutFn(refresh, delay);
  };
  const refresh = async () => {
    if (abort.signal.aborted) return;
    if (running) { pending = true; return; }
    running = true;
    pending = false;
    const current = revision;
    try {
      const value = settingsResult(await rpcCall(SIDEBAR_SETTINGS_ENDPOINTS.get, {}, abort.signal));
      if (!abort.signal.aborted && current === revision && !pending) setVisible(value.visible);
    } catch {
      // Retain the last confirmed visibility (initially hidden) on failure.
      // Settings and plugin details remain available independently.
    } finally {
      running = false;
      schedule(pending ? 0 : pollMs);
    }
  };
  void refresh();
  return {
    refresh() {
      revision++;
      if (running) pending = true;
      else schedule(0);
    },
    apply(value) {
      revision++;
      if (!abort.signal.aborted) setVisible(settingsResult(value).visible);
    },
    dispose() { abort.abort(); clearTimeoutFn(timer); },
  };
}

export function SidebarSettings({ rpcCall }) {
  const [mode, setMode] = React.useState('auto');
  const [phase, setPhase] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [saved, setSaved] = React.useState(false);
  const mounted = React.useRef(false);
  const busy = React.useRef(false);
  const failedMode = React.useRef(null);
  const id = React.useId();
  const disabled = phase === 'loading' || phase === 'saving';
  const load = React.useCallback(async (signal) => {
    setPhase('loading'); setError(null); setSaved(false);
    failedMode.current = null;
    try {
      const value = settingsResult(await rpcCall(SIDEBAR_SETTINGS_ENDPOINTS.get, {}, signal));
      if (signal?.aborted || !mounted.current) return;
      setMode(value.mode); setPhase('ready');
    } catch (caught) {
      if (signal?.aborted || !mounted.current) return;
      setError(caught.message); setPhase('error');
    }
  }, [rpcCall]);
  React.useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void load(abort.signal);
    return () => { mounted.current = false; abort.abort(); };
  }, [load]);
  const save = async (nextMode) => {
    if (busy.current || disabled) return;
    const previousMode = mode;
    busy.current = true; setPhase('saving'); setError(null); setSaved(false);
    setMode(nextMode);
    failedMode.current = null;
    try {
      const value = settingsResult(await rpcCall(SIDEBAR_SETTINGS_ENDPOINTS.set, { mode: nextMode }));
      if (mounted.current) { setMode(value.mode); setSaved(true); setPhase('ready'); }
    } catch (caught) {
      if (mounted.current) {
        failedMode.current = nextMode;
        setMode(previousMode); setError(caught.message); setPhase('error');
      }
    } finally { busy.current = false; }
  };
  return h('section', { className: 'dim-botGeneralSettings dim-sidebarSettings', 'aria-label': '侧边栏入口', 'aria-busy': disabled },
    h('div', { className: 'dim-botGeneralRow' },
      h('div', { className: 'dim-botGeneralText' },
        h('div', { className: 'dim-sidebarHeading' },
          h('label', { className: 'dim-botGeneralTitle', htmlFor: id }, '侧边栏入口'),
          h('span', { role: 'status', className: 'dim-botGeneralHelp' },
            phase === 'loading' ? '正在读取侧边栏设置…' : phase === 'saving' ? '保存中…' : saved ? '已保存' : '')),
        h('p', { className: 'dim-botGeneralHelp', id: `${id}-help` }, '自动模式：未配置渠道时显示，配置至少一个渠道后隐藏。隐藏后仍可从插件详情或设置进入，不影响机器人后台运行。')),
      h('div', { className: 'dim-botGeneralControl' },
        h('select', { id, className: 'dim-sidebarSelect', value: mode, disabled, 'aria-describedby': `${id}-help`,
          onChange: (event) => save(event.target.value) },
        h('option', { value: 'auto' }, '自动隐藏'),
        h('option', { value: 'show' }, '始终显示'),
        h('option', { value: 'hide' }, '始终隐藏')),
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true },
          h('path', { d: 'm4 6 4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 })))),
    error ? h('div', { className: 'dim-sidebarFeedback' },
      h('p', { role: 'alert', className: 'dim-accessFeedback', 'data-tone': 'error' }, error),
      h('button', { type: 'button', className: 'dim-deliveryButton',
        onClick: () => failedMode.current === null ? load() : save(failedMode.current) }, '重试')) : null);
}
