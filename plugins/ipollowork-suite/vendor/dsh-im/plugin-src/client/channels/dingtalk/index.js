import { ConnectionError, normalizeConnectionError } from '../../connection-error.js';
import { BotName } from '../../bot-alias.js';
import * as React from 'react';

import { CredentialActionIcon, CredentialBindingPanel, QrActionIcon } from '../../credential-binding.js';
import { AccountSettingsToggle, CollapsibleAccountSection } from '../shared/collapsible-account.js';
import { channelName, h, localizeTemplate, localizeText } from '../../i18n.js';
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
import {
  DINGTALK_ENDPOINTS,
  connectionTestFeedback,
  formatRemaining,
  normalizeProvisioning,
  normalizeSnapshot,
  presentError,
  safeQrSource,
  unwrapRpcResult,
} from './api.js';
import { installDingtalkStyles } from './styles.js';

const ACTIVE_PROVISION_STATES = new Set(['pending', 'scanned', 'authorizing', 'creating', 'connecting']);

function DingtalkIcon({ size = 28 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': 'true',
    focusable: 'false',
  }, h('path', {
    fill: 'currentColor',
    d: 'M37.05 22.783c-6.758-5.216-14.378-12.128-22.73-19.538-.655-.585-1.242-.354-1.536.42-1.88 4.973-.058 9.386 2.889 11.932s7.368 4.912 10.058 6.155c.105.049.013.203-.093.163-4.953-2.182-8.397-3.765-13.07-7.368-.497-.388-1.01-.242-1.07.521-.384 4.748 2.657 8.483 6.058 9.745 2.1.781 4.398 1.212 6.53 1.474.109.015.084.178-.027.178-2.747.01-6.058-.654-8.935-1.751-.606-.233-.818.25-.722.633.491 2.008 2.974 5.076 6.926 5.73a12 12 0 0 0 2.228.115c.164 0 .208.089.154.217q-2.685 4.6-2.803 4.797c-.091.152-.036.275.156.275h3.543c.164 0 .264.106.18.246l-4.958 8.196c-.191.328.035.565.395.301s15.212-11.133 15.636-11.448c.195-.142.148-.327-.124-.327h-3.18c-.206 0-.252-.14-.111-.28.14-.141 3.602-3.594 4.837-4.888 1.283-1.35 1.938-3.825-.231-5.498',
  }));
}

const Button = React.forwardRef(function Button(
  { children, kind = 'secondary', className = '', ...props },
  ref,
) {
  return h('button', {
    ...props,
    ref,
    type: 'button',
    className: `ddt-button ${className}`.trim(),
    'data-kind': kind,
  }, children);
});

function Heading({ totals, adding, busy, onAdd, onCredential, credentialOpen, addButtonRef }) {
  return h('div', { className: 'ddt-heading' },
    h('div', { className: 'ddt-headingCopy' },
      h('div', { className: 'ddt-eyebrow' }, 'Channel'),
      h('h2', null, '钉钉机器人'),
      h('p', null, '通过扫码把钉钉机器人接入 DeepSeek Harness')),
    h('div', { className: 'ddt-tools' },
      h('div', { className: 'dim-bindActions' },
        h(Button, {
          kind: 'primary',
          className: 'dim-scanButton',
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          'aria-label': '扫码接入钉钉机器人',
        }, h(QrActionIcon), adding ? '正在接入' : '扫码接入机器人'),
        h(Button, {
          kind: 'credential',
          className: 'dim-credentialButton',
          onClick: onCredential,
          disabled: adding || busy,
          'aria-pressed': credentialOpen,
          'aria-label': '使用 Client ID 和 Client Secret 绑定钉钉机器人',
        }, h(CredentialActionIcon), credentialOpen ? '收起凭据' : '手动接入')),
      totals.configured > 0
        ? h('div', { className: 'ddt-badge dim-onlineBadge' },
            h('span', null, localizeTemplate('{connected} / {configured} 在线', { connected: totals.connected, configured: totals.configured })))
        : null));
}

