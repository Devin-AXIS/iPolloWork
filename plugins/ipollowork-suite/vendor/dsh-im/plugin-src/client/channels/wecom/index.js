import { ConnectionError, normalizeConnectionError } from '../../connection-error.js';
import { BotName } from '../../bot-alias.js';
import * as React from 'react';

import { WecomLogoGlyph } from '../../channel-logos.js';
import { CredentialActionIcon, CredentialBindingPanel, QrActionIcon } from '../../credential-binding.js';
import { AccountSettingsToggle, CollapsibleAccountSection } from '../shared/collapsible-account.js';
import { channelName, h, localizeTemplate } from '../../i18n.js';
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
import { installDingtalkStyles } from '../dingtalk/styles.js';
import {
  WECOM_ENDPOINTS,
  formatRemaining,
  normalizeProvisioning,
  normalizeSnapshot,
  presentError,
  safeQrSource,
  unwrapRpcResult,
} from './api.js';
import { installWecomStyles } from './styles.js';

const ACTIVE_STATES = new Set(['pending', 'refreshing', 'connecting']);

const Button = React.forwardRef(function Button({ children, kind = 'secondary', className = '', ...props }, ref) {
  return h('button', {
    ...props,
    ref,
    type: 'button',
    className: `ddt-button ${className}`.trim(),
    'data-kind': kind,
  }, children);
});

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

function Heading({ totals, adding, busy, onAdd, onCredential, credentialOpen, addButtonRef }) {
  return h('div', { className: 'ddt-heading' },
    h('div', { className: 'ddt-tools' },
      h('div', { className: 'dim-bindActions' },
        h(Button, {
          kind: 'primary',
          className: 'dim-scanButton',
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          'aria-label': '扫码接入企业微信机器人',
        }, h(QrActionIcon), adding ? '正在接入' : '扫码接入机器人'),
        h(Button, {
          kind: 'credential',
          className: 'dim-credentialButton',
          onClick: onCredential,
          disabled: adding || busy,
          'aria-pressed': credentialOpen,
          'aria-label': '使用 Bot ID 和 Secret 绑定企业微信机器人',
        }, h(CredentialActionIcon), credentialOpen ? '收起凭据' : '手动接入')),
      totals.configured > 0
        ? h('div', { className: 'ddt-badge dim-onlineBadge' },
            h('span', null, localizeTemplate('{connected} / {configured} 在线', { connected: totals.connected, configured: totals.configured })))
        : null));
}

function LoadingView() {
  return h('div', { className: 'ddt-card ddt-loading dim-surfaceCard dim-loadingView', 'aria-busy': 'true' },
    h('div', { className: 'ddt-spinner dim-spinner' }),
    h('span', null, localizeTemplate('正在读取 {channel} 机器人状态…', { channel: channelName('企业微信') })));
}

function EmptyView({ busy, onStart }) {
  return h('div', { className: 'ddt-card dim-surfaceCard' },
    h('div', { className: 'ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView' },
      h('div', { className: 'dim-emptyCopy' },
        h('div', { className: 'ddt-stateLabel dim-stateLabel' },
          h('span', { className: 'ddt-dot dim-stateDot' }), h('span', null, '尚未绑定企业微信机器人')),
        h('h3', null, '使用企业微信 App 扫码创建智能机器人'),
        h('p', null, '扫码由腾讯官方页面完成，不需要手动填写 Bot ID 或 Secret。创建成功后，机器人会自动连接 DeepSeek Harness。'),
        h('div', { className: 'ddt-actions dim-viewActions' },
          h(Button, { kind: 'primary', onClick: onStart, disabled: busy },
            busy ? '正在生成二维码…' : '生成企业微信二维码'))),
      h('div', { className: 'ddt-brandMark dim-emptyBrand dwecom-brand', 'aria-hidden': 'true' },
        h(WecomLogoGlyph, { size: 64 }))));
}

