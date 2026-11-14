// Read-only directory of every DSH-IM channel and its bound DSH sessions.
// Opened from the IM settings toolbar; it has no permanent sidebar entry.
import * as React from 'react';
import { callManagementRpc } from '../management-rpc.mjs';
import { h, IM_LOCALE_NAMESPACE, imLocale, localizeTemplate, localizeText } from './i18n.js';
import { IM_MAIN_PANEL_ID } from './plugin-page.js';
export const CHANNEL_LIST_RPC_CHANNEL = '/dsh-im-channels';
export const CHANNEL_SESSIONS_PANEL_ID = 'xmanrui-dsh-im-channels';

const CHANNEL_LABELS = Object.freeze({
  matrix: 'Matrix',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  wecom: '微信客服',
  'wecom-app': '企业微信',
  feishu: '飞书',
  dingtalk: '钉钉',
  slack: 'Slack',
  discord: 'Discord',
  line: 'LINE',
  qq: 'QQ',
});

const styles = Object.freeze({
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 },
  title: { margin: 0, fontSize: 22, fontWeight: 650 },
  description: { margin: '6px 0 0', opacity: 0.68, lineHeight: 1.6 },
  button: { border: '1px solid var(--dim-border, #444)', borderRadius: 6, background: 'transparent', color: 'inherit', padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' },
  group: { marginBottom: 22 },
  groupTitle: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px', fontSize: 16 },
  count: { opacity: 0.58, fontSize: 12, fontWeight: 400 },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--dim-border, #444)', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--dim-border, #444)', opacity: 0.65, fontWeight: 500 },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--dim-border, #333)', verticalAlign: 'top' },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12, overflowWrap: 'anywhere' },
  secondary: { display: 'block', marginTop: 4, opacity: 0.55, fontSize: 11 },
  muted: { opacity: 0.65, padding: '24px 0' },
  error: { padding: 12, marginBottom: 16, borderRadius: 6, background: 'var(--dim-error-bg, rgba(220, 70, 70, .12))', color: 'var(--dim-error, #e17777)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  messageList: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 },
  message: { maxWidth: 920, padding: '12px 14px', border: '1px solid var(--dim-border, #444)', borderRadius: 10, background: 'var(--dim-bg-secondary, rgba(127, 127, 127, .06))' },
  userMessage: { borderColor: 'var(--dim-accent-border, rgba(80, 140, 220, .45))', background: 'var(--dim-accent-bg, rgba(80, 140, 220, .08))' },
  messageMeta: { display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 7, opacity: 0.62, fontSize: 12 },
  messageText: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65, fontSize: 14 },
  detailMeta: { margin: '8px 0 0', opacity: 0.68, lineHeight: 1.7, overflowWrap: 'anywhere' },
});

function formatTime(value) {
  if (!Number.isFinite(value)) return '';
  try {
    const locale = imLocale();
    const tag = locale === 'zh' ? 'zh-CN' : locale === 'ru' ? 'ru-RU' : 'en-US';
    return new Date(value).toLocaleString(tag, { hour12: false });
  } catch {
    return '';
  }
}

function text(value) {
  return String(value == null ? '' : value);
}

function errorText(error) {
  return error instanceof Error ? error.message : text(error);
}

async function copyText(value) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('浏览器未允许访问剪贴板');
}

class ChannelListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      channels: null, error: null, refreshing: false, copyStatus: null,
      selected: null, detail: null, detailError: null, detailLoading: false, loadingEarlier: false,
    };
    this.reload = this.reload.bind(this);
    this.openSession = this.openSession.bind(this);
    this.backToList = this.backToList.bind(this);
    this.loadEarlier = this.loadEarlier.bind(this);
    this.copySession = this.copySession.bind(this);
    this.unmounted = false;
    this.request = null;
    this.detailRequest = null;
    this.copyTimer = null;
  }

  componentDidMount() {
    void this.reload();
  }

  componentWillUnmount() {
    this.unmounted = true;
    this.request?.abort();
    this.detailRequest?.abort();
    if (this.copyTimer) clearTimeout(this.copyTimer);
  }

  rpc(method, payload, signal) {
    const call = this.props.channelListRpcCall || ((endpoint, body, rpcSignal) =>
      callManagementRpc(this.props.ctx.connection, CHANNEL_LIST_RPC_CHANNEL, endpoint, body, rpcSignal));
    return call(method, payload, signal);
  }

  async reload() {
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    this.setState({ refreshing: true, error: null });
    try {
      const result = await this.rpc('list.channels', {}, controller.signal);
      if (controller.signal.aborted) return;
      if (!result || result.ok !== true) {
        throw new Error(result?.error?.message || result?.error?.code || 'failed to list channels');
      }
      if (!Array.isArray(result.value?.channels)) {
        throw new Error('宿主响应缺少 value.channels，请检查 dsh-im host 是否已重载');
      }
      if (!this.unmounted) this.setState({ channels: result.value.channels });
    } catch (error) {
      if (controller.signal.aborted || this.unmounted) return;
      this.setState({ channels: null, error: errorText(error) });
    } finally {
      if (this.request === controller) {
        this.request = null;
        if (!this.unmounted) this.setState({ refreshing: false });
      }
    }
  }

  async openSession(group, row) {
    const selected = {
      channel: group.channel,
      key: text(row.key),
      botId: text(row.botId),
      sessionId: text(row.sessionId),
    };
    this.detailRequest?.abort();
    const controller = new AbortController();
    this.detailRequest = controller;
    this.setState({
      selected, detail: null, detailError: null, detailLoading: true, loadingEarlier: false,
    });
    try {
      const result = await this.rpc('session.read', selected, controller.signal);
      if (controller.signal.aborted || this.detailRequest !== controller) return;
      if (!result || result.ok !== true) {
        throw new Error(result?.error?.message || result?.error?.code || 'failed to read session');
      }
      if (!Array.isArray(result.value?.messages)) {
        throw new Error('宿主响应缺少 value.messages，请检查 dsh-im host 是否已重载');
      }
      this.setState({ detail: result.value, detailError: null });
    } catch (error) {
      if (controller.signal.aborted || this.unmounted || this.detailRequest !== controller) return;
      this.setState({ detailError: errorText(error) });
    } finally {
      if (this.detailRequest === controller) {
        this.detailRequest = null;
        if (!this.unmounted) this.setState({ detailLoading: false });
      }
    }
  }

  backToList() {
    this.detailRequest?.abort();
    this.detailRequest = null;
    this.setState({
      selected: null, detail: null, detailError: null, detailLoading: false, loadingEarlier: false,
    });
  }

  async loadEarlier() {
    const { selected, detail } = this.state;
    if (!selected || !detail?.hasMore || this.detailRequest) return;
    const controller = new AbortController();
    this.detailRequest = controller;
    this.setState({ loadingEarlier: true, detailError: null });
    try {
      const result = await this.rpc('session.read', {
        ...selected, offset: detail.nextOffset, limit: detail.limit,
      }, controller.signal);
      if (controller.signal.aborted || this.detailRequest !== controller) return;
      if (!result || result.ok !== true) {
        throw new Error(result?.error?.message || result?.error?.code || 'failed to read earlier messages');
      }
      if (!Array.isArray(result.value?.messages)) throw new Error('宿主响应缺少 value.messages');
      const earlier = result.value;
      this.setState(previous => {
        if (!previous.detail) return null;
        // The oldest page is still limit-sized. Keep only the part before the
        // page already displayed, and retain the original snapshot's total.
        const prependCount = Math.max(0, previous.detail.offset - earlier.offset);
        return {
          detail: {
            ...previous.detail,
            offset: earlier.offset,
            hasMore: earlier.hasMore,
            nextOffset: earlier.nextOffset,
            messages: [
              ...earlier.messages.slice(0, prependCount),
              ...previous.detail.messages,
            ],
          },
        };
      });
    } catch (error) {
      if (controller.signal.aborted || this.unmounted || this.detailRequest !== controller) return;
      this.setState({ detailError: errorText(error) });
    } finally {
      if (this.detailRequest === controller) {
        this.detailRequest = null;
        if (!this.unmounted) this.setState({ loadingEarlier: false });
      }
    }
  }

  async copySession(sessionId) {
    try {
      await copyText(sessionId);
      if (!this.unmounted) this.setState({ copyStatus: { sessionId, ok: true } });
    } catch {
      if (!this.unmounted) this.setState({ copyStatus: { sessionId, ok: false } });
    }
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => {
      if (!this.unmounted) this.setState({ copyStatus: null });
    }, 1800);
  }

  renderRow(group, row) {
    const sessionId = text(row.sessionId);
    const status = this.state.copyStatus?.sessionId === sessionId ? this.state.copyStatus : null;
    return h('tr', { key: `${group.channel}:${row.botId}:${row.key}:${sessionId}` },
      h('td', { style: styles.td },
        h('code', { style: styles.code }, text(row.key)),
        h('span', { style: styles.secondary }, `bot：${text(row.botId)}`)),
      h('td', { style: styles.td },
        h('button', {
          type: 'button', style: { ...styles.button, ...styles.code, padding: '4px 6px', textAlign: 'left' },
          className: 'im-channel-session-open', onClick: () => { void this.openSession(group, row); },
          'aria-label': localizeTemplate('查看会话 {sessionId}', { sessionId }), title: '查看该会话的用户与助手正文',
        }, sessionId)),
      h('td', { style: { ...styles.td, width: 88 } },
        h('button', {
          type: 'button', style: styles.button, className: 'im-channel-session-copy',
          onClick: () => { void this.copySession(sessionId); },
          'aria-label': localizeTemplate('复制会话 ID {sessionId}', { sessionId }),
        }, status ? (status.ok ? '已复制' : '复制失败') : '复制 ID')));
  }

  renderGroup(group) {
    const label = CHANNEL_LABELS[group.channel] || group.channel;
    const rows = Array.isArray(group.sessions) ? group.sessions : [];
    return h('section', { key: group.channel, className: 'im-channel-group', style: styles.group },
      h('h2', { style: styles.groupTitle }, label,
        group.channel === label ? null : h('span', { style: styles.count }, group.channel),
        h('span', { style: styles.count }, localizeTemplate('{count} 个会话', { count: rows.length }))),
      h('div', { style: styles.tableWrap },
        h('table', { style: styles.table },
          h('thead', null, h('tr', null,
            h('th', { style: styles.th }, '通道 / 会话键'),
            h('th', { style: styles.th }, 'DSH 会话 ID'),
            h('th', { style: styles.th }, '操作'))),
          h('tbody', null, rows.map(row => this.renderRow(group, row))))));
  }

  renderMessage(message) {
    const role = message.role === 'user' ? '用户' : '助手';
    const time = formatTime(message.time);
    return h('article', {
      key: message.id || `${message.seq}:${message.role}`,
      className: `im-channel-message im-channel-message-${message.role}`,
      style: { ...styles.message, ...(message.role === 'user' ? styles.userMessage : null) },
    },
    h('div', { style: styles.messageMeta },
      h('strong', null, role),
      h('span', null, time || (Number.isInteger(message.seq)
        ? localizeTemplate('事件 {seq}', { seq: message.seq }) : ''))),
    h('div', { style: styles.messageText }, text(message.text)),
    message.truncated ? h('div', { style: styles.secondary }, '本条消息过长，已截断。') : null);
  }

  renderDetail() {
    const { selected, detail, detailError, detailLoading, loadingEarlier, copyStatus } = this.state;
    const label = CHANNEL_LABELS[selected.channel] || selected.channel;
    const copyState = copyStatus?.sessionId === selected.sessionId ? copyStatus : null;
    let body;
    if (detailLoading && !detail) {
      body = h('p', { style: styles.muted }, '加载中…');
    } else if (!detail) {
      body = null;
    } else if (detail.messages.length === 0) {
      body = h('p', { style: styles.muted }, '没有可显示的用户或助手正文。');
    } else {
      body = h('div', { className: 'im-channel-message-list', style: styles.messageList },
        detail.messages.map(message => this.renderMessage(message)));
    }
    return h(React.Fragment, null,
      h('header', { style: { ...styles.header, flexWrap: 'wrap' } },
        h('div', null,
          h('h1', { style: styles.title }, '会话内容'),
          h('p', { style: styles.detailMeta }, `${label} · ${selected.key}`),
          h('code', { style: styles.code }, selected.sessionId),
          h('p', { style: styles.description }, '只读显示用户与助手正文；系统提示、工具调用和内部推理不显示。')),
        h('div', { style: styles.actions },
          this.renderBackToIm(),
          h('button', { type: 'button', className: 'im-channel-back', style: styles.button, onClick: this.backToList }, '返回列表'),
          h('button', {
            type: 'button', className: 'im-channel-detail-refresh', style: styles.button,
            disabled: detailLoading || loadingEarlier,
            onClick: () => { void this.openSession(selected, selected); },
          }, detailLoading ? '刷新中…' : '刷新'),
          h('button', {
            type: 'button', className: 'im-channel-detail-copy', style: styles.button,
            onClick: () => { void this.copySession(selected.sessionId); },
          }, copyState ? (copyState.ok ? '已复制' : '复制失败') : '复制 ID'))),
      detailError ? h('div', { role: 'alert', style: styles.error },
        localizeTemplate('读取失败：{error}', { error: localizeText(detailError) })) : null,
      detail ? h('div', { style: { marginBottom: 12 } },
        h('p', { style: { ...styles.description, margin: '0 0 10px' } },
          localizeTemplate('已显示 {shown} / {total} 条正文', {
            shown: detail.messages.length, total: detail.total,
          })),
        detail.hasMore ? h('button', {
          type: 'button', className: 'im-channel-load-earlier', style: styles.button,
          onClick: this.loadEarlier, disabled: loadingEarlier,
        }, loadingEarlier ? '加载中…' : '加载更早消息') : null) : null,
      body);
  }

  renderBackToIm() {
    return this.props.onBackToIm ? h('button', {
      type: 'button', className: 'im-channel-back-to-im', style: styles.button,
      onClick: this.props.onBackToIm,
    }, '返回 IM机器人') : null;
  }

  render() {
    const { channels, error, refreshing, selected } = this.state;
    if (selected) {
      return h('div', { className: 'dim-pluginPage im-channel-session-detail' },
        h('div', { className: 'dim-pluginPageContent' }, this.renderDetail()));
    }
    let body;
    if (error) {
      body = h('div', { role: 'alert', style: styles.error },
        localizeTemplate('加载失败：{error}', { error: localizeText(error) }));
    } else if (!channels) {
      body = h('p', { style: styles.muted }, '正在读取通道会话…');
    } else if (channels.length === 0) {
      body = h('p', { style: styles.muted }, '尚未发现已绑定 DSH 会话的通道。');
    } else {
      body = channels.map(group => this.renderGroup(group));
    }
    return h('div', { className: 'dim-pluginPage im-channel-sessions-page' },
      h('div', { className: 'dim-pluginPageContent' },
        h('header', { style: { ...styles.header, flexWrap: 'wrap' } },
          h('div', null,
            h('h1', { style: styles.title }, '会话记录'),
            h('p', { style: styles.description }, '只读列出各 IM 通道当前绑定的 DSH 会话；点击会话 ID 查看正文，不会修改绑定。')),
          h('div', { style: styles.actions },
            this.renderBackToIm(),
            h('button', { type: 'button', className: 'im-channel-refresh', style: styles.button, onClick: this.reload, disabled: refreshing },
              refreshing ? '刷新中…' : '刷新'))),
        body));
  }
}

export function ChannelSessionsPanel(props) {
  return h(ChannelListPage, props);
}

export function installChannelSessionsPage(ctx, { channelListRpcCall }) {
  let navigate = null;
  const listeners = new Set();
  const publish = (value) => {
    navigate = value;
    for (const listener of listeners) listener();
  };
  // Only offer the toolbar action while both navigation and its target slot
  // exist. Late services and plugin disposal must not leave a dead button.
  const controller = {
    available: () => navigate !== null,
    open: () => navigate?.(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  if (typeof ctx.inject === 'function') {
    ctx.inject(['layout'], pageCtx => pageCtx.slots.inject('main', () => {
      const stopMain = pageCtx.slots.register({
        name: 'main', key: CHANNEL_SESSIONS_PANEL_ID, locale: IM_LOCALE_NAMESPACE,
        inject: () => ({
          channelListRpcCall,
          onBackToIm: () => pageCtx.layout.selectPanel(IM_MAIN_PANEL_ID),
        }),
      }, ChannelSessionsPanel);
      publish(() => pageCtx.layout.selectPanel(CHANNEL_SESSIONS_PANEL_ID));
      return () => { publish(null); stopMain(); };
    }));
  }
  return controller;
}
