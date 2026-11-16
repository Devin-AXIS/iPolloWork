import { ConnectionError, normalizeConnectionError } from '../../connection-error.js';
import { BotName } from '../../bot-alias.js';
import * as React from 'react';

import { WecomLogoGlyph } from '../../channel-logos.js';
import { AccountSettingsToggle, CollapsibleAccountSection } from '../shared/collapsible-account.js';
import { h, localizeTemplate } from '../../i18n.js';
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
  WECOM_APP_ENDPOINTS,
  normalizeSnapshot,
  presentError,
  unwrapRpcResult,
} from './api.js';
import { installWecomAppStyles } from './styles.js';

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

function Heading({ totals, adding, busy, onAdd, addButtonRef }) {
  return h('div', { className: 'ddt-heading' },
    h('div', { className: 'ddt-tools' },
      h('div', { className: 'dim-bindActions' },
        h(Button, {
          kind: 'primary',
          className: 'dim-scanButton',
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          'aria-label': '添加企业微信自建应用',
        }, adding ? '收起表单' : '添加企业微信应用')),
      totals.configured > 0
        ? h('div', { className: 'ddt-badge dim-onlineBadge' },
            h('span', null, localizeTemplate('{connected} / {configured} 在线', { connected: totals.connected, configured: totals.configured })))
        : null));
}

function LoadingView() {
  return h('div', { className: 'ddt-card ddt-loading dim-surfaceCard dim-loadingView', 'aria-busy': 'true' },
    h('div', { className: 'ddt-spinner dim-spinner' }),
    h('span', null, '正在读取企业微信应用状态…'));
}

function EmptyView({ busy, onStart }) {
  return h('div', { className: 'ddt-card dim-surfaceCard' },
    h('div', { className: 'ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView' },
      h('div', { className: 'dim-emptyCopy' },
        h('div', { className: 'ddt-stateLabel dim-stateLabel' },
          h('span', { className: 'ddt-dot dim-stateDot' }), h('span', null, '尚未绑定企业微信应用')),
        h('h3', null, '在企业微信中创建自建应用，即可在微信里使用'),
        h('p', null, '在应用管理后台创建自建应用，开启「接收消息」并填入下面的参数。成员的微信关注该企业的微信插件后，就能在微信中与本应用双向对话。'),
        h('div', { className: 'ddt-actions dim-viewActions' },
          h(Button, { kind: 'primary', onClick: onStart, disabled: busy }, '填写应用参数'))),
      h('div', { className: 'ddt-brandMark dim-emptyBrand dwecomapp-brand', 'aria-hidden': 'true' },
        h(WecomLogoGlyph, { size: 64 }))));
}

function Field({ label, value, onChange, placeholder, busy, required = false, type = 'text' }) {
  return h('label', { className: 'dim-credentialField' },
    h('span', null, label),
    h('input', {
      value,
      onChange: (event) => onChange(event.target.value),
      placeholder,
      type,
      autoCapitalize: 'none',
      autoCorrect: 'off',
      spellCheck: false,
      autoComplete: 'off',
      disabled: busy,
      required,
    }));
}

