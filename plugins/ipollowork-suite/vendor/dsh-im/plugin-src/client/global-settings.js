import { DeliverySyncSettings } from './delivery-sync-settings.js';
import { GroupHistorySettings } from './group-history-settings.js';
import { SidebarSettings } from './sidebar-settings.js';
import * as React from 'react';

import {
  DEFAULT_INBOUND_TTL_HOURS,
  INBOUND_TTL_MAX_HOURS,
  normalizeInboundTtlHours,
} from '../../src/channels/shared/inbound-ttl.mjs';
import { h, localizeTemplate } from './i18n.js';
import { DEFAULT_IMAGE_INPUT_SETTINGS, normalizeImageInputSettings } from '../../src/channels/shared/image-input-policy.mjs';

export const GLOBAL_SETTINGS_RPC_CHANNEL = '/dsh-im-settings';

export const GLOBAL_SETTINGS_TAB_ID = 'global-settings';

const ATTACHMENTS_TAB_ID = 'dim-general-settings-tab-attachments';
const ATTACHMENTS_PANEL_ID = 'dim-general-settings-panel-attachments';
const DELIVERY_PANEL_ID = 'dim-general-settings-panel-delivery';

/** Tabs of the global settings page, in reading order. */
export const GLOBAL_SETTINGS_TABS = Object.freeze([
  { key: 'general', label: '通用' },
  { key: 'attachments', label: '附件' },
  { key: 'delivery', label: '投递' },
]);

export const GLOBAL_SETTINGS_ENDPOINTS = Object.freeze({
  getTtl: 'settings.inbound-ttl.get',
  setTtl: 'settings.inbound-ttl.set',
  sweep: 'settings.inbound-ttl.sweep',
  getImages: 'settings.image-input.get',
  setImages: 'settings.image-input.set',
});

function presentError(error, fallback) {
  return error?.message || fallback;
}

function unwrapRpcResult(result) {
  if (result?.ok === true) return result.value;
  if (result?.ok === false) {
    const error = new Error(result.error?.message || '请求失败，请稍后重试。');
    error.code = result.error?.code;
    throw error;
  }
  return result;
}

export function GlobalSettingsLogoGlyph({ size } = {}) {
  return h('svg', {
    ...(size === undefined ? {} : { width: size, height: size }),
    viewBox: '0 0 24 24',
    focusable: 'false',
    'aria-hidden': 'true',
    'data-im-icon': 'global-settings',
  }, h('path', {
    fill: 'currentColor',
    d: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.488.488 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58ZM12 15.6A3.61 3.61 0 0 1 8.4 12c0-1.98 1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6Z',
  }));
}

function GlobalButton({ children, kind = 'secondary', className = '', ...props }) {
  return h('button', {
    ...props,
    type: props.type ?? 'button',
    className: `dim-deliveryButton ${className}`.trim(),
    'data-kind': kind,
  }, children);
}