function LoadingView() {
  return h('div', { className: 'ddt-card ddt-loading dim-surfaceCard dim-loadingView', 'aria-busy': 'true' },
    h('div', { className: 'ddt-spinner dim-spinner' }),
    h('span', null, '正在读取钉钉连接状态…'));
}

function EmptyView({ busy, onStart }) {
  return h('div', { className: 'ddt-card dim-surfaceCard' },
    h('div', { className: 'ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView' },
      h('div', { className: 'dim-emptyCopy' },
        h('div', { className: 'ddt-stateLabel dim-stateLabel' },
          h('span', { className: 'ddt-dot dim-stateDot' }), h('span', null, localizeTemplate('尚未接入 {channel} 机器人', { channel: channelName('钉钉') }))),
        h('h3', null, '扫一次码，自动创建并连接机器人'),
        h('p', null, '授权由钉钉官方页面完成。扫码账号必须已加入一个企业/组织并有权创建机器人；创建成功后，应用凭据会直接写入 Harness Host。'),
        h('div', { className: 'ddt-actions dim-viewActions' },
          h(Button, { kind: 'primary', onClick: onStart, disabled: busy },
            busy ? '正在生成二维码…' : '生成钉钉二维码'))),
      h('div', { className: 'ddt-brandMark dim-emptyBrand', 'aria-hidden': 'true' },
        h(DingtalkIcon, { size: 68 }))));
}

function QrPanel({ provision, now, busy, onRefresh, onCancel }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const source = safeQrSource(provision.qrCodeDataUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = remaining === 0 || provision.status === 'expired';
  const duration = Math.max(1, provision.durationMs ?? 10 * 60_000);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);

  React.useEffect(() => setImageFailed(false), [source]);

  return h('div', { className: 'ddt-card dim-surfaceCard' },
    h('div', { className: 'ddt-cardBody ddt-qrLayout dim-surfaceBody dim-qrLayout' },
      h('div', { className: 'ddt-qrColumn dim-qrColumn' },
        h('div', { className: 'ddt-qrFrame dim-qrFrame' },
          source && !imageFailed
            ? h('img', {
                src: source,
                alt: '用于把钉钉机器人接入 DeepSeek Harness 的一次性二维码',
                onError: () => setImageFailed(true),
              })
            : h('div', { className: 'ddt-qrFallback dim-qrFallback' }, '二维码图片未就绪，请重新生成。'),
          expired ? h('div', { className: 'ddt-expired dim-qrExpired' }, '二维码已过期\n请重新生成') : null),
        h('div', { className: 'ddt-countdown dim-countdown' },
          h('div', { className: 'ddt-countdownTop dim-countdownTop' },
            h('span', null, '二维码有效时间'), h('strong', null, formatRemaining(remaining))),
          h('div', { className: 'ddt-progress dim-progress', 'aria-hidden': 'true' },
            h('span', { style: { '--ddt-progress': `${progress}%` } })))),
      h('div', { className: 'ddt-qrCopy dim-qrCopy' },
        h('div', { className: 'ddt-stateLabel dim-stateLabel' },
          h('span', { className: 'ddt-dot dim-stateDot', 'data-tone': expired ? 'error' : 'warning' }),
          h('span', null, expired ? '二维码已失效' : '等待钉钉扫码授权')),
        h('h3', null, expired ? '重新生成二维码后继续' : '使用钉钉 App 完成机器人授权'),
        h('p', null, '扫码账号必须已加入企业/组织。如果钉钉提示尚未加入组织，请在提示页创建组织，或换用已加入组织的账号。'),
        h('ol', { className: 'ddt-steps dim-steps' },
          h('li', null, '使用已加入企业/组织的钉钉账号扫描左侧二维码'),
          h('li', null, '在授权页点击“一键创建新机器人”'),
          h('li', null, '保持本页打开，等待机器人自动连接')),
        h('div', { className: 'ddt-actions dim-viewActions' },
          expired
            ? h(Button, { kind: 'primary', onClick: onRefresh, disabled: busy }, '重新生成二维码')
            : null,
          !expired ? h(Button, { onClick: onRefresh, disabled: busy }, '换一个二维码') : null,
          h(Button, { onClick: onCancel, disabled: busy }, '取消')))));
}