function QrPanel({ provision, now, busy, onRefresh, onCancel }) {
  const source = safeQrSource(provision.qrCodeDataUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const duration = Math.max(1, provision.durationMs ?? 5 * 60_000);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);
  const refreshing = provision.status === 'refreshing';
  return h('div', { className: 'ddt-card dim-surfaceCard' },
    h('div', { className: 'ddt-cardBody ddt-qrLayout dim-surfaceBody dim-qrLayout' },
      h('div', { className: 'ddt-qrColumn dim-qrColumn' },
        h('div', { className: 'ddt-qrFrame dim-qrFrame' },
          source ? h('img', { src: source, alt: '用于绑定企业微信机器人的一次性二维码' })
            : h('div', { className: 'ddt-qrFallback dim-qrFallback' },
                refreshing ? '二维码正在自动刷新…' : '二维码图片正在生成…')),
        h('div', { className: 'ddt-countdown dim-countdown' },
          h('div', { className: 'ddt-countdownTop dim-countdownTop' },
            h('span', null, '当前二维码有效时间'),
            h('strong', null, refreshing ? '--:--' : formatRemaining(remaining))),
          h('div', { className: 'ddt-progress dim-progress', style: { '--ddt-progress': `${progress}%` } }, h('span')))),
      h('div', { className: 'ddt-qrCopy dim-qrCopy' },
        h('div', { className: 'ddt-stateLabel dim-stateLabel' },
          h('span', { className: 'ddt-dot dim-stateDot', 'data-tone': 'warning' }),
          h('span', null, refreshing ? '正在刷新二维码' : '等待企业微信 App 扫码')),
        h('h3', null, '使用企业微信 App 完成智能机器人授权'),
        h('p', null, '企业微信官方页面会创建一个智能机器人，并把连接凭据安全交给本机 Harness Host。'),
        h('ol', { className: 'ddt-steps dim-steps' },
          h('li', null, '打开企业微信 App，扫描左侧二维码'),
          h('li', null, '在腾讯授权页面确认创建智能机器人'),
          h('li', null, '返回这里等待连接完成')),
        h('div', { className: 'ddt-actions dim-viewActions' },
          h(Button, { onClick: onRefresh, disabled: busy }, '重新生成二维码'),
          h(Button, { kind: 'quiet', onClick: onCancel, disabled: busy }, '取消')))));
}

function ProvisionView({ provision, busy, onRetry, onClose }) {
  if (provision.status === 'connecting') {
    return h('div', { className: 'ddt-card ddt-loading dim-surfaceCard dim-specialView', 'aria-busy': 'true' },
      h('div', { className: 'ddt-spinner dim-spinner' }),
      h('h3', null, '企业微信已授权，正在连接机器人'),
      h('p', null, '凭据正在写入本机，并启动企业微信 WebSocket 消息连接。'));
  }
  const error = provision.error ?? { code: 'WECOM_PROVISION_FAILED', message: '企业微信机器人没有绑定完成' };
  return h('div', { className: 'ddt-card dim-surfaceCard' },
    h('div', { className: 'ddt-inlineError dim-inlineError', role: 'alert' },
      h('h3', null, '企业微信机器人没有绑定完成'),
      h(ConnectionError, { error: error }),
      h('span', { className: 'ddt-errorCode' }, error.code),
      h('div', { className: 'ddt-actions dim-viewActions' },
        h(Button, { kind: 'primary', onClick: onRetry, disabled: busy }, '重新生成二维码'),
        h(Button, { onClick: onClose, disabled: busy }, '关闭'))));
}