export function ImageInputSettings({ rpcCall }) {
  const [values, setValues] = React.useState(DEFAULT_IMAGE_INPUT_SETTINGS);
  const [phase, setPhase] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [saved, setSaved] = React.useState(false);
  const mounted = React.useRef(false);
  const saving = React.useRef(false);
  const id = React.useId();
  const load = React.useCallback(async (signal) => {
    setPhase('loading');
    setError(null);
    try {
      const result = unwrapRpcResult(await rpcCall(GLOBAL_SETTINGS_ENDPOINTS.getImages, {}, signal));
      if (signal?.aborted || !mounted.current) return;
      const settings = normalizeImageInputSettings(result);
      if (!settings) throw new Error('通用设置返回了无法识别的响应。');
      setValues(settings);
      setPhase('ready');
    } catch (caught) {
      if (signal?.aborted || !mounted.current) return;
      setError(presentError(caught, '无法读取或保存图片设置，请稍后重试。'));
      setPhase('error');
    }
  }, [rpcCall]);
  React.useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [load]);
  const save = async (event) => {
    event.preventDefault();
    if (saving.current || phase !== 'ready') return;
    const settings = normalizeImageInputSettings(values);
    setSaved(false);
    if (!settings) {
      setError('图片限制无效：请输入正整数，原图接收上限和总量上限不能小于单图上限。');
      return;
    }
    saving.current = true;
    setPhase('saving');
    setError(null);
    try {
      const result = unwrapRpcResult(await rpcCall(GLOBAL_SETTINGS_ENDPOINTS.setImages, settings));
      if (!normalizeImageInputSettings(result)) throw new Error('通用设置返回了无法识别的响应。');
      if (mounted.current) { setValues(result); setSaved(true); }
    } catch (caught) {
      if (mounted.current) setError(presentError(caught, '无法读取或保存图片设置，请稍后重试。'));
    } finally {
      saving.current = false;
      if (mounted.current) setPhase('ready');
    }
  };
  const fields = [
    ['maxDownloadMb', '原图接收上限 (MB)'],
    ['maxImageMb', '模型单图上限 (MB)'],
    ['maxTotalMb', '模型图片总量上限 (MB)'],
    ['maxImages', '每条消息最多图片数'],
  ];
  return h('section', { className: 'dim-globalSection dim-imageSettings', 'aria-label': '图片输入', 'aria-busy': phase === 'loading' || phase === 'saving' },
    h('div', { className: 'dim-globalHead' },
      h('div', { className: 'dim-globalHeadTitle' },
        h('h3', null, '图片输入'),
        h('div', { className: 'dim-globalTtlHelp' },
          h('button', {
            type: 'button',
            className: 'dim-channelHelpButton dim-globalTtlHelpButton',
            'aria-label': '查看图片输入说明',
            'aria-describedby': `${id}-help`,
          }, h('span', { 'aria-hidden': 'true' }, '?')),
          h('div', { id: `${id}-help`, className: 'dim-globalTtlTooltip dim-imageSettingsTooltip', role: 'tooltip' },
            '适用于支持图片的聊天渠道。原图按附件保留时长保存，发送给模型的副本会自动缩放或压缩；无法直接发送时交给模型按文件处理。')))),
    h('form', { onSubmit: save },
      h('div', { className: 'dim-imageSettingsFields' },
        ...fields.map(([key, label]) => h('div', { className: 'dim-imageSettingsField', key },
          h('label', { htmlFor: `${id}-${key}` }, label),
          h('input', { id: `${id}-${key}`, className: 'dim-globalTtlInput', type: 'number', min: 1, step: 1,
            value: values[key], disabled: phase !== 'ready',
            onChange: (event) => { setValues((current) => ({ ...current, [key]: event.target.value })); setSaved(false); setError(null); },
          })))),
      h('div', { className: 'dim-imageSettingsActions' },
        h(GlobalButton, { type: 'submit', kind: 'primary', className: 'dim-globalSaveButton', disabled: phase !== 'ready' }, phase === 'saving' ? '保存中…' : '保存图片设置'),
        phase === 'error' ? h(GlobalButton, { className: 'dim-globalSaveButton', onClick: () => void load() }, '重试') : null)),
    error ? h('p', { className: 'dim-globalInline dim-imageSettingsFeedback', 'data-tone': 'error', role: 'alert' }, error) : null,
    saved ? h('p', { className: 'dim-globalInline dim-imageSettingsFeedback', role: 'status' }, '已保存') : null,
    phase === 'loading' ? h('p', { className: 'dim-globalInline dim-imageSettingsFeedback', role: 'status' }, '正在读取图片设置…') : null);
}