function BindForm({ busy, error, onSubmit, onCancel }) {
  const [corpId, setCorpId] = React.useState('');
  const [agentId, setAgentId] = React.useState('');
  const [secret, setSecret] = React.useState('');
  const [token, setToken] = React.useState('');
  const [aesKey, setAesKey] = React.useState('');
  const [apiBaseUrl, setApiBaseUrl] = React.useState('');
  const [callbackBaseUrl, setCallbackBaseUrl] = React.useState('');
  const [streamEnabled, setStreamEnabled] = React.useState(true);
  const headingId = React.useId();
  const formRef = React.useRef(null);

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    void onSubmit?.({
      corpId: corpId.trim(),
      agentId: agentId.trim(),
      secret: secret.trim(),
      token: token.trim(),
      encodingAESKey: aesKey.trim(),
      apiBaseUrl: apiBaseUrl.trim() || undefined,
      callbackBaseUrl: callbackBaseUrl.trim() || undefined,
      streamEnabled,
    });
  };

  return h('section', {
    className: 'ddt-card dim-surfaceCard dim-credentialPanel',
    'aria-labelledby': headingId,
  },
  h('h3', { id: headingId, className: 'dim-credentialTitle' }, '绑定企业微信自建应用'),
  h('form', { ref: formRef, className: 'dim-credentialForm', onSubmit: submit },
    h('div', { className: 'dim-appFieldGrid' },
      h(Field, { label: '企业 ID（CorpID）', value: corpId, onChange: setCorpId, placeholder: '例如 ww1234567890abcdef', busy, required: true }),
      h(Field, { label: '应用 AgentId', value: agentId, onChange: setAgentId, placeholder: '例如 1000002', busy, required: true }),
      h(Field, { label: '应用 Secret', value: secret, onChange: setSecret, placeholder: '应用详情页的 Secret', busy, required: true, type: 'password' }),
      h(Field, { label: '回调 Token', value: token, onChange: setToken, placeholder: '接收消息 → API 接收中的 Token', busy, required: true, type: 'password' }),
      h(Field, { label: 'EncodingAESKey', value: aesKey, onChange: setAesKey, placeholder: '43 位字母或数字', busy, required: true, type: 'password' }),
      h(Field, { label: '代理地址（可选）', value: apiBaseUrl, onChange: setApiBaseUrl, placeholder: '留空直连 qyapi.weixin.qq.com', busy })),
    h('div', { className: 'dim-appFieldGrid' },
      h(Field, { label: '公网回调基址（可选）', value: callbackBaseUrl, onChange: setCallbackBaseUrl, placeholder: '例如 https://im.example.com', busy }),
      h('div', { className: 'dim-appSwitchRow' },
        h('button', {
          type: 'button',
          className: 'ddt-button dim-streamToggle',
          'aria-pressed': streamEnabled ? 'true' : 'false',
          onClick: () => setStreamEnabled((value) => !value),
          disabled: busy,
        }, streamEnabled ? '流式回复：开' : '流式回复：关'),
        h('span', { className: 'dim-switchHint' }, '企业微信客户端实时出字；微信端不支持时自动改为整段发送'))),
    error ? h('div', { className: 'ddt-inlineError dim-inlineError', role: 'alert' }, h(ConnectionError, { error: error })) : null,
    h('div', { className: 'ddt-actions dim-viewActions' },
      h(Button, { kind: 'primary', onClick: () => formRef.current?.requestSubmit(), disabled: busy }, busy ? '正在绑定…' : '保存并连接'),
      h(Button, { kind: 'quiet', onClick: onCancel, disabled: busy }, '取消'))));
}

function CallbackUrlBox({ url, busy, resetBusy, onCopy, onReset }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
    onCopy?.();
  };
  return h('div', { className: 'dim-callbackBox' },
    h('strong', null, '回调 URL（填入企业微信后台「接收消息 → 设置API接收」）'),
    h('div', { className: 'dim-callbackRow' },
      h('input', {
        value: url || '未配置公网回调基址：请在本页「设置」中填写回调基址，或手动拼接 回调基址 + 路径',
        readOnly: true,
        onFocus: (event) => event.target.select?.(),
      }),
      url ? h(Button, { onClick: copy, disabled: busy, small: true }, copied ? '已复制' : '复制') : null,
      h(Button, { kind: 'danger', onClick: onReset, disabled: busy || resetBusy }, resetBusy ? '重置中…' : '重置密钥')),
    h('span', { className: 'dim-callbackHint' },
      '重置密钥后回调 URL 会变化，需要同步更新企业微信后台。若公网反代未就绪，可临时使用 http://服务器IP:端口 形式的回调地址。'));
}

