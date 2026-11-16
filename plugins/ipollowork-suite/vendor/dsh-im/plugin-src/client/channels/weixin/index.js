import { WeixinConnectionError, provisioningErrorTitle } from './connection-error.js';
import { BotName } from '../../bot-alias.js';
import * as React from 'react';

import { WeixinLogoGlyph } from '../../channel-logos.js';
import { QrActionIcon } from '../../credential-binding.js';
import { AccountSettingsToggle, CollapsibleAccountSection } from '../shared/collapsible-account.js';
import { h, localizeTemplate } from '../../i18n.js';
import {
  WEIXIN_ENDPOINTS,
  managementRequestError,
  formatRemaining,
  normalizeProvisioning,
  normalizeSnapshot,
  presentError,
  safeQrSource,
  safeVerificationUrl,
  unwrapRpcResult,
} from './api.js';
import { createPollScheduler, useAnimationFrameScheduler } from '../../lifecycle.js';
import { WorkspaceEditor } from '../../workspace-editor.js';
import { ContextEnhancementEditor } from '../../context-enhancement.js';
import {
  AgentPresetCatalogContext,
  AgentPresetEditor,
  EMPTY_AGENT_PRESET_CATALOG,
} from '../../agent-preset.js';
import {
  EMPTY_MODEL_CATALOG,
  ModelCatalogContext,
  ModelEditor,
} from '../../model-setting.js';
import { useWorkspaceSnapshotFence } from '../../workspace-snapshot-fence.js';
import {
  BotSettingsButton,
  BotStatusMeta,
  ChannelListHeading,
  LastMessageErrorSummary,
} from '../../channel-card-meta.js';
const Button = React.forwardRef(function Button(
  { children, kind = 'secondary', className = '', ...props },
  ref,
) {
  return h('button', {
    ...props,
    ref,
    type: 'button',
    className: `dxw-button ${className}`.trim(),
    'data-kind': kind,
  }, children);
});

function Heading({ totals, adding, busy, onAdd, addButtonRef }) {
  return h('div', { className: 'dxw-heading' },
    h('div', { className: 'dxw-tools' },
      h(Button, {
        kind: 'primary',
        className: 'dim-scanButton',
        onClick: onAdd,
        disabled: adding || busy,
        ref: addButtonRef,
        'aria-label': '扫码接入微信机器人',
      }, h(QrActionIcon), adding ? '正在接入' : '扫码接入机器人'),
      totals.configured > 0
        ? h('div', { className: 'dxw-badge dim-onlineBadge' },
            h('span', null, localizeTemplate('{connected} / {configured} 在线', { connected: totals.connected, configured: totals.configured })))
        : null,
    ),
  );
}

function LoadingView() {
  return h('div', { className: 'dxw-card dxw-loading dim-surfaceCard dim-loadingView', 'aria-busy': 'true' },
    h('div', { className: 'dxw-spinner dim-spinner' }),
    h('span', null, '正在读取微信连接状态…'));
}

function EmptyView({ onStart, busy }) {
  return h('div', { className: 'dxw-card dim-surfaceCard' },
    h('div', { className: 'dxw-cardBody dxw-empty dim-surfaceBody dim-emptyView' },
      h('div', { className: 'dim-emptyCopy' },
        h('div', { className: 'dxw-stateLabel dim-stateLabel' },
          h('span', { className: 'dxw-dot dim-stateDot' }), h('span', null, '尚未绑定微信')),
        h('h3', null, '扫一次码，就能在微信里使用 Harness'),
        h('p', null, '二维码由腾讯微信 iLink 服务签发。用手机微信扫描并确认后，账号凭据会直接写入 Harness Host，浏览器不会收到 bot_token。'),
        h('div', { className: 'dxw-actions dim-viewActions' },
          h(Button, { kind: 'primary', onClick: onStart, disabled: busy },
            busy ? '正在生成二维码…' : '生成微信二维码')),
      ),
      h('div', { className: 'dxw-logo dim-emptyBrand', 'aria-hidden': 'true' }, h(WeixinLogoGlyph, { size: 64 })),
    ));
}

