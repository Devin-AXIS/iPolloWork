import * as React from 'react';

import { h, localizeTemplate } from '../../i18n.js';
import {
  FEISHU_ENDPOINTS,
  FEISHU_REGISTRATION_OPERATIONS,
  formatRemaining,
  normalizeBotsSnapshot,
  normalizeGroupResponseMode,
  normalizePollResult,
  normalizeProvisioning,
  presentError,
  unwrapRpcResult,
} from './api.js';

const GROUP_MESSAGE_PERMISSION_OPERATION = FEISHU_REGISTRATION_OPERATIONS.GROUP_MESSAGE_PERMISSION;

function SettingsButton({ children, kind = 'secondary', className = '', ...props }) {
  return h('button', {
    ...props,
    type: 'button',
    className: `dim-deliveryButton ${className}`.trim(),
    'data-kind': kind,
  }, children);
}

function groupSettingsFrom(value) {
  return {
    groupResponseMode: normalizeGroupResponseMode(value?.groupResponseMode),
    mentionTopicReply: value?.mentionTopicReply !== false,
    groupMessagePermissionGranted: value?.groupMessagePermissionGranted === true,
  };
}

function targetBotFromSnapshot(value, botId) {
  const snapshot = normalizeBotsSnapshot(value);
  const bot = snapshot.bots.find((entry) => entry.botId === botId);
  if (!bot) throw new Error('飞书服务没有返回当前机器人的设置');
  return { snapshot, bot };
}

function safeVerificationHref(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && [
        'accounts.feishu.cn',
        'accounts.larksuite.com',
        'open.feishu.cn',
        'open.larksuite.com',
      ].includes(url.hostname)
      && !url.port
      && !url.username
      && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeQrSource(value) {
  if (!value) return undefined;
  return /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value)
    ? value
    : undefined;
}

function QrPlaceholder() {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: 50,
    height: 50,
    fill: 'currentColor',
    'aria-hidden': 'true',
  }, h('path', {
    d: 'M3 3h7v7H3V3Zm2 2v3h3V5H5Zm9-2h7v7h-7V3Zm2 2v3h3V5h-3ZM3 14h7v7H3v-7Zm2 2v3h3v-3H5Zm9-2h3v3h-3v-3Zm4 0h3v7h-3v-3h-2v3h-2v-5h4v-2Z',
  }));
}