function AttachmentSettingsPanel({ rpcCall }) {
  const [phase, setPhase] = React.useState('loading');
  const [loadError, setLoadError] = React.useState(null);
  const [ttlInput, setTtlInput] = React.useState('');
  const [savedTtl, setSavedTtl] = React.useState(null);
  const [ttlError, setTtlError] = React.useState(false);
  const [saveError, setSaveError] = React.useState(null);
  const [saveSucceeded, setSaveSucceeded] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [sweepConfirming, setSweepConfirming] = React.useState(false);
  const [sweeping, setSweeping] = React.useState(false);
  const ttlErrorId = React.useId();
  const ttlHintsId = React.useId();
  const sweepTriggerId = React.useId();
  const sweepConfirmId = React.useId();
  const sweepConfirmTextId = React.useId();
  const sweepConfirmButtonId = React.useId();
  const mounted = React.useRef(true);
  const saving = React.useRef(false);

  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== 'function') throw new Error('通用设置暂不可用。');
    return unwrapRpcResult(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);

  const loadSettings = React.useCallback(async ({ signal } = {}) => {
    setPhase('loading');
    setLoadError(null);
    try {
      const value = await invoke(GLOBAL_SETTINGS_ENDPOINTS.getTtl, {}, signal);
      if (signal?.aborted || !mounted.current) return;
      const ttlHours = normalizeInboundTtlHours(value?.ttlHours);
      if (ttlHours === null) {
        setLoadError('通用设置返回了无法识别的响应。');
        setPhase('error');
        return;
      }
      setSavedTtl(ttlHours);
      setTtlInput(String(ttlHours));
      setTtlError(false);
      setSaveError(null);
      setSaveSucceeded(false);
      setPhase('ready');
    } catch (caught) {
      if (signal?.aborted || caught?.name === 'AbortError' || !mounted.current) return;
      setLoadError(presentError(caught, '无法读取通用设置，请稍后重试。'));
      setPhase('error');
    }
  }, [invoke]);

  React.useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void loadSettings({ signal: controller.signal });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [loadSettings]);

  React.useEffect(() => {
    if (!sweepConfirming) return;
    globalThis.document?.getElementById(sweepConfirmButtonId)?.focus();
  }, [sweepConfirmButtonId, sweepConfirming]);

  const commitTtl = async () => {
    if (phase === 'loading' || saving.current) return;
    const proposed = normalizeInboundTtlHours(ttlInput.trim());
    if (proposed === null) {
      setSaveError(null);
      setSaveSucceeded(false);
      setTtlError(true);
      return;
    }
    setTtlError(false);
    if (proposed === savedTtl) return;
    saving.current = true;
    setIsSaving(true);
    setSaveError(null);
    setSaveSucceeded(false);
    try {
      const value = await invoke(GLOBAL_SETTINGS_ENDPOINTS.setTtl, { ttlHours: proposed });
      if (!mounted.current) return;
      const confirmed = normalizeInboundTtlHours(value?.ttlHours);
      const finalTtl = confirmed === null ? proposed : confirmed;
      setSavedTtl(finalTtl);
      // Never clobber the field if the user kept typing while the save was in flight.
      setTtlInput((current) => current.trim() === String(proposed) ? String(finalTtl) : current);
      setLoadError(null);
      setSaveSucceeded(true);
      setPhase('ready');
    } catch (caught) {
      if (mounted.current) {
        setSaveError(presentError(caught, '设置保存失败，请稍后重试。'));
      }
    } finally {
      saving.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };

  const requestSweep = () => {
    if (sweeping) return;
    setSweepConfirming(true);
  };

  const cancelSweep = ({ restoreFocus = false } = {}) => {
    setSweepConfirming(false);
    if (restoreFocus) globalThis.document?.getElementById(sweepTriggerId)?.focus();
  };

  const runSweep = async () => {
    setSweepConfirming(false);
    setSweeping(true);
    try {
      // Manual sweeps are silent by design: the busy label on the button is
      // the only feedback, and RPC results or failures are not announced.
      await invoke(GLOBAL_SETTINGS_ENDPOINTS.sweep, {});
    } catch {
      // Intentionally swallowed — no result feedback for manual sweeps.
    } finally {
      if (mounted.current) setSweeping(false);
    }
  };

  const inlineStatus = phase === 'loading'
    ? { role: 'status', message: '正在读取通用设置…' }
    : ttlError
      ? {
        role: 'alert',
        message: localizeTemplate('请输入 -1、0 或 1~{max} 之间的整数。', { max: INBOUND_TTL_MAX_HOURS }),
      }
      : saveError
        ? { role: 'alert', message: saveError }
        : phase === 'error' && loadError
          ? { role: 'alert', message: loadError }
          : saveSucceeded
            ? { role: 'status', message: '已保存' }
            : null;

  const proposedTtl = normalizeInboundTtlHours(ttlInput.trim());
  const canSave = phase !== 'loading'
    && !isSaving
    && proposedTtl !== null
    && proposedTtl !== savedTtl;

  return h('div', {
      id: ATTACHMENTS_PANEL_ID, className: 'dim-generalSettingsTabPanel',
      role: 'tabpanel', 'aria-labelledby': ATTACHMENTS_TAB_ID,
    },
    h('section', {
      className: 'dim-globalSection',
      'aria-label': '附件',
      'aria-busy': phase === 'loading',
    },
    h('div', { className: 'dim-globalHead' },
      h('div', { className: 'dim-globalHeadTitle' },
        h('h3', { id: 'dim-globalTtlTitle' }, '附件保留时长 (小时)'),
        h('div', { className: 'dim-globalTtlHelp' },
          h('button', {
            type: 'button',
            className: 'dim-channelHelpButton dim-globalTtlHelpButton',
            'aria-label': '查看附件保留时长说明',
            'aria-describedby': ttlHintsId,
          }, h('span', { 'aria-hidden': 'true' }, '?')),
          h('div', {
            id: ttlHintsId,
            className: 'dim-globalTtlTooltip',
            role: 'tooltip',
          },
          h('ul', { className: 'dim-globalTtlHints' },
            h('li', null,
              h('code', null, '-1'),
              h('span', null, '永久保留，不会自动清理')),
            h('li', null,
              h('code', null, '0'),
              h('span', null, '每 Turn 结束后立即清理')),
            h('li', null,
              h('code', null, `1~${INBOUND_TTL_MAX_HOURS}`),
              h('span', null, '小时后自动清理'))))))),
    h('form', {
      className: 'dim-globalTtlRow',
      onSubmit: (event) => {
        event.preventDefault();
        void commitTtl();
      },
    },
      h('input', {
        id: 'dim-globalTtlInput',
        className: 'dim-globalTtlInput',
        type: 'text',
        value: ttlInput,
        placeholder: String(DEFAULT_INBOUND_TTL_HOURS),
        autoComplete: 'off',
        disabled: phase === 'loading' || isSaving,
        'aria-labelledby': 'dim-globalTtlTitle',
        'aria-invalid': ttlError ? 'true' : undefined,
        'aria-describedby': ttlError ? ttlErrorId : ttlHintsId,
        onBlur: () => {
          setTtlError(normalizeInboundTtlHours(ttlInput.trim()) === null);
        },
        onKeyDown: (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void commitTtl();
        },
        onChange: (event) => {
          setTtlInput(event.target.value);
          setTtlError(false);
          setSaveError(null);
          setSaveSucceeded(false);
        },
      }),
      h(GlobalButton, {
        type: 'submit',
        kind: 'primary',
        className: 'dim-globalSaveButton',
        disabled: !canSave,
      }, isSaving ? '保存中…' : '保存'),
      h('div', {
        className: 'dim-globalSweepAction',
        onBlur: (event) => {
          if (sweepConfirming && !event.currentTarget.contains(event.relatedTarget)) cancelSweep();
        },
      },
      h(GlobalButton, {
        id: sweepTriggerId,
        className: 'dim-globalSweepButton',
        onClick: () => (sweepConfirming ? cancelSweep() : requestSweep()),
        disabled: sweeping,
        'aria-haspopup': 'dialog',
        'aria-expanded': sweepConfirming,
        'aria-controls': sweepConfirmId,
      }, sweeping ? '正在清理…' : '清理过期附件'),
      sweepConfirming
        ? h('div', {
          id: sweepConfirmId,
          className: 'dim-globalSweepConfirm',
          role: 'alertdialog',
          'aria-label': '确认清理过期附件',
          'aria-describedby': sweepConfirmTextId,
          onKeyDown: (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            cancelSweep({ restoreFocus: true });
          },
        },
        h('p', { id: sweepConfirmTextId }, '确认清理当前已过期的附件？'),
        h('div', { className: 'dim-globalSweepConfirmActions' },
          h(GlobalButton, { onClick: () => cancelSweep({ restoreFocus: true }) }, '取消'),
          h(GlobalButton, {
            id: sweepConfirmButtonId,
            kind: 'danger',
            className: 'dim-globalSweepConfirmButton',
            onClick: () => void runSweep(),
          }, '确认清理')))
        : null),
      inlineStatus
        ? h('p', {
          id: ttlErrorId,
          className: 'dim-globalInline',
          'data-tone': inlineStatus.role === 'alert' ? 'error' : undefined,
          role: inlineStatus.role,
          'aria-live': inlineStatus.role === 'status' ? 'polite' : undefined,
        }, inlineStatus.message)
        : null)),
    h(ImageInputSettings, { rpcCall }));
}