function QrPanel({ provision, now, busy, onRefresh, onCancel }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const source = safeQrSource(provision.qrCodeDataUrl);
  const href = safeVerificationUrl(provision.verificationUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = remaining === 0 || provision.status === 'expired';
  const duration = Math.max(1, provision.durationMs ?? 5 * 60_000);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);
  React.useEffect(() => setImageFailed(false), [source]);

  return h('div', { className: 'dxw-card dim-surfaceCard' },
    h('div', { className: 'dxw-cardBody dxw-qrLayout dim-surfaceBody dim-qrLayout' },
      h('div', { className: 'dxw-qrColumn dim-qrColumn' },
        h('div', { className: 'dxw-qrFrame dim-qrFrame' },
          source && !imageFailed
            ? h('img', {
                src: source,
                alt: '用于把微信机器人绑定到 DeepSeek Harness 的一次性二维码',
                onError: () => setImageFailed(true),
              })
            : h('div', { className: 'dxw-qrFallback dim-qrFallback' }, '二维码图片未就绪，请使用备用链接。'),
          expired ? h('div', { className: 'dxw-expired dim-qrExpired' }, '二维码已过期\n请重新生成') : null,
        ),
        h('div', { className: 'dxw-countdown dim-countdown' },
          h('div', { className: 'dim-countdownTop' }, h('span', null, '二维码有效时间'), h('strong', null, formatRemaining(remaining))),
          h('div', { className: 'dxw-progress dim-progress', 'aria-hidden': 'true' },
            h('span', { style: { '--dxw-progress': `${progress}%` } })),
        )),
      h('div', { className: 'dxw-qrCopy dim-qrCopy' },
        h('div', { className: 'dxw-stateLabel dim-stateLabel' },
          h('span', { className: 'dxw-dot dim-stateDot', 'data-tone': provision.status === 'scanned' ? 'success' : 'warning' }),
          h('span', null, provision.status === 'scanned' ? '已扫码，请在手机上确认' : '等待微信扫码')),
        h('h3', null, expired ? '二维码已失效' : '使用手机微信扫描二维码'),
        h('p', null, '请在手机上核对并确认授权。部分账号会额外显示一个配对数字，页面会在需要时提示输入。'),
        h('ol', { className: 'dxw-steps dim-steps' },
          h('li', null, '打开手机微信并扫描左侧二维码'),
          h('li', null, '在微信中确认连接该机器人'),
          h('li', null, '保持本页打开，等待消息长轮询变为在线')),
        h('div', { className: 'dxw-actions dim-viewActions' },
          expired
            ? h(Button, { kind: 'primary', onClick: onRefresh, disabled: busy }, '重新生成二维码')
            : null,
          href ? h('a', {
            className: 'dxw-button', href, target: '_blank', rel: 'noopener noreferrer',
          }, '打开备用链接') : null,
          !expired ? h(Button, { onClick: onRefresh, disabled: busy }, '换一个二维码') : null,
          h(Button, { onClick: onCancel, disabled: busy }, '取消')),
      ),
    ));
}