function AppSettingsEditor({ bot, busy, onSave }) {
  const [apiBaseUrl, setApiBaseUrl] = React.useState(bot.apiBaseUrl ?? '');
  const [callbackBaseUrl, setCallbackBaseUrl] = React.useState(bot.callbackBaseUrl ?? '');
  const [streamEnabled, setStreamEnabled] = React.useState(bot.streamEnabled !== false);
  const [dirty, setDirty] = React.useState(false);
  const formRef = React.useRef(null);
  React.useEffect(() => {
    setApiBaseUrl(bot.apiBaseUrl ?? '');
    setCallbackBaseUrl(bot.callbackBaseUrl ?? '');
    setStreamEnabled(bot.streamEnabled !== false);
    setDirty(false);
  }, [bot.apiBaseUrl, bot.callbackBaseUrl, bot.streamEnabled]);
  const touch = () => setDirty(true);
  const save = (event) => {
    event.preventDefault();
    if (!dirty || busy) return;
    void onSave({
      apiBaseUrl: apiBaseUrl.trim() || null,
      callbackBaseUrl: callbackBaseUrl.trim() || null,
      streamEnabled,
    });
    setDirty(false);
  };
  return h('form', { ref: formRef, className: 'dim-appFieldGrid', onSubmit: save },
    h(Field, { label: '代理地址（可选）', value: apiBaseUrl, onChange: (value) => { setApiBaseUrl(value); touch(); }, placeholder: '留空直连 qyapi.weixin.qq.com', busy }),
    h(Field, { label: '公网回调基址（可选）', value: callbackBaseUrl, onChange: (value) => { setCallbackBaseUrl(value); touch(); }, placeholder: '例如 https://im.example.com', busy }),
    h('div', { className: 'dim-appSwitchRow' },
      h('button', {
        type: 'button',
        className: 'ddt-button dim-streamToggle',
        'aria-pressed': streamEnabled ? 'true' : 'false',
        onClick: () => { setStreamEnabled((value) => !value); touch(); },
        disabled: busy,
      }, streamEnabled ? '流式回复：开' : '流式回复：关')),
    h('div', { className: 'ddt-actions dim-viewActions' },
      h(Button, { onClick: () => formRef.current?.requestSubmit(), disabled: busy || !dirty }, busy ? '保存中…' : '保存设置')));
}

function RemoveConfirmation({ account, busy, onConfirm, onCancel }) {
  return h('div', { className: 'ddt-confirm dim-confirm', role: 'alertdialog' },
    h('strong', null, localizeTemplate('从 DeepSeek Harness 移除“{name}”？', { name: account.bot.name })),
    h('p', null, '这会删除本机保存的应用凭据、回调配置及会话映射。企业微信后台的应用不会被删除。'),
    h('div', { className: 'ddt-actions dim-viewActions' },
      h(Button, { onClick: onCancel, disabled: busy }, '保留应用'),
      h(Button, { kind: 'danger', onClick: onConfirm, disabled: busy }, busy ? '正在移除…' : '确认移除接入')));
}

