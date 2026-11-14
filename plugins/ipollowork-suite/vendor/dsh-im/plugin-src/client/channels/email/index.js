import { ConnectionError } from '../../connection-error.js';
import * as React from 'react';
import { EmailLogoGlyph } from '../../channel-logos.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import { EMAIL_ENDPOINTS, emailClientApi } from './api.js';
import { installEmailStyles } from './styles.js';
import { h } from '../../i18n.js';

/**
 * Provider presets mirror the host-side table so the form can prefill hosts.
 * Keeping the copy local means the panel works before any RPC round-trip.
 */
const PROVIDERS = [
  { key: 'qq', label: 'QQ 邮箱', imapHost: 'imap.qq.com', imapPort: 993, smtpHost: 'smtp.qq.com', smtpPort: 465 },
  { key: '163', label: '163 邮箱', imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465 },
  { key: 'gmail', label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  { key: 'custom', label: '自定义服务器' },
];

const PROVIDER_HINTS = {
  qq: '在 QQ 邮箱「设置 → 账户」中开启 IMAP/SMTP 服务，并生成 16 位授权码（不是登录密码）。',
  '163': '在 163 邮箱「设置 → POP3/SMTP/IMAP」中开启服务，并新增授权密码。',
  gmail: '需要先开启两步验证，再生成「应用专用密码」。',
  custom: '请填写邮箱服务商提供的 IMAP 与 SMTP 服务器地址及端口。',
};

/**
 * How the mailbox is reached. Mirrors the Host's EMAIL_TRANSPORTS: the choice
 * decides which fields the form asks for, so one channel serves every mail
 * protocol instead of one tab per protocol.
 */
const TRANSPORTS = [
  {
    key: 'imap-smtp',
    label: 'IMAP / SMTP（任意邮箱）',
    hint: '用邮箱地址 + 授权码接入，适用于 QQ、163、Gmail 及自建邮箱。',
    needsPassword: true,
    needsProvider: true,
    needsHosts: true,
  },
  {
    key: 'agent-mail',
    label: '腾讯 Agent 邮箱',
    hint: '用微信扫码授权接入，无需授权码与服务器地址。',
    needsPassword: false,
    needsProvider: false,
    needsHosts: false,
  },
];

function field(label, control, hint) {
  return h('label', { className: 'dim-emailField' },
    h('span', null, label),
    control,
    hint ? h('span', { className: 'dim-emailHint' }, hint) : null);
}

/**
 * The "waiting for authorization" line, split into translatable pieces. The
 * validity window is the server's, not an assumed one.
 */
function waitingHint(session) {
  const minutes = session?.expiresInMs ? Math.round(session.expiresInMs / 60_000) : null;
  if (!minutes) return ['等待授权中…'];
  return ['等待授权中，', String(minutes), ' 分钟', '内有效，可保持本页打开。'];
}

/** How often the bindable session list is refreshed while the panel is open. */
const SESSION_REFRESH_MS = 15_000;

/**
 * QR authorization for the Agent mailbox.
 *
 * There is no one-shot scan payload: the authorization page embeds its own
 * WeChat QR, so the user opens this URL (or scans it) and signs in there. The
 * page is polled until the server reports the authorization.
 */
function AgentMailAuth({ rpcCall, endpoints, disabled, address = '', onAuthorized, onError, blocked = false }) {
  const [session, setSession] = React.useState(null);
  const [status, setStatus] = React.useState('idle');
  const [error, setError] = React.useState(null);

  const invoke = React.useCallback(async (endpoint, payload) => {
    const response = await rpcCall(endpoint, payload);
    if (response && typeof response === 'object' && 'ok' in response) {
      if (response.ok === false) throw new Error(response.error?.message ?? '请求失败');
      return response.value;
    }
    return response;
  }, [rpcCall]);

  const begin = async () => {
    setError(null);
    setStatus('starting');
    try {
      // The CLI isolates accounts per workspace, so the address being added
      // becomes its workspace — otherwise every Agent mailbox shares the first
      // login and shows that account's address.
      const started = await invoke(endpoints.startAuth, {
        transport: 'agent-mail',
        ...(address.trim() ? { workspace: address.trim().toLowerCase() } : {}),
      });
      setSession(started);
      setStatus('waiting');
    } catch (startError) {
      setStatus('idle');
      setError(startError);
      onError?.(startError);
    }
  };

  // Poll while waiting; the authorization happens in another tab or app.
  React.useEffect(() => {
    if (status !== 'waiting' || !session) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const result = await invoke(endpoints.pollAuth, {});
        if (cancelled) return;
        if (result?.authorized) {
          setStatus('authorized');
          onAuthorized?.({
            transport: 'agent-mail',
            // agently-cli keeps the credentials in the system keychain, so no
            // token passes through here — only the address to bind.
            // The server resolves the mailbox address; carry it through or the
            // field stays empty and the bind has nothing to use.
            ...(result.address ? { address: result.address } : {}),
          });
        }
      } catch (pollError) {
        if (cancelled) return;
        // Stop waiting and say so: silently dropping back to idle left the user
        // staring at "connecting" while nothing was happening.
        setStatus('idle');
        setSession(null);
        setError(pollError);
        onError?.(pollError);
      }
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [endpoints, invoke, onAuthorized, session, status]);

  if (status === 'authorized') {
    // The panel submits on its own, but only once an address and at least one
    // allowed sender exist; say so rather than implying work is under way.
    return h('p', { className: 'dim-emailHint', role: 'status' },
      blocked
        ? '授权成功；请填写邮箱地址与允许的发件人后完成接入。'
        : '授权成功，正在接入邮箱…');
  }

  return h('div', { className: 'dim-emailAuth' },
    h('p', { className: 'dim-emailHint' },
      '腾讯 Agent 邮箱需要微信扫码授权。点下面的按钮生成授权链接，在打开的页面里用微信扫码登录并确认。'),
    session
      ? h('div', { className: 'dim-emailAuthPanel' },
        h('div', { className: 'dim-emailAuthRow' },
          h('span', null, '授权链接'),
          h('a', {
            href: session.browserUrl, target: '_blank', rel: 'noreferrer',
            className: 'dim-emailAuthLink',
          }, session.browserUrl)),
        session.inputCode
          ? h('div', { className: 'dim-emailAuthRow' },
            h('span', null, '配对码'),
            h('code', null, session.inputCode))
          : null,
        h('p', { className: 'dim-emailHint' },
          status === 'waiting'
            // Plain strings only (a template literal with mixed quotes trips the
            // i18n guard), and the window comes from the server rather than an
            // assumed five minutes.
            ? h('span', null, ...waitingHint(session))
            : null))
      : null,
    error ? h(ConnectionError, { error: error }) : null,
    h('div', { className: 'ddt-actions dim-viewActions' },
      h('button', {
        type: 'button', className: 'ddt-button', disabled: disabled || status === 'starting',
        onClick: () => { void begin(); },
      }, !session ? '生成授权链接' : '重新生成')));
}

/**
 * Mailbox credential form: address + app password + provider (or explicit
 * hosts) + the sender allowlist, which is required because a mail address is
 * forgeable and an open mailbox would let anyone drive the Harness.
 */
function MailboxPanel({ busy, error, onSubmit, onCancel, rpcCall, endpoints }) {
  const [transportKey, setTransportKey] = React.useState('imap-smtp');
  // Held only in memory: the panel hands the pair straight to the bind call.
  const [tokens, setTokens] = React.useState(null);
  // A completed authorization submits on its own; the user should not have to
  // click again after scanning.
  const [autoBind, setAutoBind] = React.useState(null);
  const [provider, setProvider] = React.useState('qq');
  const [address, setAddress] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [allowedSenders, setAllowedSenders] = React.useState('');
  const [imapHost, setImapHost] = React.useState('');
  const [imapPort, setImapPort] = React.useState('');
  const [smtpHost, setSmtpHost] = React.useState('');
  const [smtpPort, setSmtpPort] = React.useState('');
  const transport = TRANSPORTS.find((entry) => entry.key === transportKey) ?? TRANSPORTS[0];
  const custom = transport.needsProvider && provider === 'custom';
  // The Agent mailbox authorizes by QR code, so it has no password to collect.
  const isAgentMail = transport.key === 'agent-mail';
  const maySubmit = Boolean(address.trim())
    && (!transport.needsPassword || Boolean(password))
    && (!isAgentMail || Boolean(tokens));

  // `granted` lets the auto-submit path pass the tokens it just received,
  // since React state has not re-rendered with them yet.
  const submit = (granted = null) => onSubmit({
    // Prefer the typed address, but an Agent mailbox gets one from the server.
    address: (address.trim() || granted?.address || ''),
    transport: transport.key,
    ...(transport.needsPassword ? { password } : {}),
    ...(isAgentMail && (granted ?? tokens) ? { ...(granted ?? tokens) } : {}),
    ...(transport.needsProvider ? { provider } : {}),
    allowedSenders: allowedSenders
      .split(/[\s,;，；]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    ...(custom ? {
      imapHost: imapHost.trim(), imapPort: imapPort.trim() || undefined,
      smtpHost: smtpHost.trim(), smtpPort: smtpPort.trim() || undefined,
    } : {}),
  });

  // Once an authorization lands, finish the job without a second click.
  React.useEffect(() => {
    if (!autoBind || busy) return;
    // The address may have arrived with the authorization.
    if (!address.trim() && !autoBind.address) return;
    const senders = allowedSenders.split(/[\s,;，；]+/).map((v) => v.trim()).filter(Boolean);
    // An empty allowlist is allowed: the mailbox connects first and senders are
    // authorized later. It stays fail-closed, so nobody can drive it yet.
    // Consume the pending bind first so a re-render cannot submit twice.
    setAutoBind(null);
    onSubmit({
      // The server-resolved address is used when the field is still empty.
      address: (address.trim() || autoBind.address || ''),
      transport: transport.key,
      ...(isAgentMail ? { ...autoBind } : {}),
      allowedSenders: senders,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBind, address, allowedSenders, busy]);

  return h('section', { className: 'ddt-card dim-surfaceCard dim-emailPanel' },
    h('h3', null, '接入邮箱'),
    h('p', null, 'DeepSeek Harness 会读取该邮箱的新邮件作为指令，并在同一邮件线程内回复处理结果。'),
    h('div', { className: 'dim-emailFields' },
      field('接入方式', h('select', {
        value: transportKey,
        onChange: (event) => setTransportKey(event.target.value),
        disabled: busy,
      }, TRANSPORTS.map((entry) => h('option', { key: entry.key, value: entry.key }, entry.label))),
      h('span', { className: 'dim-emailHint' }, transport.hint)),
      field('邮箱地址',
        h('input', {
          type: 'email', value: address, disabled: busy,
          // The Agent mailbox address comes from the authorization, so it is
          // filled in rather than typed.
          ...(isAgentMail
            ? { readOnly: true, placeholder: '授权后自动填入' }
            : { placeholder: 'your-name@qq.com',
              onChange: (event) => setAddress(event.target.value) }),
        }),
        isAgentMail ? '由授权结果自动填入，无需手工填写。' : null),
      transport.needsProvider ? field('邮箱服务商', h('select', {
        value: provider,
        onChange: (event) => setProvider(event.target.value),
        disabled: busy,
      }, PROVIDERS.map((entry) => h('option', { key: entry.key, value: entry.key }, entry.label))),
      h('span', { className: 'dim-emailHint' }, PROVIDER_HINTS[provider])) : null,
      transport.needsPassword ? field('应用密码 / 授权码', h('input', {
        type: 'password', value: password, placeholder: 'IMAP/SMTP 授权码', disabled: busy,
        onChange: (event) => setPassword(event.target.value),
      }), '不是邮箱登录密码；请在邮箱设置中单独生成。') : null,
      custom ? h('div', { className: 'dim-emailGrid' },
        field('IMAP 服务器', h('input', {
          value: imapHost, placeholder: 'imap.example.com', disabled: busy,
          onChange: (event) => setImapHost(event.target.value),
        })),
        field('端口', h('input', {
          value: imapPort, placeholder: '993', disabled: busy,
          onChange: (event) => setImapPort(event.target.value),
        }))) : null,
      custom ? h('div', { className: 'dim-emailGrid' },
        field('SMTP 服务器', h('input', {
          value: smtpHost, placeholder: 'smtp.example.com', disabled: busy,
          onChange: (event) => setSmtpHost(event.target.value),
        })),
        field('端口', h('input', {
          value: smtpPort, placeholder: '465', disabled: busy,
          onChange: (event) => setSmtpPort(event.target.value),
        }))) : null,
      isAgentMail
        ? h(AgentMailAuth, {
          rpcCall,
          endpoints,
          disabled: busy,
          // The address doubles as the CLI workspace, so the component needs it.
          address,
          // Auto-submit: the panel says "connecting", so it must actually
          // connect. Requiring a second click stranded users who had already
          // scanned, and a reload lost the token entirely.
          onAuthorized: (granted) => {
            // The server resolves the address, so the field fills itself.
            if (granted?.address) setAddress(granted.address);
            setTokens(granted);
            setAutoBind(granted);
          },
          // Only the address gates authorization: the allowlist is optional now,
          // and requiring it here made the button unclickable for a new mailbox.
          blocked: !address.trim() && !tokens?.address,
          onError: () => setTokens(null),
        })
        : null,
      field('允许的发件人', h('textarea', {
        value: allowedSenders, disabled: busy,
        placeholder: 'me@example.com\n同事@example.com',
        onChange: (event) => setAllowedSenders(event.target.value),
      }), '必填。只有这些地址发来的邮件会触发 Harness；多个地址用换行或逗号分隔。')),
    error ? h(ConnectionError, { error: error }) : null,
    h('div', { className: 'ddt-actions dim-viewActions' },
      h('button', { type: 'button', className: 'ddt-button', onClick: onCancel, disabled: busy }, '取消'),
      h('button', {
        type: 'button', className: 'ddt-button', 'data-kind': 'primary',
        // Wrap so the click event is not mistaken for granted tokens.
        onClick: () => submit(), disabled: busy || !maySubmit,
      }, busy ? '正在连接邮箱…' : '连接邮箱')));
}

/**
 * Session binding: how incoming mail maps onto Harness sessions.
 *
 * Three levels, highest first:
 *   1. a per-sender binding,
 *   2. the account-wide binding,
 *   3. no binding — every mail thread starts its own session.
 */
/**
 * Session ids are long uuids. The picker shows the title, falling back to a
 * shortened id, because the per-sender column is too narrow for the full id.
 */
function shortenSessionId(sessionId) {
  const text = String(sessionId ?? '');
  return text.length <= 20 ? text : `${text.slice(0, 8)}…${text.slice(-6)}`;
}

/**
 * Pickers are narrow, so a very long title is trimmed from the middle with the
 * tail kept — automation titles carry their distinguishing timestamp at the
 * end. The full id remains the option's tooltip.
 */
function sessionLabel(session) {
  const title = String(session?.title ?? '').trim();
  if (!title) return shortenSessionId(session?.sessionId);
  if (title.length <= 22) return title;
  // 13px CJK / 7px latin: 22 visible characters stay inside the ~200px the
  // narrowest picker gives the label.
  return `${title.slice(0, 12)}…${title.slice(-8)}`;
}

function SessionBindingPanel({
  account, rpcCall, endpoints, onChanged, disabled, registerReload = null,
}) {
  const [binding, setBinding] = React.useState(null);
  const [sessions, setSessions] = React.useState([]);
  const [accountSession, setAccountSession] = React.useState('');
  const [senderRows, setSenderRows] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);

  // The card receives the raw RPC bridge, whose response wraps the payload in
  // { ok, value }; the settings panel works with the unwrapped value.
  const invoke = React.useCallback(async (endpoint, payload) => {
    const response = await rpcCall(endpoint, payload);
    if (response && typeof response === 'object' && 'ok' in response) {
      if (response.ok === false) {
        throw new Error(response.error?.message ?? '请求失败');
      }
      return response.value;
    }
    return response;
  }, [rpcCall]);

  const load = React.useCallback(async () => {
    if (typeof rpcCall !== 'function') return;
    try {
      const [current, listed] = await Promise.all([
        invoke(endpoints.getBinding, { botId: account.botId }),
        invoke(endpoints.listSessions, { botId: account.botId }),
      ]);
      setBinding(current);
      setAccountSession(current?.account ?? '');
      const senders = current?.senders ?? {};
      setSenderRows((current?.knownSenders ?? []).map((address) => ({
        address, sessionId: senders[address] ?? '',
      })));
      setSessions(Array.isArray(listed?.sessions) ? listed.sessions : []);
    } catch (loadError) {
      setError(loadError);
    }
  }, [account.botId, endpoints, invoke, rpcCall]);

  React.useEffect(() => { void load(); }, [load]);
  // Let the allowlist form refresh this panel: the allowlist decides which
  // senders get a row, and the parent's own reload only re-reads channel state.
  React.useEffect(() => {
    registerReload?.(load);
    return () => registerReload?.(null);
  }, [load, registerReload]);

  // Sessions are created elsewhere — chats, automations, other channels — so a
  // list fetched once when the panel opened goes stale while it stays open.
  React.useEffect(() => {
    if (typeof rpcCall !== 'function') return undefined;
    let cancelled = false;
    const refresh = setInterval(async () => {
      try {
        const listed = await invoke(endpoints.listSessions, { botId: account.botId });
        if (cancelled) return;
        setSessions(Array.isArray(listed?.sessions) ? listed.sessions : []);
      } catch {
        // A failed refresh keeps the list already on screen.
      }
    }, SESSION_REFRESH_MS);
    // A background timer must not hold a process open (server-side render,
    // tests, or a headless client).
    refresh.unref?.();
    return () => { cancelled = true; clearInterval(refresh); };
  }, [account.botId, endpoints, invoke, rpcCall]);

  const persist = async (nextAccount, nextRows) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const senders = {};
      for (const row of nextRows) {
        if (row?.address && row.sessionId) senders[row.address] = row.sessionId;
      }
      await invoke(endpoints.setBinding, {
        botId: account.botId,
        account: nextAccount || null,
        senders,
      });
      setNotice('会话绑定已保存。');
      await onChanged?.({ silent: true });
    } catch (saveError) {
      setError(saveError);
    } finally {
      setBusy(false);
    }
  };

  const options = (selected, placeholder) => [
    h('option', { key: '__none', value: '' }, placeholder),
    ...sessions.map((session) => h('option', {
      key: session.sessionId,
      value: session.sessionId,
      // The full id is a long uuid; it stays available as the tooltip and the
      // value, while the visible label keeps the title within the narrow
      // per-sender column.
      title: session.sessionId,
    }, sessionLabel(session))),
    // Keep an unknown-but-set id selectable so loading never silently drops it.
    ...(selected && !sessions.some((s) => s.sessionId === selected)
      ? [h('option', { key: selected, value: selected, title: selected }, shortenSessionId(selected))]
      : []),
  ];

  // The picker truncates long titles, so the current choice is echoed in full
  // underneath it; nothing is lost to the narrow column.
  const selectionHint = (sessionId) => {
    if (!sessionId) return null;
    const found = sessions.find((session) => session.sessionId === sessionId);
    const title = String(found?.title ?? '').trim();
    if (!title || title.length <= 28) return null;
    // Split so the prefix is translated while the title stays verbatim.
    return h('span', { className: 'dim-emailHint dim-emailBindingSelected', title },
      '已选：', title);
  };

  const locked = disabled || busy;

  return h('section', { className: 'dim-emailPanel dim-emailBinding' },
    h('div', { className: 'dim-emailBindingHead' },
      h('h4', null, '会话绑定'),
      // The list also refreshes on a timer; this is for an immediate re-read.
      h('button', {
        type: 'button', className: 'ddt-button', disabled: locked,
        onClick: () => { void load(); },
      }, '刷新会话列表')),
    h('p', { className: 'dim-emailHint' },
      '不绑定则每封新邮件开启一个新会话；绑定固定会话后，来信都在该会话内继续。'),
    h('div', { className: 'dim-emailFields' },
      field('固定会话（账号级）',
        h('select', {
          value: accountSession,
          disabled: locked,
          onChange: (event) => setAccountSession(event.target.value),
        }, options(accountSession, '不绑定（每封新邮件新建会话）')),
        selectionHint(accountSession)),
      senderRows.length
        ? h('div', { className: 'dim-emailFields' },
          h('span', { className: 'dim-emailHint' }, '按发件人覆盖（优先于账号级）'),
          ...senderRows.map((row, index) => h('div', { key: row.address, className: 'dim-emailBindingRow' },
            h('span', { className: 'dim-emailBindingSender', title: row.address }, row.address),
            h('select', {
              value: row.sessionId,
              disabled: locked,
              onChange: (event) => {
                const next = [...senderRows];
                next[index] = { ...row, sessionId: event.target.value };
                setSenderRows(next);
              },
            }, options(row.sessionId, '跟随账号级')))),
          // Several senders often belong together; one click points them all at
          // the same session instead of repeating the choice per row.
          h('div', { className: 'ddt-actions dim-viewActions' },
            h('button', {
              type: 'button', className: 'ddt-button', disabled: locked || !accountSession,
              onClick: () => setSenderRows(senderRows.map((row) => ({ ...row, sessionId: accountSession }))),
            }, '所有发件人同上')))
        : h('p', { className: 'dim-emailHint' }, '尚无可覆盖的发件人（先在上方配置允许的发件人）。')),
    error ? h(ConnectionError, { error: error }) : null,
    notice ? h('p', { className: 'dim-emailHint', role: 'status' }, notice) : null,
    h('div', { className: 'ddt-actions dim-viewActions' },
      h('button', {
        type: 'button', className: 'ddt-button', disabled: locked,
        onClick: () => { void persist(accountSession, senderRows); },
      }, busy ? '正在保存…' : '保存绑定'),
      h('button', {
        type: 'button', className: 'ddt-button', disabled: locked,
        onClick: () => {
          setAccountSession('');
          const cleared = senderRows.map((row) => ({ ...row, sessionId: '' }));
          setSenderRows(cleared);
          void persist('', cleared);
        },
      }, '清除绑定')));
}

/** Per-account settings: edit hosts and the allowlist without reconnecting. */
/**
 * Re-authorize an already-bound Agent mailbox.
 *
 * agently-cli holds the login, and it can expire or be dropped. Reconnecting
 * cannot fix that — the login itself has to be renewed — so the same scan the
 * add form uses is offered here.
 */
function MailboxReauthorize({ address, disabled, rpcCall, endpoints, onDone }) {
  const [session, setSession] = React.useState(null);
  const done = session !== null;
  const invoke = React.useCallback(async (endpoint, payload) => {
    const response = await rpcCall(endpoint, payload);
    if (response && typeof response === 'object' && 'ok' in response) {
      if (response.ok === false) throw new Error(response.error?.message ?? '请求失败');
      return response.value;
    }
    return response;
  }, [rpcCall]);

  // The scan happens in another tab or on a phone, so the outcome is polled.
  React.useEffect(() => {
    if (!done) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const result = await invoke(endpoints.pollAuth, {});
        if (cancelled || !result?.authorized) return;
        clearInterval(timer);
        await onDone?.({ silent: true });
      } catch {
        // A failed poll keeps waiting; the scan may still be in flight.
      }
    }, 3_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [done, endpoints, invoke, onDone]);

  return h('div', { className: 'dim-emailAuth' },
    h('p', { className: 'dim-emailHint' },
      done
        ? '已生成授权链接：在打开的页面里用微信扫码并确认，连接会自动恢复。'
        : '当前邮箱的授权已失效。重新扫码即可恢复，无需移除这个邮箱。'),
    done
      ? h('div', { className: 'dim-emailAuthPanel' },
        session.browserUrl
          ? h('div', { className: 'dim-emailAuthRow' },
            h('span', null, '授权链接'),
            h('a', {
              href: session.browserUrl, target: '_blank', rel: 'noreferrer',
              className: 'dim-emailAuthLink',
            }, session.browserUrl))
          : h('p', { className: 'dim-emailHint' }, '未能获取授权链接，请重新生成。'),
        session.inputCode
          ? h('div', { className: 'dim-emailAuthRow' },
            h('span', null, '配对码'),
            h('code', null, session.inputCode))
          : null,
        h('p', { className: 'dim-emailHint' }, '等待扫码完成…'))
      : null,
    h('div', { className: 'ddt-actions dim-viewActions' },
      h('button', {
        type: 'button', className: 'ddt-button', disabled,
        onClick: async () => {
          // The address doubles as the CLI workspace, so the scan lands in the
          // same one this mailbox reads from.
          const started = await invoke(endpoints.startAuth, {
            transport: 'agent-mail', workspace: address,
          });
          // The link is what the user scans or opens, so it must be shown.
          setSession(started ?? {});
        },
      }, done ? '重新生成' : '重新扫码授权')));
}