export function GlobalSettingsPanel({ rpcCall, deliverySyncRpcCall = null, languageRpcCall = null }) {
  const [tab, setTab] = React.useState('general');
  const tabs = GLOBAL_SETTINGS_TABS;
  const selectTab = (next) => {
    setTab(next);
    globalThis.document?.getElementById(`dim-general-settings-tab-${next}`)?.focus();
  };
  const step = (key) => {
    const at = tabs.findIndex((item) => item.key === tab);
    if (key === 'Home') return tabs[0].key;
    if (key === 'End') return tabs[tabs.length - 1].key;
    const delta = key === 'ArrowLeft' ? -1 : 1;
    return tabs[(at + delta + tabs.length) % tabs.length].key;
  };
  const panel = tab === 'attachments'
    ? h(AttachmentSettingsPanel, { rpcCall })
    : tab === 'delivery'
      ? h('div', {
        id: DELIVERY_PANEL_ID,
        className: 'dim-generalSettingsTabPanel',
        role: 'tabpanel',
        'aria-labelledby': `dim-general-settings-tab-delivery`,
      }, h(DeliverySyncSettings, {
        // This page has its own management channel: falling back to the
        // loopback-only settings call would hide a missing channel behind a
        // request the panel cannot actually use.
        rpcCall: deliverySyncRpcCall,
        languageRpcCall,
      }))
      : h('div', {
        id: 'dim-general-settings-panel-general',
        className: 'dim-generalSettingsTabPanel',
        role: 'tabpanel',
        'aria-labelledby': 'dim-general-settings-tab-general',
      }, h(SidebarSettings, { rpcCall }), h(GroupHistorySettings, { rpcCall }));
  return h('section', { className: 'dim-generalSettingsPage', 'aria-label': '通用设置' },
    h('header', { className: 'dim-generalSettingsHeader' }, h('h2', null, '通用设置')),
    h('div', { className: 'dim-generalSettingsTabsBar' },
      h('div', { className: 'dim-generalSettingsTabs', role: 'tablist', 'aria-label': '通用设置分类' },
        ...tabs.map((item) => h('button', {
          key: item.key, type: 'button', id: `dim-general-settings-tab-${item.key}`,
          className: 'dim-generalSettingsTab', role: 'tab', 'aria-selected': tab === item.key,
          'aria-controls': `dim-general-settings-panel-${item.key}`, tabIndex: tab === item.key ? 0 : -1,
          onClick: () => setTab(item.key), onKeyDown: (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            selectTab(step(event.key));
          },
        }, item.label)))),
    panel);
}