function ProgressPanel({ status, busy, onCancel }) {
  const connecting = status === 'connecting';
  const creating = status === 'creating';
  return h('div', { className: 'ddt-card ddt-loading dim-surfaceCard dim-loadingView', 'aria-busy': 'true' },
    h('div', { className: 'ddt-spinner dim-spinner' }),
    h('h3', null, connecting
      ? '机器人已创建，正在建立消息连接'
      : creating ? '授权已确认，正在创建钉钉机器人' : '正在确认钉钉授权'),
    h('p', null, connecting
      ? '正在检查钉钉 Stream 长连接，成功后会自动显示为在线。'
      : '请勿关闭本页，钉钉完成授权后将自动继续。'),
    h('div', { className: 'ddt-actions dim-viewActions', style: { justifyContent: 'center', marginTop: 14 } },
      h(Button, { onClick: onCancel, disabled: busy }, '取消接入')));
}

function ConnectionErrorDiagnostic({ error }) { return error ? h(ConnectionError, { error, showMessage: false }) : null; }

function ProvisionError({ provision, busy, onRetry, onClose }) {
  const error = provision.error ?? {
    code: 'DINGTALK_PROVISION_FAILED',
    message: '钉钉机器人没有接入完成',
  };
  const connectionFailed = Boolean(error.referenceId);
  return h('div', { className: 'ddt-card dim-surfaceCard' },
    h('div', { className: 'ddt-inlineError dim-inlineError', role: 'alert' },
      h('h3', null, provision.status === 'expired'
        ? '二维码已过期'
        : connectionFailed ? '机器人已保存，但连接未就绪' : '钉钉机器人没有接入完成'),
      h(ConnectionError, { error }),
      h('div', { className: 'ddt-actions dim-viewActions' },
        connectionFailed
          ? h(Button, { kind: 'primary', onClick: onClose, disabled: busy }, '查看已保存的机器人')
          : h(React.Fragment, null,
              h(Button, { kind: 'primary', onClick: onRetry, disabled: busy }, '重新生成二维码'),
              h(Button, { onClick: onClose, disabled: busy }, '关闭')))));
}

function checkedTime(value) {
  if (!value) return '尚未检查';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(value));
  } catch {
    return '刚刚';
  }
}