function MailboxSettings({ account, busy, error, onSave, onCancel, rpcCall, endpoints, onChanged }) {
  // The settings panel shows the re-authorize control only for the transport
  // that authorizes out of band.
  const isAgentMail = (account?.transport ?? 'imap-smtp') === 'agent-mail';
  const [allowedSenders, setAllowedSenders] = React.useState(
    (account?.allowedSenders ?? []).join('\n'),
  );
  // The binding panel owns the sender rows; saving the allowlist must reload
  // that panel, because the parent's own reload only re-reads channel state.
  const bindingReload = React.useRef(null);
  const saveAllowlist = async () => {
    const senders = allowedSenders
      .split(/[\s,;，；]+/).map((value) => value.trim()).filter(Boolean);
    await onSave?.({ allowedSenders: senders });
    await onChanged?.({ silent: true });
    await bindingReload.current?.();
  };
  return h('section', { className: 'dim-emailPanel' },
    // An Agent mailbox authorizes against agently-cli, whose login can lapse.
    // Without this the only way back was to remove and re-add the mailbox.
    isAgentMail
      ? h(MailboxReauthorize, {
        address: account?.platformId ?? '',
        disabled: busy,
        rpcCall,
        endpoints,
        onDone: onChanged,
      })
      : null,
    h('div', { className: 'dim-emailFields' },
      field('允许的发件人', h('textarea', {
        value: allowedSenders, disabled: busy,
        onChange: (event) => setAllowedSenders(event.target.value),
      }), '保存后会重新连接邮箱以使设置立即生效。')),
    error ? h(ConnectionError, { error: error }) : null,
    h('div', { className: 'ddt-actions dim-viewActions' },
      h('button', { type: 'button', className: 'ddt-button', onClick: onCancel, disabled: busy }, '取消'),
      h('button', {
        type: 'button', className: 'ddt-button', 'data-kind': 'primary', disabled: busy,
        onClick: () => { void saveAllowlist(); },
      }, busy ? '正在保存…' : '保存')),
    h(SessionBindingPanel, {
      account, rpcCall, endpoints, onChanged, disabled: busy,
      registerReload: (reloadFn) => { bindingReload.current = reloadFn; },
    }));
}