function RemoveConfirmation({ account, busy, onConfirm, onCancel }) {
  return h('div', { className: 'ddt-confirm dim-confirm', role: 'alertdialog' },
    h('strong', null, localizeTemplate('从 DeepSeek Harness 移除“{name}”？', { name: account.bot.name })),
    h('p', null, '这会停止消息连接，并删除本机保存的应用凭据、机器人配置及会话映射。企业微信平台中的机器人不会被自动删除。'),
    h('div', { className: 'ddt-actions dim-viewActions' },
      h(Button, { onClick: onCancel, disabled: busy }, '保留机器人'),
      h(Button, { kind: 'danger', onClick: onConfirm, disabled: busy }, busy ? '正在移除…' : '确认移除接入')));
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
  const tone = account.connected ? 'success' : account.state === 'error' ? 'error' : 'warning';
  const stateLabel = account.connected ? '运行正常' : account.state === 'connecting' ? '正在连接' : '连接未就绪';
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h('article', { className: 'ddt-card dim-botCard', 'data-bot-id': account.botId },
    h('div', { className: 'ddt-cardBody dim-botCardBody' },
      h(CollapsibleAccountSection, {
        settings: h(BotSettingsButton, {
          channel: 'wecom',
          botId: account.botId,
          botName: account.bot.name,
          connected: account.connected,
          accessPolicy: account.accessPolicy,
        }),
        id: `wec-settings-${account.botId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        header: h('div', { className: 'ddt-accountTop dim-botCardTop' },
        h('div', { className: 'ddt-accountIdentity dim-botIdentity' },
          h('div', { className: 'ddt-avatar dim-botAvatar dwecom-avatar', 'aria-hidden': 'true' }, h(WecomLogoGlyph, { size: 29 })),
          h('div', { className: 'dim-botName' },
            h(BotName, { bot: account.bot, disabled: Boolean(busy), onSave: onAliasSave }), h('p', null, account.bot.appIdMasked))),
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
            h(Button, { className: 'dim-cardAction', onClick: onReconnect, disabled: Boolean(busy) }, busy === 'reconnect' ? '检查中…' : account.connected ? '检查连接' : '重试连接'),
            h(Button, { className: 'dim-cardAction', kind: 'danger', onClick: onRequestRemove, disabled: Boolean(busy) }, '移除接入')),
          summary ? h('div', { className: 'ddt-summary dim-cardSummary' }, summary) : null,
          account.error ? h(ConnectionError, { error: account.error, showMessage: false }) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: 'ddt-summary',
            error: account.lastMessageError,
          }) : null,
          feedback ? h('div', {
            className: 'ddt-summary dim-cardFeedback',
            role: 'status',
            'aria-live': 'polite',
          }, feedback) : null)),
      ),
    ),
    removing ? h(RemoveConfirmation, {
      account, busy: busy === 'delete', onConfirm: onConfirmRemove, onCancel: onCancelRemove,
    }) : null);
}

export function WecomSettingsTab({ rpcCall }) {
  const [operationError, setOperationError] = React.useState(null);
  const [model, setModel] = React.useState({
    phase: 'loading', bots: [], totals: { configured: 0, connected: 0 }, error: null,
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
  const [now, setNow] = React.useState(Date.now());
  const mounted = React.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const addButtonRef = React.useRef(null);
  const noticeFrameRef = React.useRef(null);

  const announce = React.useCallback((message) => {
    if (!mounted.current) return;
    if (noticeFrameRef.current !== null) {
      window.cancelAnimationFrame(noticeFrameRef.current);
      noticeFrameRef.current = null;
    }
    setNotice('');
    if (message) {
      noticeFrameRef.current = window.requestAnimationFrame(() => {
        noticeFrameRef.current = null;
        if (mounted.current) setNotice(message);
      });
    }
  }, []);

  React.useEffect(() => {
    const disposeDingtalk = installDingtalkStyles();
    const disposeWecom = installWecomStyles();
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (noticeFrameRef.current !== null) {
        window.cancelAnimationFrame(noticeFrameRef.current);
        noticeFrameRef.current = null;
      }
      disposeWecom();
      disposeDingtalk();
    };
  }, []);

  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== 'function') throw new TypeError('企业微信设置页缺少 RPC 连接');
    const operation = !['connection.status', 'provision.poll', 'provision.begin', 'provision.cancel'].includes(endpoint);
      if (operation && mounted.current) setOperationError(null);
      try {
        const value = unwrapRpcResult(await rpcCall(endpoint, payload, signal));
        if (operation && mounted.current) setOperationError(value?.testMessage?.error ?? value?.warnings?.[0] ?? null);
        return value;
      } catch (error) {
        if (operation && mounted.current && !signal?.aborted && error?.name !== 'AbortError') setOperationError(normalizeConnectionError(error));
        throw error;
      }
  }, [rpcCall]);

  const loadStatus = React.useCallback(async ({ signal, silent = false, restore = false } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null) return undefined;
    if (!silent && mounted.current) setModel((current) => ({ ...current, phase: 'loading', error: null }));
    try {
      const snapshot = normalizeSnapshot(await invoke(WECOM_ENDPOINTS.status, {}, signal));
      if (!mounted.current || signal?.aborted
        || !workspaceFence.canCommitStatus(workspaceVersion)) return undefined;
      setModel({
        phase: 'ready', bots: snapshot.bots, totals: snapshot.totals, error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
        modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
      });
      if (restore && snapshot.provisioning) setProvision({
        ...snapshot.provisioning,
        durationMs: Math.max(1, snapshot.provisioning.expiresAt - Date.now()),
      });
      return snapshot;
    } catch (error) {
      if (error?.name !== 'AbortError' && mounted.current && !signal?.aborted
        && workspaceFence.canCommitStatus(workspaceVersion)) {
        setModel((current) => ({ ...current, phase: silent ? current.phase : 'error', error: presentError(error) }));
      }
      return undefined;
    }
  }, [invoke, workspaceFence]);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restore: true });
    return () => controller.abort();
  }, [loadStatus]);

  React.useEffect(() => {
    if (model.phase !== 'ready') return undefined;
    const controller = new AbortController();
    const timer = window.setInterval(() => void loadStatus({ signal: controller.signal, silent: true }), 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [loadStatus, model.phase]);

  React.useEffect(() => {
    if (!provision || !ACTIVE_STATES.has(provision.status)) return undefined;
    const timer = window.setInterval(() => mounted.current && setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);

  const startProvisioning = React.useCallback(async (replace = false) => {
    setCredentialOpen(false);
    setCredentialError(null);
    setBusy(true);
    try {
      if (replace && provision?.attemptId) await invoke(WECOM_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      if (!mounted.current) return;
      setProvision({ status: 'starting' });
      const started = normalizeProvisioning(await invoke(WECOM_ENDPOINTS.beginProvisioning, { locale: 'zh-CN' }));
      if (!mounted.current) return;
      setNow(Date.now());
      setProvision({ ...started, durationMs: Math.max(1, started.expiresAt - Date.now()) });
    } catch (error) {
      if (mounted.current) setProvision({ status: 'failed', error: presentError(error) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId]);

  const bindCredentials = React.useCallback(async ({ identity, secret }) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusy(true);
    setCredentialError(null);
    try {
      const snapshot = normalizeSnapshot(await invoke(
        WECOM_ENDPOINTS.bindCredentials,
        { botId: identity, secret },
      ));
      if (!mounted.current) return;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: 'ready', bots: snapshot.bots, totals: snapshot.totals, error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
      }
      setCredentialOpen(false);
    } catch (error) {
      if (mounted.current) setCredentialError(presentError(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusy(false);
    }
  }, [invoke, loadStatus, workspaceFence]);

  const closeProvision = React.useCallback(async () => {
    setBusy(true);
    try {
      if (provision?.attemptId && ACTIVE_STATES.has(provision.status)) {
        await invoke(WECOM_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      if (mounted.current) setProvision(null);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId, provision?.status]);

  React.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !ACTIVE_STATES.has(provision.status)) return undefined;
    const controller = new AbortController();
    let disposed = false;
    let timer;
    const poll = async () => {
      try {
        const current = normalizeProvisioning(await invoke(WECOM_ENDPOINTS.pollProvisioning, { attemptId }, controller.signal));
        if (disposed || controller.signal.aborted || !mounted.current) return;
        if (current.status === 'connected') {
          setProvision(null);
          await loadStatus({ signal: controller.signal, silent: true });
          return;
        }
        setProvision((previous) => previous?.attemptId === attemptId
          ? { ...previous, ...current, durationMs: current.qrRevision !== previous.qrRevision
              ? Math.max(1, current.expiresAt - Date.now()) : previous.durationMs }
          : previous);
        if (ACTIVE_STATES.has(current.status)) timer = window.setTimeout(poll, current.pollIntervalMs);
      } catch (error) {
        if (!disposed && !controller.signal.aborted && mounted.current) {
          setProvision((current) => ({ ...current, status: 'failed', error: presentError(error) }));
        }
      }
    };
    timer = window.setTimeout(poll, provision.pollIntervalMs ?? 1_000);
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer); };
  }, [invoke, loadStatus, provision?.attemptId, provision?.pollIntervalMs, provision?.status]);

  const botAction = React.useCallback(async (account, operation, endpoint, payload) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusyByBot((current) => ({ ...current, [account.botId]: operation }));
    try {
      const snapshot = normalizeSnapshot(await invoke(endpoint, payload));
      if (mounted.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: 'ready', bots: snapshot.bots, totals: snapshot.totals, error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
      }
      return snapshot;
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusyByBot((current) => {
        const next = { ...current }; delete next[account.botId]; return next;
      });
    }
  }, [invoke, loadStatus, workspaceFence]);

  const reconnect = React.useCallback(async (account) => {
    setFeedbackByBot((current) => {
      const next = { ...current };
      delete next[account.botId];
      return next;
    });
    try {
      const snapshot = await botAction(
        account,
        'reconnect',
        WECOM_ENDPOINTS.reconnectBot,
        { botId: account.botId, sendTest: true },
      );
      if (!snapshot) return;
      const refreshed = snapshot.bots.find((bot) => bot.botId === account.botId);
      let feedback;
      if (!refreshed?.connected) {
        feedback = '企业微信仍未连接，插件会继续自动重试。';
      } else if (snapshot.testMessage?.sent) {
        feedback = '企业微信连接检查完成，测试消息已发送。';
      } else if (snapshot.testMessage?.code === 'test-target-unavailable') {
        feedback = '连接检查完成。机器人尚未收到可用于测试的私聊消息。';
      } else if (snapshot.testMessage) {
        feedback = '企业微信连接检查完成，但测试消息发送失败。';
      } else {
        feedback = '企业微信连接检查完成。';
      }
      if (mounted.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback);
    } catch {
      const feedback = '连接检查失败，请稍后重试。';
      if (mounted.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback);
    }
  }, [announce, botAction]);

  let provisionView = null;
  if (provision?.status === 'starting') provisionView = h('div', { className: 'ddt-card ddt-loading dim-surfaceCard' }, h('div', { className: 'ddt-spinner' }), '正在申请企业微信二维码…');
  else if (['pending', 'refreshing'].includes(provision?.status)) provisionView = h(QrPanel, {
    provision, now, busy, onRefresh: () => void startProvisioning(true), onCancel: () => void closeProvision(),
  });
  else if (provision) provisionView = h(ProvisionView, {
    provision, busy, onRetry: () => void startProvisioning(true), onClose: () => void closeProvision(),
  });

  const botList = model.bots.length > 0
    ? h('section', { className: 'dim-listSection' },
        h(ChannelListHeading, {
          className: 'ddt-listHeading',
          title: '已绑定的企业微信机器人',
          connectionLabel: 'WebSocket 长连接',
        }),
        h('ul', { className: 'ddt-list dim-botList' }, model.bots.map((account) =>
          h('li', { key: account.botId }, h(AccountCard, {
            account,
            busy: busyByBot[account.botId],
            feedback: feedbackByBot[account.botId],
            removing: removeTarget === account.botId,
            onReconnect: () => void reconnect(account),
            onWorkspaceSave: (workspace) => botAction(
              account,
              'workspace',
              WECOM_ENDPOINTS.setWorkspace,
              { botId: account.botId, workspace },
            ),
            onAliasSave: (alias) => botAction(
              account,
              'alias',
              WECOM_ENDPOINTS.setAlias,
              { botId: account.botId, alias },
            ),
            onModelSave: (selectedModel) => botAction(
              account,
              'model',
              WECOM_ENDPOINTS.setModel,
              { botId: account.botId, model: selectedModel },
            ),
            onAgentPresetSave: (agentPreset) => botAction(
              account,
              'preset',
              WECOM_ENDPOINTS.setAgentPreset,
              { botId: account.botId, agentPreset },
            ),
            onContextEnhancementSave: (config) => botAction(
              account,
              'context-enhancement',
              WECOM_ENDPOINTS.setContextEnhancement,
              { botId: account.botId, config },
            ),
            onRequestRemove: () => setRemoveTarget(account.botId),
            onCancelRemove: () => setRemoveTarget(null),
            onConfirmRemove: async () => {
              await botAction(account, 'delete', WECOM_ENDPOINTS.deleteBot, { botId: account.botId, confirm: true });
              if (mounted.current) setRemoveTarget(null);
            },
          })))))
    : null;

  const credentialView = credentialOpen
    ? h(CredentialBindingPanel, {
        channel: '企业微信',
        identityLabel: 'Bot ID',
        identityPlaceholder: '填写企业微信智能机器人 Bot ID',
        secretLabel: 'Secret',
        secretPlaceholder: '填写企业微信智能机器人 Secret',
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
  }, h('section', { className: 'ddt-page dwecom-page dim-channelPage', 'aria-label': '企业微信设置' },
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
    model.phase === 'loading' ? h(LoadingView)
      : model.phase === 'error'
        ? h('div', { className: 'ddt-card dim-surfaceCard' }, h('div', { className: 'ddt-inlineError dim-inlineError' }, h('h3', null, localizeTemplate('无法读取 {channel} 机器人状态', { channel: channelName('企业微信') })), h(ConnectionError, { error: model.error }), h(Button, { onClick: () => void loadStatus() }, '重新读取')))
        : h(React.Fragment, null,
            credentialView,
            provisionView,
            model.bots.length === 0 && !provision && !credentialOpen
              ? h(EmptyView, { busy, onStart: () => void startProvisioning() }) : null,
            botList))));
}