function VerificationPanel({ provision, busy, onSubmit, onCancel }) {
  const [code, setCode] = React.useState('');
  const valid = /^\d{4,8}$/.test(code);
  React.useEffect(() => setCode(''), [provision.attemptId]);
  return h('div', { className: 'dxw-card dim-surfaceCard' },
    h('form', {
      className: 'dxw-verify dim-specialView',
      onSubmit: (event) => {
        event.preventDefault();
        if (valid && !busy) onSubmit(code);
      },
    },
    h('div', { className: 'dxw-stateLabel' },
      h('span', { className: 'dxw-dot', 'data-tone': 'warning' }), h('span', null, '需要配对码')),
    h('h3', null, '输入手机微信显示的数字'),
    h('p', null, '这是微信附加的安全确认步骤。配对码只用于本次扫码轮询，不会写入配置或日志。'),
    h('div', { className: 'dxw-codeRow' },
      h('input', {
        className: 'dxw-input',
        value: code,
        inputMode: 'numeric',
        autoComplete: 'one-time-code',
        maxLength: 8,
        'aria-label': '微信配对码',
        onChange: (event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8)),
        autoFocus: true,
      }),
      h('button', {
        type: 'submit',
        className: 'dxw-button',
        'data-kind': 'primary',
        disabled: !valid || busy,
      }, busy ? '正在验证…' : '继续连接')),
    h(Button, { onClick: onCancel, disabled: busy }, '取消绑定')));
}

function ProgressPanel({ scanned, onCancel, busy }) {
  return h('div', { className: 'dxw-card dxw-loading dim-surfaceCard dim-loadingView', 'aria-busy': 'true' },
    h('div', { className: 'dxw-spinner dim-spinner' }),
    h('h3', null, scanned ? '微信已确认，正在启动消息连接' : '正在准备微信二维码'),
    h('p', null, scanned ? '正在保存凭据并验证 Harness 与微信长轮询。' : '正在联系腾讯微信 iLink 服务。'),
    onCancel ? h('div', { className: 'dxw-actions dim-viewActions', style: { justifyContent: 'center', marginTop: 14 } },
      h(Button, { onClick: onCancel, disabled: busy }, '取消')) : null);
}

function ProvisionError({ provision, busy, onRetry, onClose }) {
  const error = provision.error ?? { code: 'WEIXIN_PROVISION_FAILED', message: '微信绑定没有完成' };
  return h('div', { className: 'dxw-card dim-surfaceCard' },
    h('div', { className: 'dxw-error dim-inlineError', role: 'alert' },
      h('h3', null, provision.status === 'expired' ? '二维码已过期' : provisioningErrorTitle(error)),
      h(WeixinConnectionError, { error }),
      h('div', { className: 'dxw-actions dim-viewActions' },
        h(Button, { kind: 'primary', onClick: onRetry, disabled: busy }, '重新生成二维码'),
        h(Button, { onClick: onClose, disabled: busy }, '关闭'))));
}

function checkedTime(timestamp) {
  if (!timestamp) return '尚未检查';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '刚刚';
  }
}