export function GroupResponseModeEditor({
  value,
  permissionGranted = false,
  disabled = false,
  authorizationDisabled = false,
  onSave,
  onAuthorize,
}) {
  const current = normalizeGroupResponseMode(value);
  const [saving, setSaving] = React.useState(false);
  const [authorizing, setAuthorizing] = React.useState(false);
  const [error, setError] = React.useState(null);

  const change = async (event) => {
    const next = normalizeGroupResponseMode(event.target.value);
    if (next === current || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(next);
    } catch (cause) {
      setError(cause?.message ?? '群聊响应方式修改失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const authorize = async () => {
    if (saving || authorizing || disabled || authorizationDisabled) return;
    setAuthorizing(true);
    setError(null);
    try {
      await onAuthorize?.({ preserveResponseMode: current !== 'all' });
    } catch (cause) {
      setError(cause?.message ?? '群消息权限授权失败，请重试。');
    } finally {
      setAuthorizing(false);
    }
  };

  return h('section', {
    className: 'dim-feishuGroupControl',
    'aria-labelledby': 'dim-feishu-group-response-title',
  },
  h('div', { className: 'dim-feishuGroupControlHeader' },
    h('h3', { id: 'dim-feishu-group-response-title' }, '群聊响应方式'),
    saving || authorizing
      ? h('span', { className: 'dim-feishuGroupControlStatus', role: 'status' },
          saving ? '保存中…' : '正在准备授权…')
      : null),
  h('select', {
    className: 'dim-feishuGroupSelect',
    value: current,
    disabled: disabled || saving,
    'aria-label': '群聊响应方式',
    onChange: (event) => { void change(event); },
  },
  h('option', { value: 'mention' }, '仅在 @机器人时响应（推荐）'),
  h('option', { value: 'all' }, '响应所有群消息')),
  h('p', { className: 'dim-feishuGroupHelp' },
    current === 'mention'
      ? permissionGranted
        ? '私聊始终响应；群聊仅处理明确 @当前机器人的消息。群消息权限已开通，再次切换无需授权。'
        : '私聊始终响应；群聊仅处理明确 @当前机器人的消息。也可单独授权采集群消息，保持仅 @ 时回复。'
      : permissionGranted
        ? '已开通“获取群组中所有消息”权限（im:message.group_msg）；机器人会处理群聊中的所有可见消息。'
        : '尚未确认“获取群组中所有消息”权限，请完成飞书授权。'),
  (current === 'all' || !permissionGranted)
    ? h('div', { className: 'dim-feishuGroupPermissionAction' },
        h(SettingsButton, {
          disabled: disabled || authorizationDisabled || saving || authorizing,
          'aria-busy': authorizing ? 'true' : undefined,
          'aria-label': permissionGranted ? '重新授权群消息权限' : '授权群消息权限',
          onClick: () => { void authorize(); },
        }, authorizing ? '正在准备…' : permissionGranted ? '重新授权' : '去授权'))
    : null,
  error ? h('p', {
    className: 'dim-feishuGroupError',
    role: 'alert',
  }, error) : null);
}

export function MentionTopicReplyEditor({ value = true, disabled = false, onSave }) {
  const current = value === true ? 'on' : 'off';
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const change = async (event) => {
    const next = event.target.value === 'on';
    if ((next ? 'on' : 'off') === current || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(next);
    } catch (cause) {
      setError(cause?.message ?? '以话题方式回复设置保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  return h('section', {
    className: 'dim-feishuGroupControl',
    'aria-labelledby': 'dim-feishu-mention-topic-title',
  },
  h('div', { className: 'dim-feishuGroupControlHeader' },
    h('h3', { id: 'dim-feishu-mention-topic-title' }, '被 @ 时以话题方式回复'),
    saving
      ? h('span', { className: 'dim-feishuGroupControlStatus', role: 'status' }, '保存中…')
      : null),
  h('select', {
    className: 'dim-feishuGroupSelect',
    value: current,
    disabled: disabled || saving,
    'aria-label': '被 @ 时以话题方式回复',
    onChange: (event) => { void change(event); },
  },
  h('option', { value: 'off' }, '关闭（在会话主窗口回复）'),
  h('option', { value: 'on' }, '开启（自动开启独立飞书话题）')),
  h('p', { className: 'dim-feishuGroupHelp' },
    '开启后，在群聊或私聊里 @机器人 提问，机器人会在那条消息下新建一个飞书话题并在话题内回答；该话题是一条独立会话，话题里的后续消息都属于同一个会话。只发一个 @机器人（打开菜单）不会新建话题，没有 @机器人 的消息也留在原来的会话里。'),
  error ? h('p', {
    className: 'dim-feishuGroupError',
    role: 'alert',
  }, error) : null);
}

function PermissionFlow({ provision, now, busy, botName, onRetry, onCancel, onClose }) {
  if (!provision) return null;
  const phase = provision.phase;
  const error = provision.error;

  if (phase === 'creating' || phase === 'connecting') {
    return h('section', {
      className: 'dim-feishuGroupAuthorization dim-feishuGroupAuthorizationState',
      'aria-live': 'polite',
      'aria-busy': 'true',
    },
    h('span', { className: 'dim-feishuGroupSpinner', 'aria-hidden': 'true' }),
    h('div', null,
      h('h3', null, phase === 'creating'
        ? '正在准备权限授权二维码'
        : '已确认，正在启用全部消息模式'),
      h('p', null, phase === 'creating'
        ? '正在为现有飞书应用申请群消息权限二维码，请稍候。'
        : '权限配置已提交，正在保存设置并重连此机器人；此阶段无法取消，其他机器人不会中断。')));
  }

  if (phase === 'error') {
    return h('section', {
      className: 'dim-feishuGroupAuthorization dim-feishuGroupAuthorizationError',
      role: 'alert',
    },
    h('div', null,
      h('h3', null, '群消息权限没有开通完成'),
      h('p', null, error?.message ?? '群消息权限授权失败，请重试。'),
      error?.code ? h('code', null, error.code) : null),
    h('div', { className: 'dim-feishuGroupAuthorizationActions' },
      h(SettingsButton, { kind: 'primary', onClick: onRetry, disabled: busy },
        busy ? '正在准备…' : '重新生成二维码'),
      h(SettingsButton, { onClick: onClose, disabled: busy }, '关闭')));
  }

  const qrSource = safeQrSource(provision.qrCodeDataUrl);
  const href = safeVerificationHref(provision.verificationUrl);
  const remaining = Math.max(0, (provision.expiresAt ?? now) - now);
  const expired = provision.expired === true || remaining === 0;
  const progress = Math.min(1, remaining / Math.max(1, provision.durationMs ?? remaining));

  return h('section', {
    className: 'dim-feishuGroupAuthorization',
    'aria-label': localizeTemplate('{bot}的飞书授权流程', { bot: botName }),
  },
  h('div', { className: 'dim-feishuGroupQrColumn' },
    h('div', { className: 'dim-feishuGroupQrFrame' },
      qrSource
        ? h('img', {
            src: qrSource,
            alt: localizeTemplate('用于为{bot}开通群消息权限的一次性授权二维码', { bot: botName }),
          })
        : h('div', { className: 'dim-feishuGroupQrFallback' },
            h(QrPlaceholder), h('span', null, '二维码未就绪，请打开授权链接')),
      expired
        ? h('div', { className: 'dim-feishuGroupQrExpired', role: 'status' },
            h('span', null, '二维码已失效'), h('small', null, '请刷新后重新扫码'))
        : null),
    h('div', {
      className: 'dim-feishuGroupCountdown',
      'aria-label': expired ? '二维码已失效' : localizeTemplate('二维码剩余 {remaining}', { remaining: formatRemaining(remaining) }),
    },
    h('span', null, expired ? '等待刷新' : '二维码有效时间'),
    h('strong', null, formatRemaining(remaining)),
    h('span', { className: 'dim-feishuGroupProgress', 'aria-hidden': 'true' },
      h('span', { style: { width: `${Math.round(progress * 100)}%` } })))),
  h('div', { className: 'dim-feishuGroupAuthorizationCopy' },
    h('span', { className: 'dim-feishuGroupAuthorizationEyebrow' },
      localizeTemplate('正在为「{bot}」开通群消息权限', { bot: botName })),
    h('h3', null, expired ? '刷新二维码后继续' : '使用飞书确认群消息权限'),
    h('p', null,
      '扫码会更新现有飞书应用，只增量开通“获取群组中所有消息”权限，不会创建新应用。单独授权采集时保留原来的回复方式；选择响应所有消息时才切换。'),
    h('ol', null,
      h('li', null, '打开飞书移动端，使用扫一扫读取二维码'),
      h('li', null, '核对现有应用，并确认“获取群组中所有消息”权限'),
      h('li', null, '保持本页打开，等待权限生效')),
    h('div', { className: 'dim-feishuGroupAuthorizationActions' },
      expired
        ? h(SettingsButton, { kind: 'primary', onClick: onRetry, disabled: busy },
            busy ? '刷新中…' : '刷新二维码')
        : href
          ? h('a', {
              className: 'dim-deliveryButton dim-feishuGroupAuthorizationLink',
              href,
              target: '_blank',
              rel: 'noopener noreferrer',
            }, '在飞书中打开')
          : null,
      !expired
        ? h(SettingsButton, { onClick: onRetry, disabled: busy }, '换一个二维码')
        : null,
      h(SettingsButton, { onClick: onCancel, disabled: busy }, '取消授权'))));
}

export function FeishuGroupSettingsPage({ account, rpcCall }) {
  const [settings, setSettings] = React.useState(() => groupSettingsFrom(account));
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState(null);
  const [provision, setProvision] = React.useState(null);
  const [provisionBusy, setProvisionBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const mounted = React.useRef(true);

  React.useEffect(() => {
    setSettings(groupSettingsFrom(account));
  }, [
    account.botId,
    account.groupResponseMode,
    account.mentionTopicReply,
    account.groupMessagePermissionGranted,
  ]);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== 'function') throw new Error('飞书群聊设置暂不可用。');
    return unwrapRpcResult(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);

  const applySnapshot = React.useCallback((value) => {
    const result = targetBotFromSnapshot(value, account.botId);
    if (mounted.current) setSettings(groupSettingsFrom(result.bot));
    return result;
  }, [account.botId]);

  const loadSettings = React.useCallback(async ({ signal, restoreProvisioning = false } = {}) => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const value = await invoke(FEISHU_ENDPOINTS.status, {}, signal);
      if (signal?.aborted || !mounted.current) return undefined;
      const result = applySnapshot(value);
      if (restoreProvisioning) {
        const active = result.snapshot.provisioning;
        if (active?.operation === GROUP_MESSAGE_PERMISSION_OPERATION
          && active.botId === account.botId) {
          const timestamp = Date.now();
          setNow(timestamp);
          setProvision({
            phase: active.submitted ? 'connecting' : 'qr',
            ...active,
            durationMs: Math.max(1, active.expiresAt - timestamp),
            expired: !active.submitted && active.expiresAt <= timestamp,
          });
        }
      }
      return result.bot;
    } catch (cause) {
      if (signal?.aborted || cause?.name === 'AbortError' || !mounted.current) return undefined;
      setRefreshError(presentError(cause));
      return undefined;
    } finally {
      if (!signal?.aborted && mounted.current) setRefreshing(false);
    }
  }, [account.botId, applySnapshot, invoke]);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadSettings({ signal: controller.signal, restoreProvisioning: true });
    return () => controller.abort();
  }, [loadSettings]);

  const saveSetting = React.useCallback(async (endpoint, payload) => {
    const value = await invoke(endpoint, { botId: account.botId, ...payload });
    applySnapshot(value);
  }, [account.botId, applySnapshot, invoke]);

  const startAuthorization = React.useCallback(async ({ replace = false, preserveResponseMode = provision?.preserveResponseMode === true } = {}) => {
    if (provisionBusy) return;
    const previousAttemptId = provision?.attemptId;
    setProvisionBusy(true);
    setProvision({ phase: 'creating', operation: GROUP_MESSAGE_PERMISSION_OPERATION, botId: account.botId });
    try {
      if (replace && previousAttemptId) {
        try {
          await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId: previousAttemptId });
        } catch {
          // Starting a new authoritative attempt is safe if the old browser
          // attempt disappeared during a Host restart.
        }
      }
      const normalized = normalizeProvisioning(await invoke(
        FEISHU_ENDPOINTS.beginGroupMessagePermission,
        { botId: account.botId, ...(preserveResponseMode ? { preserveResponseMode: true } : {}) },
      ));
      if (normalized.operation !== GROUP_MESSAGE_PERMISSION_OPERATION
        || normalized.botId !== account.botId) {
        throw new Error('飞书服务返回了不匹配的群消息权限二维码');
      }
      const timestamp = Date.now();
      if (!mounted.current) return;
      setNow(timestamp);
      setProvision({
        phase: normalized.submitted ? 'connecting' : 'qr',
        ...normalized,
        preserveResponseMode,
        durationMs: Math.max(1, normalized.expiresAt - timestamp),
        expired: false,
      });
    } catch (cause) {
      if (!mounted.current) return;
      setProvision({
        phase: 'error',
        operation: GROUP_MESSAGE_PERMISSION_OPERATION,
        botId: account.botId,
        ...(previousAttemptId ? { attemptId: previousAttemptId } : {}),
        error: presentError(cause),
      });
    } finally {
      if (mounted.current) setProvisionBusy(false);
    }
  }, [account.botId, invoke, provision?.attemptId, provisionBusy]);

  const finishAuthorization = React.useCallback(async (signal) => {
    const bot = await loadSettings({ signal, restoreProvisioning: false });
    if (signal?.aborted || !mounted.current) return;
    if (!bot) throw new Error('群消息权限已更新，但暂时无法确认机器人连接状态');
    setProvision(null);
  }, [loadSettings]);

  React.useEffect(() => {
    if (!provision?.attemptId
      || !['qr', 'connecting'].includes(provision.phase)
      || provision.expired) return undefined;
    const timerHost = globalThis.window ?? globalThis;
    const controller = new AbortController();
    const timer = timerHost.setTimeout(async () => {
      try {
        const result = normalizePollResult(await invoke(
          FEISHU_ENDPOINTS.pollProvisioning,
          { attemptId: provision.attemptId },
          controller.signal,
        ));
        if (result.operation !== GROUP_MESSAGE_PERMISSION_OPERATION
          || result.botId !== account.botId) {
          throw new Error('飞书服务返回了不匹配的注册进度');
        }
        if (result.status === 'connected') {
          await finishAuthorization(controller.signal);
          return;
        }
        if (result.status === 'failed') {
          const error = new Error(result.message ?? '飞书群消息权限开通失败');
          error.code = 'FEISHU_PROVISION_FAILED';
          throw error;
        }
        if (result.status === 'expired') {
          if (mounted.current) setProvision((current) => current?.attemptId === provision.attemptId
            ? { ...current, phase: 'qr', expired: true }
            : current);
          return;
        }
        if (mounted.current) {
          setProvision((current) => current?.attemptId === provision.attemptId
            ? {
                ...current,
                ...(result.provisioning ?? {}),
                phase: ['scanned', 'connecting'].includes(result.status) ? 'connecting' : 'qr',
              }
            : current);
        }
      } catch (cause) {
        if (controller.signal.aborted || cause?.name === 'AbortError' || !mounted.current) return;
        setProvision((current) => current?.attemptId === provision.attemptId
          ? { ...current, phase: 'error', error: presentError(cause) }
          : current);
      }
    }, provision.pollIntervalMs ?? 1_800);
    return () => {
      controller.abort();
      timerHost.clearTimeout(timer);
    };
  }, [account.botId, finishAuthorization, invoke, provision]);

  React.useEffect(() => {
    if (!provision?.attemptId || provision.phase !== 'qr' || provision.expired) return undefined;
    const timerHost = globalThis.window ?? globalThis;
    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= provision.expiresAt) {
        setProvision((current) => current?.attemptId === provision.attemptId
          ? { ...current, expired: true }
          : current);
      }
    };
    tick();
    const timer = timerHost.setInterval(tick, 1_000);
    return () => timerHost.clearInterval(timer);
  }, [provision?.attemptId, provision?.expired, provision?.expiresAt, provision?.phase]);

  const cancelAuthorization = React.useCallback(async () => {
    if (!provision?.attemptId || provisionBusy) {
      setProvision(null);
      return;
    }
    setProvisionBusy(true);
    try {
      const result = normalizePollResult(await invoke(
        FEISHU_ENDPOINTS.cancelProvisioning,
        { attemptId: provision.attemptId },
      ));
      if (result.operation !== GROUP_MESSAGE_PERMISSION_OPERATION
        || result.botId !== account.botId) {
        throw new Error('飞书服务返回了不匹配的注册进度');
      }
      if (result.status === 'connecting') {
        setProvision((current) => ({ ...current, phase: 'connecting', submitted: true }));
        return;
      }
      if (result.status === 'connected') {
        await finishAuthorization();
        return;
      }
      setProvision(null);
      await loadSettings({ restoreProvisioning: false });
    } catch (cause) {
      if (mounted.current) {
        setProvision((current) => ({ ...current, phase: 'error', error: presentError(cause) }));
      }
    } finally {
      if (mounted.current) setProvisionBusy(false);
    }
  }, [account.botId, finishAuthorization, invoke, loadSettings, provision, provisionBusy]);

  const disabled = refreshing || Boolean(provision);
  return h('section', {
    className: 'dim-feishuGroupSettings',
    'aria-label': '群聊设置',
  },
  refreshError ? h('p', {
    className: 'dim-feishuGroupRefreshError',
    role: 'alert',
  }, refreshError.message) : null,
  h('div', { className: 'dim-feishuGroupControls' },
    h(GroupResponseModeEditor, {
      value: settings.groupResponseMode,
      permissionGranted: settings.groupMessagePermissionGranted,
      disabled,
      authorizationDisabled: provisionBusy,
      onSave: async (groupResponseMode) => {
        if (groupResponseMode === 'all' && !settings.groupMessagePermissionGranted) {
          await startAuthorization();
          return;
        }
        await saveSetting(FEISHU_ENDPOINTS.setGroupResponseMode, { groupResponseMode });
      },
      onAuthorize: (options) => startAuthorization(options),
    }),
    h(MentionTopicReplyEditor, {
      value: settings.mentionTopicReply,
      disabled,
      onSave: (mentionTopicReply) => saveSetting(
        FEISHU_ENDPOINTS.setMentionTopicReply,
        { mentionTopicReply },
      ),
    })),
  h(PermissionFlow, {
    provision,
    now,
    busy: provisionBusy,
    botName: account.botName || '当前机器人',
    onRetry: () => { void startAuthorization({ replace: true }); },
    onCancel: () => { void cancelAuthorization(); },
    onClose: () => {
      setProvision(null);
      void loadSettings({ restoreProvisioning: true });
    },
  }));
}