export function AccountCard({
  account,
  busy,
  feedback,
  removing,
  onReconnect,
  onSettingsSave,
  onSecretReset,
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
  const elementId = `wecomapp-settings-${account.botId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return h('article', { className: 'ddt-card dim-botCard', 'data-bot-id': account.botId },
    h('div', { className: 'ddt-cardBody dim-botCardBody' },
      h(CollapsibleAccountSection, {
        settings: h(BotSettingsButton, {
          channel: 'wecomApp',
          botId: account.botId,
          botName: account.bot.name,
          connected: account.connected,
          accessPolicy: account.accessPolicy,
        }),
        id: elementId,
        header: h('div', { className: 'ddt-accountTop dim-botCardTop' },
        h('div', { className: 'ddt-accountIdentity dim-botIdentity' },
          h('div', { className: 'ddt-avatar dim-botAvatar dwecomapp-avatar', 'aria-hidden': 'true' }, h(WecomLogoGlyph, { size: 29 })),
          h('div', { className: 'dim-botName' },
            h(BotName, { bot: account.bot, disabled: Boolean(busy), onSave: onAliasSave }),
            h('p', null, `${account.bot.corpIdMasked} · AgentId ${account.bot.agentId}`))),
        h('div', {
            className: 'dim-botCardTools',
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
        h(CallbackUrlBox, {
          url: account.bot.callbackUrl,
          busy: Boolean(busy),
          resetBusy: busy === 'reset',
          onReset: onSecretReset,
        }),
        h(AppSettingsEditor, {
          bot: account.bot,
          busy: Boolean(busy),
          onSave: onSettingsSave,
        }),
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

export function WecomAppSettingsTab({ rpcCall }) {
  const [operationError, setOperationError] = React.useState(null);
  const [model, setModel] = React.useState({
    phase: 'loading', bots: [], totals: { configured: 0, connected: 0 }, error: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG,
    modelCatalog: EMPTY_MODEL_CATALOG,
  });
  const [bindOpen, setBindOpen] = React.useState(false);
  const [bindError, setBindError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [busyByBot, setBusyByBot] = React.useState({});
  const [feedbackByBot, setFeedbackByBot] = React.useState({});
  const [removeTarget, setRemoveTarget] = React.useState(null);
  const [notice, setNotice] = React.useState('');
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
    const disposeWecomApp = installWecomAppStyles();
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (noticeFrameRef.current !== null) {
        window.cancelAnimationFrame(noticeFrameRef.current);
        noticeFrameRef.current = null;
      }
      disposeWecomApp();
      disposeDingtalk();
    };
  }, []);

  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== 'function') throw new TypeError('企业微信应用设置页缺少 RPC 连接');
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
      const snapshot = normalizeSnapshot(await invoke(WECOM_APP_ENDPOINTS.status, {}, signal));
      if (!mounted.current || signal?.aborted
        || !workspaceFence.canCommitStatus(workspaceVersion)) return undefined;
      setModel({
        phase: 'ready', bots: snapshot.bots, totals: snapshot.totals, error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
        modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
      });
      if (restore && snapshot.bots.length > 0) setBindOpen(false);
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

  const bindApp = React.useCallback(async (payload) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusy(true);
    setBindError(null);
    try {
      const snapshot = normalizeSnapshot(await invoke(WECOM_APP_ENDPOINTS.bindApp, payload));
      if (!mounted.current) return;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: 'ready', bots: snapshot.bots, totals: snapshot.totals, error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
          modelCatalog: snapshot.modelCatalog ?? EMPTY_MODEL_CATALOG,
        });
      }
      setBindOpen(false);
      announce('企业微信应用已绑定。请把回调 URL 填入企业微信后台并保存。');
    } catch (error) {
      if (mounted.current) setBindError(presentError(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusy(false);
    }
  }, [announce, invoke, loadStatus, workspaceFence]);

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
        WECOM_APP_ENDPOINTS.reconnectBot,
        { botId: account.botId, sendTest: true },
      );
      if (!snapshot) return;
      const refreshed = snapshot.bots.find((bot) => bot.botId === account.botId);
      let feedback;
      if (!refreshed?.connected) {
        feedback = '企业微信应用仍未就绪，插件会继续自动重试。';
      } else if (snapshot.testMessage?.sent) {
        feedback = '连接检查完成，测试消息已发送。';
      } else if (snapshot.testMessage?.code === 'test-target-unavailable') {
        feedback = '连接检查完成。应用尚未收到可用于测试的私聊消息。';
      } else if (snapshot.testMessage) {
        feedback = '连接检查完成，但测试消息发送失败。';
      } else {
        feedback = '连接检查完成。';
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

  const botList = model.bots.length > 0
    ? h('section', { className: 'dim-listSection' },
        h(ChannelListHeading, {
          className: 'ddt-listHeading',
          title: '已绑定的企业微信应用',
          connectionLabel: 'HTTP 回调通道',
        }),
        h('ul', { className: 'ddt-list dim-botList' }, model.bots.map((account) =>
          h('li', { key: account.botId }, h(AccountCard, {
            account,
            busy: busyByBot[account.botId],
            feedback: feedbackByBot[account.botId],
            removing: removeTarget === account.botId,
            onReconnect: () => void reconnect(account),
            onSettingsSave: (settings) => botAction(
              account,
              'settings',
              WECOM_APP_ENDPOINTS.updateSettings,
              { botId: account.botId, ...settings },
            ),
            onSecretReset: async () => {
              try {
                await botAction(account, 'reset', WECOM_APP_ENDPOINTS.resetCallbackSecret, { botId: account.botId });
                announce('回调密钥已重置，请把新的回调 URL 更新到企业微信后台。');
              } catch {
                announce('回调密钥重置失败，请稍后重试。');
              }
            },
            onWorkspaceSave: (workspace) => botAction(
              account,
              'workspace',
              WECOM_APP_ENDPOINTS.setWorkspace,
              { botId: account.botId, workspace },
            ),
            onAliasSave: (alias) => botAction(
              account,
              'alias',
              WECOM_APP_ENDPOINTS.setAlias,
              { botId: account.botId, alias },
            ),
            onModelSave: (selectedModel) => botAction(
              account,
              'model',
              WECOM_APP_ENDPOINTS.setModel,
              { botId: account.botId, model: selectedModel },
            ),
            onAgentPresetSave: (agentPreset) => botAction(
              account,
              'preset',
              WECOM_APP_ENDPOINTS.setAgentPreset,
              { botId: account.botId, agentPreset },
            ),
            onContextEnhancementSave: (config) => botAction(
              account,
              'context-enhancement',
              WECOM_APP_ENDPOINTS.setContextEnhancement,
              { botId: account.botId, config },
            ),
            onRequestRemove: () => setRemoveTarget(account.botId),
            onCancelRemove: () => setRemoveTarget(null),
            onConfirmRemove: async () => {
              await botAction(account, 'delete', WECOM_APP_ENDPOINTS.deleteBot, { botId: account.botId, confirm: true });
              if (mounted.current) setRemoveTarget(null);
            },
          })))))
    : null;

  const bindView = bindOpen
    ? h(BindForm, {
        busy,
        error: bindError,
        onSubmit: bindApp,
        onCancel: () => { setBindOpen(false); setBindError(null); },
      })
    : null;

  return h(ModelCatalogContext.Provider, {
    value: model.modelCatalog ?? EMPTY_MODEL_CATALOG,
  }, h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
  }, h('section', { className: 'ddt-page dwecomapp-page dim-channelPage', 'aria-label': '企业微信应用设置' },
    operationError ? h(ConnectionError, { error: operationError }) : null,
    h(Heading, {
      totals: model.totals,
      adding: bindOpen,
      busy,
      onAdd: () => { setBindOpen((value) => !value); setBindError(null); },
      addButtonRef,
    }),
    h('div', { className: 'ddt-visuallyHidden', role: 'status', 'aria-live': 'polite' }, notice),
    model.phase === 'loading' ? h(LoadingView)
      : model.phase === 'error'
        ? h('div', { className: 'ddt-card dim-surfaceCard' }, h('div', { className: 'ddt-inlineError dim-inlineError' }, h('h3', null, '无法读取企业微信应用状态'), h(ConnectionError, { error: model.error }), h(Button, { onClick: () => void loadStatus() }, '重新读取')))
        : h(React.Fragment, null,
            bindView,
            model.bots.length === 0 && !bindOpen
              ? h(EmptyView, { busy, onStart: () => setBindOpen(true) }) : null,
            botList))));
}