function RemoveConfirmation({ account, busy, onConfirm, onCancel }) {
  const cancelRef = React.useRef(null);
  React.useEffect(() => cancelRef.current?.focus(), []);
  return h('div', {
    className: 'ddt-confirm dim-confirm',
    role: 'alertdialog',
    'aria-label': localizeTemplate('移除{name}', { name: account.bot.name }),
    onKeyDown: (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    },
  },
  h('strong', null, localizeTemplate('从 DeepSeek Harness 移除“{name}”？', { name: account.bot.name })),
  h('p', null, '这会停止消息连接，并删除本机保存的应用凭据、机器人配置及会话映射。钉钉开放平台中的机器人不会被自动删除。'),
  h('div', { className: 'ddt-actions dim-viewActions' },
    h(Button, { ref: cancelRef, onClick: onCancel, disabled: busy }, '保留机器人'),
    h(Button, { kind: 'danger', onClick: onConfirm, disabled: busy },
      busy ? '正在移除…' : '确认移除接入')));
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
  const stateLabel = account.connected ? '运行正常' : state === 'connecting' ? '正在连接' : '连接未就绪';
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h('article', { className: 'ddt-card dim-botCard', tabIndex: -1, 'data-bot-id': account.botId },
    h('div', { className: 'ddt-cardBody dim-botCardBody' },
      h(CollapsibleAccountSection, {
        settings: h(BotSettingsButton, {
          channel: 'dingtalk',
          botId: account.botId,
          botName: account.bot.name,
          connected: account.connected,
          accessPolicy: account.accessPolicy,
        }),
        id: `ddt-settings-${account.botId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        header: h('div', { className: 'ddt-accountTop dim-botCardTop' },
        h('div', { className: 'ddt-accountIdentity dim-botIdentity' },
          h('div', { className: 'ddt-avatar dim-botAvatar', 'aria-hidden': 'true' }, h(DingtalkIcon, { size: 29 })),
          h('div', { className: 'dim-botName' },
            h(BotName, { bot: account.bot, disabled: Boolean(busy), onSave: onAliasSave }),
            h('p', { title: account.bot.clientIdMasked }, account.bot.clientIdMasked))),
        h('div', {
            className: 'dim-botCardTools',
            // The header is the collapse toggle; keep inner controls clickable.
            onClick: (event) => { event.stopPropagation(); },
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); },
          },
          h(BotStatusMeta, {
            className: 'ddt-health',
            dotClassName: 'ddt-dot',
            tone,
            stateLabel,
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
        disabled: Boolean(busy),
        onSave: onContextEnhancementSave,
      }),
      h('div', { className: 'ddt-accountFooter dim-cardFooter' },
        h('div', { className: 'dim-cardFooterLayout' },
          h('div', { className: 'ddt-actions dim-cardActions' },
            h(Button, { className: 'dim-cardAction', onClick: onReconnect, disabled: Boolean(busy) },
              busy === 'reconnect' ? '检查中…' : account.connected ? '检查连接' : '重试连接'),
            h(Button, { className: 'dim-cardAction', kind: 'danger', onClick: onRequestRemove, disabled: Boolean(busy) },
              '移除接入')),
          summary ? h('div', { className: 'ddt-summary dim-cardSummary' }, summary) : null,
          account.error ? h(ConnectionErrorDiagnostic, { error: account.error }) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: 'ddt-summary',
            error: account.lastMessageError,
          }) : null,
          feedback ? h('div', {
            className: 'ddt-summary dim-cardFeedback',
            role: 'status',
          }, feedback) : null)),
      ),
    ),
    removing ? h(RemoveConfirmation, {
      account,
      busy: busy === 'delete',
      onConfirm: onConfirmRemove,
      onCancel: onCancelRemove,
    }) : null);
}

function AccountList(props) {
  return h('section', { className: 'dim-listSection' },
    h(ChannelListHeading, {
      className: 'ddt-listHeading',
      title: '已接入的钉钉机器人',
      connectionLabel: 'Stream 长连接',
    }),
    h('ul', { className: 'ddt-list dim-botList' }, props.bots.map((account) => h('li', { key: account.botId },
      h(AccountCard, {
        account,
        busy: props.busyByBot[account.botId],
        feedback: props.feedbackByBot[account.botId]?.message,
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

export function DingtalkSettingsTab({ rpcCall }) {
  const [operationError, setOperationError] = React.useState(null);
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
  const [credentialOpen, setCredentialOpen] = React.useState(false);
  const [credentialError, setCredentialError] = React.useState(null);
  const [notice, setNotice] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());
  const addButtonRef = React.useRef(null);
  const mountedRef = React.useRef(true);
  const statusRequestRef = React.useRef(0);
  const workspaceFence = useWorkspaceSnapshotFence();
  const noticeFrameRef = React.useRef(null);
  const focusFrameRef = React.useRef(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      statusRequestRef.current += 1;
      if (noticeFrameRef.current !== null) {
        window.cancelAnimationFrame(noticeFrameRef.current);
        noticeFrameRef.current = null;
      }
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => installDingtalkStyles(), []);

  const announce = React.useCallback((message) => {
    if (!mountedRef.current) return;
    if (noticeFrameRef.current !== null) {
      window.cancelAnimationFrame(noticeFrameRef.current);
      noticeFrameRef.current = null;
    }
    setNotice('');
    if (message) {
      noticeFrameRef.current = window.requestAnimationFrame(() => {
        noticeFrameRef.current = null;
        if (mountedRef.current) setNotice(message);
      });
    }
  }, []);

  const discardStaleFeedback = React.useCallback((snapshot) => {
    const botsById = new Map(snapshot.bots.map((bot) => [bot.botId, bot]));
    setFeedbackByBot((current) => {
      let changed = false;
      const next = { ...current };
      for (const [botId, feedback] of Object.entries(next)) {
        const bot = botsById.get(botId);
        if (!bot || (feedback.clearWhenDisconnected && (!bot.connected || bot.error))) {
          delete next[botId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const focusAddButton = React.useCallback(() => {
    if (!mountedRef.current) return;
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (mountedRef.current) addButtonRef.current?.focus();
    });
  }, []);

  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== 'function') throw new TypeError('钉钉设置页缺少 RPC 连接');
    const operation = !['connection.status', 'provision.poll', 'provision.begin', 'provision.cancel'].includes(endpoint);
    if (operation && mountedRef.current) setOperationError(null);
    try {
      const value = unwrapRpcResult(await rpcCall(endpoint, payload, signal));
      if (operation && mountedRef.current) setOperationError(value?.testMessage?.error ?? value?.warnings?.[0] ?? null);
      return value;
    } catch (error) {
      if (endpoint === 'bot.delete' && mountedRef.current && !signal?.aborted && error?.name !== 'AbortError') setOperationError(normalizeConnectionError(error));
      throw error;
    }
  }, [rpcCall]);

  const loadStatus = React.useCallback(async ({
    signal,
    silent = false,
    restoreProvisioning = false,
  } = {}) => {
    if (!mountedRef.current || signal?.aborted) return undefined;
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null) return undefined;
    const requestId = statusRequestRef.current + 1;
    statusRequestRef.current = requestId;
    const canCommit = () => mountedRef.current
      && !signal?.aborted
      && statusRequestRef.current === requestId
      && workspaceFence.canCommitStatus(workspaceVersion);
    if (!silent && canCommit()) {
      setModel((current) => ({ ...current, phase: 'loading', error: null }));
    }
    try {
      const snapshot = normalizeSnapshot(await invoke(DINGTALK_ENDPOINTS.status, {}, signal));
      if (!canCommit()) return undefined;
      setModel({
        phase: 'ready',
        bots: snapshot.bots,
        totals: snapshot.totals,
        revision: snapshot.revision,
        error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
        modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
      });
      discardStaleFeedback(snapshot);
      if (restoreProvisioning && snapshot.provisioning) {
        setProvision((current) => !current || current.attemptId === snapshot.provisioning.attemptId
          ? {
              ...current,
              ...snapshot.provisioning,
              durationMs: current?.durationMs
                ?? Math.max(1, snapshot.provisioning.expiresAt - Date.now()),
            }
          : current);
      }
      return snapshot;
    } catch (error) {
      if (error?.name === 'AbortError' || !canCommit()) return undefined;
      setModel((current) => ({
        ...current,
        phase: silent && current.phase === 'ready' ? 'ready' : 'error',
        error: presentError(error),
      }));
      return undefined;
    }
  }, [discardStaleFeedback, invoke, workspaceFence]);

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
      if (running || controller.signal.aborted || !mountedRef.current) return;
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
    if (!provision || !ACTIVE_PROVISION_STATES.has(provision.status)) return undefined;
    const timer = window.setInterval(() => {
      if (mountedRef.current) setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);

  const startProvisioning = React.useCallback(async ({ replace = false } = {}) => {
    if (!mountedRef.current) return;
    setCredentialOpen(false);
    setCredentialError(null);
    setBusy(true);
    try {
      if (replace && provision?.attemptId) {
        await invoke(DINGTALK_ENDPOINTS.cancelProvisioning, {
          attemptId: provision.attemptId,
        });
        if (!mountedRef.current) return;
      }
      setProvision({ status: 'starting' });
      const started = normalizeProvisioning(await invoke(
        DINGTALK_ENDPOINTS.beginProvisioning,
        { locale: 'zh-CN' },
      ));
      if (!mountedRef.current) return;
      if (!started.qrCodeDataUrl) {
        throw new Error('钉钉扫码服务没有返回安全的二维码');
      }
      setNow(Date.now());
      setProvision({
        ...started,
        durationMs: Math.max(1, started.expiresAt - Date.now()),
      });
      announce('钉钉二维码已生成，请使用钉钉 App 扫描。');
    } catch (error) {
      if (!mountedRef.current) return;
      setProvision({
        attemptId: provision?.attemptId,
        status: 'failed',
        error: presentError(error),
      });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId]);

  const bindCredentials = React.useCallback(async ({ identity, secret }) => {
    if (!mountedRef.current) return;
    const snapshotVersion = workspaceFence.beginMutation();
    setBusy(true);
    setCredentialError(null);
    try {
      const snapshot = normalizeSnapshot(await invoke(
        DINGTALK_ENDPOINTS.bindCredentials,
        { clientId: identity, clientSecret: secret },
      ));
      if (!mountedRef.current) return;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: 'ready',
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
        discardStaleFeedback(snapshot);
      }
      setCredentialOpen(false);
      announce('钉钉机器人凭据已绑定。');
    } catch (error) {
      if (mountedRef.current) setCredentialError(presentError(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBusy(false);
    }
  }, [announce, discardStaleFeedback, invoke, loadStatus, workspaceFence]);

  const cancelProvisioning = React.useCallback(async () => {
    if (!mountedRef.current) return;
    setBusy(true);
    try {
      if (provision?.attemptId && !['failed', 'expired', 'cancelled'].includes(provision.status)) {
        await invoke(DINGTALK_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
        if (!mountedRef.current) return;
      }
      setProvision(null);
      announce('已取消钉钉机器人接入。');
      focusAddButton();
    } catch (error) {
      if (!mountedRef.current) return;
      setProvision((current) => ({ ...current, status: 'failed', error: presentError(error) }));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [announce, focusAddButton, invoke, provision?.attemptId, provision?.status]);

  React.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !ACTIVE_PROVISION_STATES.has(provision.status)) return undefined;
    const controller = new AbortController();
    let disposed = false;
    let timer = null;
    const canCommit = () => !disposed && !controller.signal.aborted && mountedRef.current;
    const schedule = (delay) => {
      if (!canCommit()) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (canCommit()) void poll();
      }, delay);
    };
    const poll = async () => {
      try {
        const response = await invoke(
          DINGTALK_ENDPOINTS.pollProvisioning,
          { attemptId },
          controller.signal,
        );
        if (!canCommit()) return;
        const result = normalizeProvisioning(response);
        if (result.status === 'connected') {
          const snapshot = await loadStatus({
            signal: controller.signal,
            silent: true,
            restoreProvisioning: false,
          });
          if (!canCommit()) return;
          const account = result.botId
            ? snapshot?.bots.find((bot) => bot.botId === result.botId)
            : snapshot?.bots.find((bot) => bot.connected);
          if (!account?.connected) {
            if (account?.error) {
              setProvision((current) => current?.attemptId === attemptId
                ? { ...current, ...result, status: 'failed', error: account.error }
                : current);
              return;
            }
            setProvision((current) => current?.attemptId === attemptId
              ? { ...current, ...result, status: 'connecting' }
              : current);
            schedule(result.pollIntervalMs);
            return;
          }
          setProvision(null);
          announce(result.alreadyConnected
            ? '这个钉钉机器人已经接入并保持在线。'
            : '钉钉机器人已接入，可以开始发送消息。');
          return;
        }
        if (!canCommit()) return;
        setProvision((current) => current?.attemptId === attemptId
          ? { ...current, ...result, durationMs: current.durationMs }
          : current);
        if (ACTIVE_PROVISION_STATES.has(result.status)) {
          schedule(result.pollIntervalMs);
        }
      } catch (error) {
        if (error?.name === 'AbortError' || !canCommit()) return;
        setProvision((current) => current?.attemptId === attemptId
          ? { ...current, status: 'failed', error: presentError(error) }
          : current);
      }
    };
    schedule(provision.pollIntervalMs ?? 3_000);
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
  }, [announce, invoke, loadStatus, provision?.attemptId, provision?.pollIntervalMs, provision?.status]);

  const setBotBusy = React.useCallback((botId, operation) => {
    if (!mountedRef.current) return;
    setBusyByBot((current) => {
      const next = { ...current };
      if (operation) next[botId] = operation;
      else delete next[botId];
      return next;
    });
  }, []);

  const runBotAction = React.useCallback(async ({ account, operation, endpoint, payload, success }) => {
    if (!mountedRef.current) return undefined;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, operation);
    if (operation === 'reconnect') {
      setFeedbackByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
    }
    try {
      const snapshot = normalizeSnapshot(await invoke(endpoint, payload));
      if (!mountedRef.current) return undefined;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: 'ready',
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
        discardStaleFeedback(snapshot);
      }
      const successMessage = typeof success === 'function' ? success(snapshot) : success;
      if (operation === 'reconnect') {
        setFeedbackByBot((current) => ({
          ...current,
          [account.botId]: {
            message: successMessage,
            clearWhenDisconnected: snapshot.testMessage?.sent === true,
          },
        }));
      }
      announce(successMessage);
      return snapshot;
    } catch (error) {
      if (!mountedRef.current) return undefined;
      const visibleError = presentError(error);
      const failureMessage = operation === 'reconnect'
        ? visibleError.referenceId
          ? localizeTemplate('连接检查失败：{error}（参考号：{reference}）', {
            error: localizeText(visibleError.message),
            reference: visibleError.referenceId,
          })
          : '连接检查失败，请稍后重试。'
        : localizeTemplate('操作失败：{error}', { error: localizeText(visibleError.message) });
      if (operation === 'reconnect') {
        setFeedbackByBot((current) => ({
          ...current,
          [account.botId]: { message: failureMessage, clearWhenDisconnected: false },
        }));
      }
      announce(failureMessage);
      return undefined;
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true, restoreProvisioning: false });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [announce, discardStaleFeedback, invoke, loadStatus, setBotBusy, workspaceFence]);

  const reconnect = React.useCallback((account) => runBotAction({
    account,
    operation: 'reconnect',
    endpoint: DINGTALK_ENDPOINTS.reconnectBot,
    payload: { botId: account.botId, sendTest: true },
    success: (snapshot) => {
      const refreshed = snapshot?.bots.find((bot) => bot.botId === account.botId);
      if (!refreshed?.connected) return '钉钉仍未连接，插件会继续自动重试。';
      return connectionTestFeedback(snapshot.testMessage) ?? '钉钉连接检查完成。';
    },
  }), [runBotAction]);

  const saveWorkspace = React.useCallback(async (account, workspace) => {
    const workspaceVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, 'workspace');
    try {
      const snapshot = normalizeSnapshot(await invoke(
        DINGTALK_ENDPOINTS.setWorkspace,
        { botId: account.botId, workspace },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(workspaceVersion)) {
        setModel({
          phase: 'ready',
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
        discardStaleFeedback(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [discardStaleFeedback, invoke, loadStatus, setBotBusy, workspaceFence]);

  const saveBotSetting = React.useCallback(async (account, operation, endpoint, payload) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, operation);
    try {
      const snapshot = normalizeSnapshot(await invoke(
        endpoint,
        { botId: account.botId, ...payload },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: 'ready',
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
        discardStaleFeedback(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [discardStaleFeedback, invoke, loadStatus, setBotBusy, workspaceFence]);

  const remove = React.useCallback(async (account) => {
    const snapshot = await runBotAction({
      account,
      operation: 'delete',
      endpoint: DINGTALK_ENDPOINTS.deleteBot,
      payload: { botId: account.botId, confirm: true },
      success: '钉钉机器人及本机凭据已移除。',
    });
    if (snapshot && mountedRef.current) setRemoveTarget(null);
  }, [runBotAction]);

  let provisionView = null;
  if (provision?.status === 'starting') {
    provisionView = h('div', { className: 'ddt-card ddt-loading', 'aria-busy': 'true' },
      h('div', { className: 'ddt-spinner' }), h('span', null, '正在申请钉钉授权二维码…'));
  } else if (provision?.status === 'pending') {
    provisionView = h(QrPanel, {
      provision,
      now,
      busy,
      onRefresh: () => void startProvisioning({ replace: true }),
      onCancel: () => void cancelProvisioning(),
    });
  } else if (['scanned', 'authorizing', 'creating', 'connecting'].includes(provision?.status)) {
    provisionView = h(ProgressPanel, {
      status: provision.status,
      busy,
      onCancel: () => void cancelProvisioning(),
    });
  } else if (provision && ['failed', 'expired', 'cancelled'].includes(provision.status)) {
    provisionView = h(ProvisionError, {
      provision,
      busy,
      onRetry: () => void startProvisioning({ replace: Boolean(provision.attemptId) }),
      onClose: () => void cancelProvisioning(),
    });
  }

  const credentialView = credentialOpen
    ? h(CredentialBindingPanel, {
        channel: '钉钉',
        identityLabel: 'Client ID',
        identityPlaceholder: '填写钉钉应用 Client ID',
        secretLabel: 'Client Secret',
        secretPlaceholder: '填写钉钉应用 Client Secret',
        busy,
        error: credentialError,
        onSubmit: bindCredentials,
        onCancel: () => { setCredentialOpen(false); setCredentialError(null); },
      })
    : null;

  return h(ModelCatalogContext.Provider, {
    value: model.modelCatalog ?? EMPTY_MODEL_CATALOG,
  }, h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
  }, h('section', { className: 'ddt-page dim-channelPage', 'aria-label': '钉钉设置' },
    operationError ? h(ConnectionError, { error: operationError }) : null,
    h(Heading, {
      totals: model.totals,
      adding: Boolean(provision),
      busy,
      onAdd: () => void startProvisioning(),
      onCredential: () => { setCredentialOpen((value) => !value); setCredentialError(null); },
      credentialOpen,
      addButtonRef,
    }),
    h('div', { className: 'ddt-visuallyHidden', role: 'status', 'aria-live': 'polite' }, notice),
    model.error && model.phase === 'ready'
      ? h('div', { className: 'ddt-statusNotice dim-statusNotice', role: 'alert' }, localizeTemplate('状态刷新失败：{error}', { error: localizeText(model.error.message) }))
      : null,
    model.phase === 'loading'
      ? h(LoadingView)
      : model.phase === 'error'
        ? h('div', { className: 'ddt-card dim-surfaceCard' },
            h('div', { className: 'ddt-inlineError dim-inlineError', role: 'alert' },
              h('h3', null, localizeTemplate('无法读取 {channel} 机器人状态', { channel: channelName('钉钉') })),
              h('p', null, model.error?.message ?? '请稍后重试'),
              h(Button, { onClick: () => void loadStatus() }, '重新读取')))
        : h(React.Fragment, null,
            credentialView,
            provisionView,
            model.bots.length === 0 && !provision && !credentialOpen
              ? h(EmptyView, { busy, onStart: () => void startProvisioning() })
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
                    account, 'alias', DINGTALK_ENDPOINTS.setAlias, { alias },
                  ),
                  onModelSave: (account, selectedModel) => saveBotSetting(
                    account, 'model', DINGTALK_ENDPOINTS.setModel, { model: selectedModel },
                  ),
                  onAgentPresetSave: (account, agentPreset) => saveBotSetting(
                    account, 'preset', DINGTALK_ENDPOINTS.setAgentPreset, { agentPreset },
                  ),
                  onContextEnhancementSave: (account, config) => saveBotSetting(
                    account, 'context-enhancement', DINGTALK_ENDPOINTS.setContextEnhancement, { config },
                  ),
                  onRequestRemove: (account) => setRemoveTarget(account.botId),
                  onConfirmRemove: (account) => void remove(account),
                  onCancelRemove: () => setRemoveTarget(null),
                })
              : null))));
}