export function AccountCard({
  account,
  busy,
  feedback,
  removing,
  onReconnect,
  onWorkspaceSave,
  onAliasSave,
  onModelSave,
  onAgentPresetSave,
  onContextEnhancementSave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
}) {
  const state = busy === 'reconnect' ? 'connecting' : account.state;
  const tone = account.connected ? 'success' : state === 'error' ? 'error' : 'warning';
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h('article', { className: 'dxw-card dim-botCard', tabIndex: -1, 'data-bot-id': account.botId },
    h('div', { className: 'dxw-cardBody dim-botCardBody' },
      h(CollapsibleAccountSection, {
        settings: h(BotSettingsButton, {
          channel: 'weixin',
          botId: account.botId,
          botName: account.bot.name,
          connected: account.connected,
          accessPolicy: account.accessPolicy,
        }),
        id: `dxw-settings-${account.botId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        header: h('div', { className: 'dxw-accountTop dim-botCardTop' },
        h('div', { className: 'dxw-accountIdentity dim-botIdentity' },
          h('div', { className: 'dxw-avatar dim-botAvatar', 'aria-hidden': 'true' }, h(WeixinLogoGlyph, { size: 27 })),
          h('div', { className: 'dim-botName' }, h(BotName, { bot: account.bot, disabled: Boolean(busy), onSave: onAliasSave }), h('p', null, account.bot.accountIdMasked))),
        h('div', {
            className: 'dim-botCardTools',
            // The header is the collapse toggle; keep inner controls clickable.
            onClick: (event) => { event.stopPropagation(); },
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); },
          },
          h(BotStatusMeta, {
            className: 'dxw-health',
            dotClassName: 'dxw-dot',
            tone,
            stateLabel: account.connected ? '运行正常' : state === 'connecting' ? '正在连接' : '连接未就绪',
            lastCheckedAt: account.health.lastCheckedAt,
            formatCheckedTime: checkedTime,
          }),
          h(AccountSettingsToggle)))
      },
        h(WorkspaceEditor, {
        workspace: account.workspace,
        disabled: Boolean(busy),
        onSave: onWorkspaceSave,
      }),
      h(ModelEditor, {
        model: account.model,
        disabled: Boolean(busy),
        onSave: onModelSave,
      }),
      h(AgentPresetEditor, {
        agentPreset: account.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave,
      }),
      h(ContextEnhancementEditor, {
        config: account.contextEnhancement,
        groupSupported: false,
        disabled: Boolean(busy),
        onSave: onContextEnhancementSave,
      }),
      h('div', { className: 'dxw-accountFooter dim-cardFooter' },
        h('div', { className: 'dim-cardFooterLayout' },
          h('div', { className: 'dxw-actions dim-cardActions' },
            h(Button, { className: 'dim-cardAction', onClick: onReconnect, disabled: Boolean(busy) },
              busy === 'reconnect' ? '检查中…' : account.connected ? '检查连接' : '重试连接'),
            h(Button, { className: 'dim-cardAction', kind: 'danger', onClick: onRequestRemove, disabled: Boolean(busy) }, '移除接入')),
          account.error ? h(WeixinConnectionError, { error: account.error })
            : summary ? h('div', { className: 'dxw-summary dim-cardSummary' }, summary) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: 'dxw-summary',
            error: account.lastMessageError,
          }) : null,
          feedback ? h('div', {
            className: 'dxw-summary dim-cardFeedback',
            role: 'status',
            'aria-live': 'polite',
          }, typeof feedback === 'string' ? feedback : h(WeixinConnectionError, { error: feedback })) : null)),
      ),
    ),
    removing ? h('div', { className: 'dxw-confirm dim-confirm', role: 'alertdialog' },
      h('strong', null, '从此 Harness 移除这个微信账号？'),
      h('p', null, '这会停止消息连接，并删除本机保存的 bot_token、账号配置和会话映射。其他微信账号不受影响。'),
      h('div', { className: 'dxw-actions dim-viewActions' },
        h(Button, { onClick: onCancelRemove, disabled: busy === 'delete' }, '保留账号'),
        h(Button, { kind: 'danger', onClick: onConfirmRemove, disabled: busy === 'delete' },
          busy === 'delete' ? '正在移除…' : '确认移除')))
      : null);
}

function AccountList(props) {
  return h('section', { className: 'dim-listSection' },
    h(ChannelListHeading, {
      className: 'dxw-listHeading',
      title: '已接入的微信账号',
      connectionLabel: 'iLink 长轮询',
    }),
    h('ul', { className: 'dxw-list dim-botList' }, props.bots.map((account) => h('li', { key: account.botId },
      h(AccountCard, {
        account,
        busy: props.busyByBot[account.botId],
        feedback: props.feedbackByBot[account.botId],
        removing: props.removeTarget === account.botId,
        onReconnect: () => props.onReconnect(account),
        onWorkspaceSave: (workspace) => props.onWorkspaceSave(account, workspace),
        onAliasSave: (alias) => props.onAliasSave(account, alias),
        onModelSave: (model) => props.onModelSave(account, model),
        onAgentPresetSave: (agentPreset) => props.onAgentPresetSave(account, agentPreset),
        onContextEnhancementSave: (config) => props.onContextEnhancementSave(account, config),
        onRequestRemove: () => props.onRequestRemove(account),
        onConfirmRemove: () => props.onConfirmRemove(account),
        onCancelRemove: props.onCancelRemove,
      })))));
}

const EMPTY_TOTALS = Object.freeze({ configured: 0, connected: 0 });

export function mergeWeixinProvisioningSnapshot(
  current,
  incoming,
  { restoreProvisioning = false } = {},
) {
  if (!incoming || (!current && !restoreProvisioning)) return current;
  if (current && current.attemptId !== incoming.attemptId) return current;
  return {
    ...current,
    ...incoming,
    durationMs: current?.durationMs ?? 5 * 60_000,
  };
}

export function WeixinSettingsTab({ rpcCall }) {
  const [model, setModel] = React.useState({
    phase: 'loading', bots: [], totals: EMPTY_TOTALS, revision: 0, error: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG,
    modelCatalog: EMPTY_MODEL_CATALOG,
  });
  const [provision, setProvision] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [busyByBot, setBusyByBot] = React.useState({});
  const [feedbackByBot, setFeedbackByBot] = React.useState({});
  const [removeTarget, setRemoveTarget] = React.useState(null);
  const [notice, setNotice] = React.useState('');
  const [operationWarnings, setOperationWarnings] = React.useState([]);
  const [now, setNow] = React.useState(() => Date.now());
  const addButtonRef = React.useRef(null);
  const mountedRef = React.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const scheduleAnimationFrame = useAnimationFrameScheduler();

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const announce = React.useCallback((value) => {
    setNotice('');
    scheduleAnimationFrame(() => {
      if (value) setNotice(value);
    }, 'announcement');
  }, [scheduleAnimationFrame]);
  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    let result;
    try { result = await rpcCall(endpoint, payload, signal); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw managementRequestError(error, endpoint);
    }
    return unwrapRpcResult(result);
  }, [rpcCall]);
  const loadStatus = React.useCallback(async ({
    signal,
    silent = false,
    restoreProvisioning = false,
  } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null || !mountedRef.current) return undefined;
    if (!silent) setModel((current) => ({ ...current, phase: 'loading', error: null }));
    try {
      const snapshot = normalizeSnapshot(await invoke(WEIXIN_ENDPOINTS.status, {}, signal));
      if (signal?.aborted || !mountedRef.current
        || !workspaceFence.canCommitStatus(workspaceVersion)) return undefined;
      setModel({
        phase: 'ready', bots: snapshot.bots, totals: snapshot.totals,
        revision: snapshot.revision, error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
        modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
      });
      if (snapshot.provisioning) {
        setProvision((current) => mergeWeixinProvisioningSnapshot(
          current,
          snapshot.provisioning,
          { restoreProvisioning },
        ));
      }
      return snapshot;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || !mountedRef.current
        || !workspaceFence.canCommitStatus(workspaceVersion)) return undefined;
      setModel((current) => ({
        ...current,
        phase: silent && current.phase === 'ready' ? 'ready' : 'error',
        error: presentError(error),
      }));
      return undefined;
    }
  }, [invoke, workspaceFence]);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restoreProvisioning: true });
    return () => controller.abort();
  }, [loadStatus]);

  React.useEffect(() => {
    if (model.phase !== 'ready') return undefined;
    const controller = new AbortController();
    let running = false;
    const timer = window.setInterval(async () => {
      if (running) return;
      running = true;
      await loadStatus({
        signal: controller.signal,
        silent: true,
        restoreProvisioning: false,
      });
      running = false;
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);

  React.useEffect(() => {
    if (!provision || !['pending', 'scanned'].includes(provision.status)) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);

  const startProvisioning = React.useCallback(async ({ replace = false } = {}) => {
    setBusy(true);
    try {
      if (replace && provision?.attemptId) {
        await invoke(WEIXIN_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      setProvision({ status: 'starting' });
      const started = normalizeProvisioning(await invoke(WEIXIN_ENDPOINTS.beginProvisioning, { locale: 'zh-CN' }));
      setNow(Date.now());
      setProvision({ ...started, durationMs: Math.max(1, started.expiresAt - Date.now()) });
      announce('微信二维码已生成，请使用手机微信扫描。');
    } catch (error) {
      setProvision({
        status: 'failed',
        error: presentError(error),
        ...(provision?.attemptId ? { attemptId: provision.attemptId } : {}),
      });
    } finally {
      setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId]);

  const cancelProvisioning = React.useCallback(async () => {
    setBusy(true);
    try {
      if (provision?.attemptId && !['failed', 'expired', 'cancelled'].includes(provision.status)) {
        await invoke(WEIXIN_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      setProvision(null);
      announce('已取消微信绑定。');
      scheduleAnimationFrame(() => addButtonRef.current?.focus(), 'focus');
    } catch (error) {
      setProvision((current) => ({ ...current, status: 'failed', error: presentError(error) }));
    } finally {
      setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId, provision?.status, scheduleAnimationFrame]);

  const submitVerification = React.useCallback(async (verifyCode) => {
    if (!provision?.attemptId) return;
    setBusy(true);
    try {
      const next = normalizeProvisioning(await invoke(WEIXIN_ENDPOINTS.submitVerification, {
        attemptId: provision.attemptId,
        verifyCode,
      }));
      setProvision((current) => ({ ...current, ...next }));
      announce('配对码已提交，正在等待微信确认。');
    } catch (error) {
      setProvision((current) => ({ ...current, status: 'failed', error: presentError(error) }));
    } finally {
      setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId]);

  React.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !['pending', 'scanned', 'connecting'].includes(provision.status)) return undefined;
    const controller = new AbortController();
    const scheduler = createPollScheduler({
      setTimeoutFn: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeoutFn: (timer) => window.clearTimeout(timer),
    });
    const poll = async () => {
      try {
        const result = normalizeProvisioning(await invoke(
          WEIXIN_ENDPOINTS.pollProvisioning,
          { attemptId },
          controller.signal,
        ));
        if (scheduler.disposed) return;
        if (result.status === 'connected') {
          const snapshot = await loadStatus({
            signal: controller.signal,
            silent: true,
            restoreProvisioning: false,
          });
          if (scheduler.disposed) return;
          const account = snapshot?.bots.find((bot) => bot.botId === result.botId);
          if (!account?.connected) {
            setProvision((current) => current?.attemptId === attemptId
              ? { ...current, ...result, status: 'connecting' }
              : current);
            scheduler.schedule(poll, result.pollIntervalMs);
            return;
          }
          setProvision(null);
          announce(result.alreadyConnected
            ? '这个微信账号已经绑定并保持在线。'
            : '微信已绑定，可以开始向已绑定的机器人发消息。');
          return;
        }
        setProvision((current) => current?.attemptId === attemptId
          ? { ...current, ...result, durationMs: current.durationMs }
          : current);
        if (['pending', 'scanned', 'connecting'].includes(result.status)) {
          scheduler.schedule(poll, result.pollIntervalMs);
        }
      } catch (error) {
        if (scheduler.disposed || error?.name === 'AbortError') return;
        setProvision((current) => current?.attemptId === attemptId
          ? { ...current, status: 'failed', error: presentError(error) }
          : current);
      }
    };
    scheduler.schedule(poll, provision.pollIntervalMs ?? 1_000);
    return () => {
      scheduler.dispose();
      controller.abort();
    };
  }, [announce, invoke, loadStatus, provision?.attemptId, provision?.status, provision?.pollIntervalMs]);

  const setBotBusy = React.useCallback((botId, value) => {
    setBusyByBot((current) => {
      const next = { ...current };
      if (value) next[botId] = value;
      else delete next[botId];
      return next;
    });
  }, []);

  const reconnect = React.useCallback(async (account) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, 'reconnect');
    setFeedbackByBot((current) => {
      const next = { ...current };
      delete next[account.botId];
      return next;
    });
    try {
      const snapshot = normalizeSnapshot(await invoke(
        WEIXIN_ENDPOINTS.reconnectBot,
        { botId: account.botId, sendTest: true },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel((current) => ({
          ...current, bots: snapshot.bots, totals: snapshot.totals, revision: snapshot.revision,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? current.agentPresetCatalog,
          modelCatalog: snapshot.modelCatalog ?? current.modelCatalog,
        }));
      }
      const refreshed = snapshot.bots.find((bot) => bot.botId === account.botId);
      let feedback;
      if (!refreshed?.connected) {
        feedback = '微信仍未连接，插件会继续自动重试。';
      } else if (snapshot.testMessage?.sent) {
        feedback = '微信连接检查完成，测试消息已发送。';
      } else if (snapshot.testMessage?.code === 'test-target-unavailable') {
        feedback = '连接检查完成。机器人尚未收到可用于测试的私聊消息。';
      } else if (snapshot.testMessage) {
        feedback = '微信连接检查完成，但测试消息发送失败。';
      } else {
        feedback = '微信连接检查完成。';
      }
      if (mountedRef.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback);
    } catch (error) {
      const feedback = presentError(error);
      if (mountedRef.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback.message);
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(account.botId, null);
    }
  }, [announce, invoke, loadStatus, setBotBusy, workspaceFence]);

  const saveWorkspace = React.useCallback(async (account, workspace) => {
    const workspaceVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, 'workspace');
    setFeedbackByBot(current => ({ ...current, [account.botId]: null }));
    try {
      const snapshot = normalizeSnapshot(await invoke(
        WEIXIN_ENDPOINTS.setWorkspace,
        { botId: account.botId, workspace },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(workspaceVersion)) {
        setModel({
          phase: 'ready', bots: snapshot.bots, totals: snapshot.totals,
          revision: snapshot.revision, error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
      }
    } catch (error) {
      if (mountedRef.current) setFeedbackByBot(current => ({ ...current, [account.botId]: presentError(error) }));
      throw error;
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [invoke, loadStatus, setBotBusy, workspaceFence]);

  const saveBotSetting = React.useCallback(async (account, operation, endpoint, payload) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, operation);
    setFeedbackByBot(current => ({ ...current, [account.botId]: null }));
    try {
      const snapshot = normalizeSnapshot(await invoke(
        endpoint,
        { botId: account.botId, ...payload },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: 'ready', bots: snapshot.bots, totals: snapshot.totals,
          revision: snapshot.revision, error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
      }
    } catch (error) {
      if (mountedRef.current) setFeedbackByBot(current => ({ ...current, [account.botId]: presentError(error) }));
      throw error;
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [invoke, loadStatus, setBotBusy, workspaceFence]);

  const remove = React.useCallback(async (account) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, 'delete');
    setOperationWarnings([]);
    setFeedbackByBot(current => ({ ...current, [account.botId]: null }));
    try {
      const snapshot = normalizeSnapshot(await invoke(WEIXIN_ENDPOINTS.deleteBot, {
        botId: account.botId,
        confirm: true,
      }));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel((current) => ({
          ...current, bots: snapshot.bots, totals: snapshot.totals, revision: snapshot.revision,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? current.agentPresetCatalog,
          modelCatalog: snapshot.modelCatalog ?? current.modelCatalog,
        }));
      }
      setOperationWarnings(snapshot.warnings);
      setRemoveTarget(null);
      announce('微信账号及本机凭据已移除。');
    } catch (error) {
      const failure = presentError(error);
      if (mountedRef.current) setFeedbackByBot(current => ({ ...current, [account.botId]: failure }));
      announce(failure.message);
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(account.botId, null);
    }
  }, [announce, invoke, loadStatus, setBotBusy, workspaceFence]);

  let provisionView = null;
  if (provision?.status === 'starting') {
    provisionView = h(ProgressPanel, { busy });
  } else if (['pending', 'scanned'].includes(provision?.status)) {
    provisionView = h(QrPanel, {
      provision, now, busy,
      onRefresh: () => void startProvisioning({ replace: true }),
      onCancel: () => void cancelProvisioning(),
    });
  } else if (provision?.status === 'needs_verification') {
    provisionView = h(VerificationPanel, {
      provision, busy,
      onSubmit: (code) => void submitVerification(code),
      onCancel: () => void cancelProvisioning(),
    });
  } else if (provision?.status === 'connecting') {
    provisionView = h(ProgressPanel, {
      scanned: true, busy, onCancel: () => void cancelProvisioning(),
    });
  } else if (provision && ['failed', 'expired', 'cancelled'].includes(provision.status)) {
    provisionView = h(ProvisionError, {
      provision, busy,
      onRetry: () => void startProvisioning({ replace: Boolean(provision.attemptId) }),
      onClose: () => void cancelProvisioning(),
    });
  }

  return h(ModelCatalogContext.Provider, {
    value: model.modelCatalog ?? EMPTY_MODEL_CATALOG,
  }, h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
  }, h('section', { className: 'dxw-page dim-channelPage', 'aria-label': '微信设置' },
    h(Heading, {
      totals: model.totals,
      adding: Boolean(provision),
      busy,
      onAdd: () => void startProvisioning(),
      addButtonRef,
    }),
    h('div', { className: 'dxw-visuallyHidden', role: 'status', 'aria-live': 'polite' }, notice),
    ...operationWarnings.map((error, index) => h(WeixinConnectionError, { key: error.details?.referenceId ?? index, error, warning: true })),
    model.error && model.phase === 'ready'
      ? h('div', { className: 'dxw-statusNotice dim-statusNotice' },
          h('p', null, '状态读取失败，以下是上次读取的状态。'), h(WeixinConnectionError, { error: model.error }))
      : null,
    model.phase === 'loading'
      ? h(LoadingView)
      : model.phase === 'error'
        ? h('div', { className: 'dxw-card dim-surfaceCard' },
            h('div', { className: 'dxw-error dim-inlineError' },
              h('h3', null, '无法读取微信状态'),
              h(WeixinConnectionError, { error: model.error }),
              h(Button, { onClick: () => void loadStatus() }, '重新读取')))
        : h(React.Fragment, null,
            provisionView,
            model.bots.length === 0 && !provision
              ? h(EmptyView, { onStart: () => void startProvisioning(), busy })
              : null,
            model.bots.length > 0
              ? h(AccountList, {
                  bots: model.bots,
                  busyByBot,
                  feedbackByBot,
                  removeTarget,
                  onReconnect: (account) => void reconnect(account),
                  onWorkspaceSave: saveWorkspace,
                  onAliasSave: (account, alias) => saveBotSetting(
                    account, 'alias', WEIXIN_ENDPOINTS.setAlias, { alias },
                  ),
                  onModelSave: (account, selectedModel) => saveBotSetting(
                    account, 'model', WEIXIN_ENDPOINTS.setModel, { model: selectedModel },
                  ),
                  onAgentPresetSave: (account, agentPreset) => saveBotSetting(
                    account, 'preset', WEIXIN_ENDPOINTS.setAgentPreset, { agentPreset },
                  ),
                  onContextEnhancementSave: (account, config) => saveBotSetting(
                    account, 'context-enhancement', WEIXIN_ENDPOINTS.setContextEnhancement, { config },
                  ),
                  onRequestRemove: (account) => setRemoveTarget(account.botId),
                  onConfirmRemove: (account) => void remove(account),
                  onCancelRemove: () => setRemoveTarget(null),
                })
              : null),
  )));
}