export const EMAIL_SETTINGS_DEFINITION = Object.freeze({
  channel: 'Email',
  endpoints: EMAIL_ENDPOINTS,
  api: emailClientApi,
  LogoGlyph: EmailLogoGlyph,
  installStyles: installEmailStyles,
  pageClass: 'dim-pageEmail',
  avatarClass: 'dim-avatarEmail',
  connectionLabel: ' IMAP/SMTP 邮箱',
  tokenPlaceholder: '',
  emptyTitle: '接入邮箱',
  emptyDescription: '使用现有邮箱收发指令：邮件进来触发 Harness，处理结果以回信形式送达。',
  platformLabel: '邮箱地址',
  // The mailbox form supplies every field itself: the address is the identity
  // and the password is the secret, so the values pass through unchanged
  // rather than being reduced to a single token.
  credentialPayload: (values) => values,
  CredentialPanel: MailboxPanel,
  credentialAriaLabel: '配置邮箱收发',
  credentialOpenLabel: '配置邮箱',
  credentialNoun: '邮箱配置',
  emptyActionLabel: '配置邮箱',
  AccountSettings: MailboxSettings,
  accountSettingsEndpoint: EMAIL_ENDPOINTS.updateMailbox,
});

const channel = createTokenChannelSettings(EMAIL_SETTINGS_DEFINITION);

export const EmailSettingsTab = channel.SettingsTab;
export const EmailAccountCard = channel.AccountCard;

/**
 * Whether the Host currently offers the email channel.
 *
 * The Host is the single authority on the channel's availability. The
 * settings rail asks once through this hook and simply omits the mailbox entry
 * point while it is closed — an absent default (`null`, before the answer
 * arrives, or when the call fails) hides the entry rather than briefly flashing
 * a form the Host would refuse.
 */
export function useEmailChannelEnabled(rpcCall) {
  const [enabled, setEnabled] = React.useState(null);
  React.useEffect(() => {
    if (typeof rpcCall !== 'function') return undefined;
    let active = true;
    Promise.resolve()
      .then(() => rpcCall(EMAIL_ENDPOINTS.availability, {}))
      .then((result) => {
        if (!active) return;
        const value = result?.ok === false ? null : (result?.value ?? result);
        setEnabled(value?.enabled === true);
      })
      .catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, [rpcCall]);
  return enabled === true;
}
