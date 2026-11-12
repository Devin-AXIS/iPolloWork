window.__ModuleLoader__.load({
  id: '@ipollo/dsh-enterprise-connector',
  factory(require) {
    const React = require('react')
    const { IconUsersOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React
    const PANEL = 'ipollo-enterprise-join'
    const NS = 'ipolloEnterpriseJoin'
    const API = '/ipollo-enterprise/api'
    const zh = {
      panel: '加入企业', title: '连接企业空间', intro: '使用管理员提供的 OS 企业地址与加入码，登录后加入已有企业。',
      origin: '企业服务地址', code: '企业加入码', invitation: '粘贴邀请信息', invitationHint: '可粘贴 OS 复制的企业地址和加入码',
      verify: '验证企业地址', verified: '已验证企业', email: 'iPollo Account 邮箱', password: '账号密码',
      account: '账号服务地址', advanced: '账号服务设置', login: '登录并加入企业', back: '更换企业地址',
      insecureAccount: '此账号服务使用 HTTP，登录信息会以未加密方式传输。我确认使用管理员提供的这个地址',
      loginHint: '密码只发送至下方显示的账号服务，插件不保存密码。', accountHost: '登录服务',
      connections: '已连接企业', empty: '还没有连接企业', add: '加入其他企业', close: '返回已连接企业',
      loading: '正在读取…', working: '正在处理…', refresh: '重新检查权限', workspace: '在企业工作区新建会话',
      workspaceHint: '使用此设备上的 DSH 原生工作区；会话不会自动上传或变成多人共享会话。',
      reauth: '重新登录', checking: '尚未验证',
      disconnect: '断开此设备', disconnectHint: '移除本机连接，企业成员和已有会话会保留。',
      overview: '连接信息', members: '企业成员', departments: '企业部门', role: '企业角色', status: '成员状态',
      expires: '登录有效期', active: '有效成员', more: '加载更多', noItems: '暂无记录', connected: '已加入企业',
      sessionStarted: '已打开企业工作区', owner: '所有者', admin: '管理员', member: '成员',
      template_admin: '模板管理员', extension_admin: '插件管理员', skill_admin: '技能管理员',
      error: '连接未完成，请检查企业服务是否可访问。', invalid_enterprise_url: '请填写完整的企业 HTTP(S) 地址。',
      https_required: '公网服务请使用 HTTPS；局域网地址可以使用 HTTP。', invalid_join_code: '请填写管理员提供的十位企业加入码。',
      incompatible_enterprise: '此地址不是兼容的 OS 企业服务，请从 OS 的企业管理设置复制当前生效地址。',
      invalid_login: '请填写正确的账号邮箱和密码。', invalid_input: '请检查填写的信息。',
      connection_failed: '无法连接服务。请确认 OS 企业入口已就绪，且此设备能够访问该地址。',
      JOIN_CODE_NOT_FOUND: '企业加入码无效，请联系管理员核对。', MEMBER_SUSPENDED: '该企业已停用此成员，请联系管理员。',
      enterprise_member_inactive: '成员已被停用或已离开企业，无法继续访问。',
      MEMBER_IDENTITY_CONFLICT: '此邮箱已绑定其他账号，请联系企业管理员。',
      invalid_identity_token: '账号服务与企业配置不匹配，或登录已失效。请核对账号服务地址。',
      unauthorized: '账号或密码不正确，或企业登录已过期。', forbidden: '当前成员没有此项权限。',
      INVALID_EMAIL_OR_PASSWORD: '账号或密码不正确。', INVALID_EMAIL_PASSWORD: '账号或密码不正确。', invalid_credentials: '账号或密码不正确。',
      enterprise_session_expired: '企业登录已过期，请使用企业地址和加入码重新登录。',
      enterprise_session_secret_required: 'OS 企业服务尚未配置好登录凭证，请联系管理员。',
      identity_changed: '企业或成员身份发生变化，请重新连接。', invalid_response: '企业服务返回的数据不完整。',
      invalid_join_response: '企业身份或登录凭证不匹配，连接未保存。', account_token_missing: '账号服务未返回登录凭证。',
      identity_token_missing: '账号服务未返回企业身份凭证。', connection_not_found: '此设备上没有这条企业连接。',
      enterprise_unavailable: '企业服务暂时不可用，请稍后重试。',
      invalid_saved_connections: '本机保存的企业连接无法读取，请在 DSH 凭据管理中移除此插件的连接记录后重新加入。',
      body_too_large: '提交内容过长，请只填写企业连接和登录信息。',
    }
    const en = {
      panel: 'Join enterprise', title: 'Connect an enterprise', intro: 'Use the OS enterprise address and join code provided by your administrator.',
      origin: 'Enterprise URL', code: 'Enterprise join code', invitation: 'Paste invitation', invitationHint: 'Paste the URL and join code copied from OS',
      verify: 'Verify enterprise', verified: 'Verified enterprise', email: 'iPollo Account email', password: 'Account password',
      account: 'Account service URL', advanced: 'Account service settings', login: 'Sign in and join', back: 'Change enterprise URL',
      insecureAccount: 'This account service uses unencrypted HTTP. I confirm using this address supplied by my administrator.',
      loginHint: 'Your password is sent only to the account service shown below. The plugin does not store it.', accountHost: 'Sign-in service',
      connections: 'Connected enterprises', empty: 'No connected enterprise', add: 'Join another enterprise', close: 'Back to connections',
      loading: 'Loading…', working: 'Working…', refresh: 'Check access again', workspace: 'Start a session in the enterprise workspace',
      workspaceHint: 'Uses a native DSH workspace on this device. Sessions are not automatically uploaded or shared with colleagues.',
      reauth: 'Sign in again', checking: 'Not verified',
      disconnect: 'Disconnect this device', disconnectHint: 'Removes this connection; enterprise membership and existing sessions are retained.',
      overview: 'Connection', members: 'Members', departments: 'Departments', role: 'Role', status: 'Membership', expires: 'Sign-in expires',
      active: 'Active member', more: 'Load more', noItems: 'No entries', connected: 'Enterprise joined', sessionStarted: 'Workspace opened',
      owner: 'Owner', admin: 'Administrator', member: 'Member', template_admin: 'Template administrator', extension_admin: 'Plugin administrator', skill_admin: 'Skill administrator',
      error: 'Connection failed. Check that the enterprise service is reachable.',
      invalid_enterprise_url: 'Enter a complete HTTP(S) enterprise URL.', https_required: 'Public services require HTTPS. Local network addresses may use HTTP.',
      invalid_join_code: 'Enter the ten-character code provided by your administrator.', incompatible_enterprise: 'This is not a compatible OS enterprise endpoint.',
      invalid_login: 'Enter your account email and password.', invalid_input: 'Check the entered information.', connection_failed: 'Cannot reach the service. Check the OS enterprise endpoint and network.',
      JOIN_CODE_NOT_FOUND: 'Invalid join code. Ask your administrator for the current code.', MEMBER_SUSPENDED: 'Your membership has been suspended.',
      enterprise_member_inactive: 'Your membership is inactive.', MEMBER_IDENTITY_CONFLICT: 'This email is already bound to another account.',
      invalid_identity_token: 'The account provider does not match the enterprise configuration, or your sign-in has expired.',
      unauthorized: 'Incorrect credentials or an expired enterprise sign-in.', forbidden: 'Your membership does not allow this action.',
      INVALID_EMAIL_OR_PASSWORD: 'Incorrect email or password.', INVALID_EMAIL_PASSWORD: 'Incorrect email or password.', invalid_credentials: 'Incorrect email or password.',
      enterprise_session_expired: 'Your enterprise sign-in has expired. Sign in again using the enterprise URL and join code.',
      enterprise_session_secret_required: 'The OS enterprise sign-in service is not configured.', identity_changed: 'Enterprise or member identity changed. Reconnect to continue.',
      invalid_response: 'The enterprise returned an incomplete response.', invalid_join_response: 'The enterprise identity or sign-in response did not match.',
      account_token_missing: 'The account service returned no sign-in credential.', identity_token_missing: 'The account service returned no enterprise identity.',
      connection_not_found: 'This device has no such connection.', enterprise_unavailable: 'The enterprise service is temporarily unavailable.',
      invalid_saved_connections: 'The saved connection cannot be read. Remove this plugin’s connection record in DSH credentials and join again.',
      body_too_large: 'The submitted connection information is too long.',
    }
    const styles = `
      .iec{height:100%;overflow:auto;padding:max(28px,var(--dsh-frame-top-clearance,0px)) clamp(18px,4vw,56px);color:var(--dsw-alias-label-primary);font-family:inherit;box-sizing:border-box}
      .iec *{box-sizing:border-box}.iec header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
      .iec h1{font-size:24px;font-weight:500;line-height:1.35;margin:0 0 8px}.iec h2{font-size:17px;font-weight:500;margin:0 0 16px}.iec strong{font-weight:500}
      .iec p{line-height:1.6;margin:8px 0;color:var(--dsw-alias-label-secondary)}.iec main{max-width:780px}
      .iec form,.iec section{display:grid;gap:16px}.iec label{display:grid;gap:7px;font-size:13px;font-weight:500}
      .iec input,.iec textarea,.iec select{font:inherit;color:inherit;background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;min-width:0;width:100%}
      .iec textarea{min-height:70px;resize:vertical}.iec input:focus-visible,.iec textarea:focus-visible,.iec select:focus-visible,.iec button:focus-visible{outline:2px solid var(--dsw-alias-border-selected);outline-offset:2px}
      .iec button{font:inherit;cursor:pointer;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 14px;color:inherit;background:transparent;min-height:38px}
      .iec button:disabled{opacity:.5;cursor:default}.iec .iec-primary{background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);border-color:transparent}
      .iec .iec-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.iec .iec-box{border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;padding:22px}
      .iec .iec-error{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 14px;line-height:1.6;color:inherit}.iec .iec-notice{font-size:13px;line-height:1.65}
      .iec .iec-verified{padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}.iec .iec-verified strong{display:block;margin:5px 0}
      .iec small{font-size:12px;color:var(--dsw-alias-label-secondary)}.iec details summary{cursor:pointer;font-size:13px;margin-bottom:12px}
      .iec .iec-check{display:flex;align-items:flex-start;gap:10px;font-weight:400;line-height:1.6}.iec .iec-check input{width:auto;margin-top:4px}
      .iec nav{display:flex;gap:8px;border-bottom:.5px solid var(--dsw-alias-border-l1);padding:12px 0;margin-bottom:20px}.iec nav button{border:0;border-radius:6px}.iec nav button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover)}
      .iec dl{display:grid;grid-template-columns:130px minmax(0,1fr);gap:12px;margin:0}.iec dt{font-size:13px;color:var(--dsw-alias-label-secondary)}.iec dd{margin:0;overflow-wrap:anywhere;font-size:13px}
      .iec ul{list-style:none;margin:0;padding:0}.iec li{padding:13px 0;border-bottom:.5px solid var(--dsw-alias-border-l1);display:grid;gap:4px}.iec li:last-child{border:0}
      @media(max-width:600px){.iec{padding:20px 16px}.iec header{align-items:flex-start;flex-direction:column}.iec .iec-box{padding:16px}.iec input{font-size:16px}.iec dl{grid-template-columns:1fr;gap:6px}.iec dd{margin-bottom:10px}}
    `

    async function api(path, body, signal) {
      const response = await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
        cache: 'no-store', signal, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const value = await response.json().catch(() => null)
      if (!response.ok || value === null) throw new Error(value?.error ?? 'enterprise_unavailable')
      return value
    }

    function Panel({ t, localeStore, actions }) {
      const locale = useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot, localeStore.getSnapshot)
      const [state, setState] = useState(null)
      const [selected, setSelected] = useState('')
      const [adding, setAdding] = useState(false)
      const [origin, setOrigin] = useState('')
      const [code, setCode] = useState('')
      const [accountOrigin, setAccountOrigin] = useState('')
      const [verified, setVerified] = useState(null)
      const [email, setEmail] = useState('')
      const [password, setPassword] = useState('')
      const [insecureAccount, setInsecureAccount] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [tab, setTab] = useState('overview')
      const [directory, setDirectory] = useState(null)
      const [accessVerified, setAccessVerified] = useState(false)
      const generation = useRef(0)
      const mounted = useRef(true)
      const lifetime = useRef(null)
      const connection = state?.connections.find(item => item.id === selected)
      const language = locale?.active ?? 'en'
      const message = code => (Object.hasOwn(language.toLowerCase().startsWith('zh') ? zh : en, code) ? t(code) : t('error')).replace(/。$/, '')
      const field = (label, value, setter, options = {}) => h('label', null, t(label), h('input', {
        value, onChange: event => setter(event.target.value), disabled: busy, required: true, ...options,
      }))
      const button = (label, onClick, primary = false, disabled = false) => h('button', { type: 'button', disabled: busy || disabled, onClick,
        ...(primary ? { className: 'iec-primary' } : {}) }, t(busy ? 'working' : label))
      const load = async (signal) => {
        const data = await api('/state', undefined, signal)
        if (!mounted.current) return
        setState(data)
        setAccountOrigin(current => current || data.accountOrigin)
        setSelected(current => data.connections.some(item => item.id === current) ? current : data.connections[0]?.id ?? '')
      }
      useEffect(() => {
        mounted.current = true
        const abort = new AbortController()
        lifetime.current = abort
        load(abort.signal).catch(error => { if (!abort.signal.aborted) setError(message(error.message)) })
        return () => { mounted.current = false; abort.abort(); generation.current++ }
      }, [])
      const run = async operation => {
        if (busy) return
        setBusy(true); setError('')
        try { await operation(lifetime.current.signal) }
        catch (error) { if (mounted.current && !lifetime.current.signal.aborted) setError(message(error.message)) }
        finally { if (mounted.current) setBusy(false) }
      }
      useEffect(() => {
        const current = ++generation.current
        setDirectory(null)
        setAccessVerified(false)
        setError('')
        if (!selected || adding) return
        const abort = new AbortController()
        const signal = AbortSignal.any([abort.signal, lifetime.current.signal])
        const path = tab === 'overview' ? '/membership' : '/' + tab
        api(`${path}?id=${encodeURIComponent(selected)}`, undefined, signal).then(data => {
          if (generation.current !== current) return
          setAccessVerified(true)
          if (tab === 'overview') setState(previous => ({ ...previous, connections: previous.connections.map(item => item.id === selected ? data.connection : item) }))
          else setDirectory(data)
        }).catch(error => { if (!signal.aborted && generation.current === current) setError(message(error.message)) })
        return () => abort.abort()
      }, [selected, tab, adding])

      const verify = event => { event.preventDefault(); run(async signal => {
        const data = await api('/discover', { origin }, signal)
        if (mounted.current) setVerified(data.enterprise)
      }) }
      const joinEnterprise = event => { event.preventDefault(); run(async signal => {
        try {
          const data = await api('/join', { origin: verified.origin, joinCode: code, email, password, accountOrigin, allowInsecureAccount: insecureAccount }, signal)
          if (!mounted.current) return
          await load(signal); setSelected(data.connection.id); setAdding(false); setVerified(null); setCode(''); setTab('overview')
        } finally { if (mounted.current) setPassword('') }
      }) }
      const pasteInvitation = text => {
        const url = text.match(/https?:\/\/[^\s<>"'，）]+/)
        const join = text.match(/\b([A-Z2-9]{5})-?([A-Z2-9]{5})\b/i)
        if (url) setOrigin(url[0])
        if (join) setCode(`${join[1]}-${join[2]}`.toUpperCase())
      }
      const refresh = () => run(async signal => {
        setAccessVerified(false)
        await api('/membership?id=' + encodeURIComponent(selected), undefined, signal)
        await load(signal); setAccessVerified(true)
      })
      const openWorkspace = () => run(async signal => {
        const data = await api('/workspace', { id: selected }, signal)
        await actions.startSession(data.workspaceId)
      })
      const disconnect = () => run(async signal => {
        await api('/disconnect', { id: selected }, signal)
        await load(signal); setDirectory(null); setTab('overview')
      })
      const more = () => run(async signal => {
        const page = await api(`/${tab}?id=${encodeURIComponent(selected)}&cursor=${encodeURIComponent(directory.nextCursor)}`, undefined, signal)
        setDirectory(current => ({ items: [...current.items, ...page.items], nextCursor: page.nextCursor }))
      })
      const form = h('section', { className: 'iec-box' },
        state?.connections.length ? button('close', () => { setAdding(false); setVerified(null); setPassword(''); setError('') }) : null,
        !verified ? h('form', { onSubmit: verify },
          h('label', null, t('invitation'), h('textarea', { disabled: busy, placeholder: t('invitationHint'), onChange: event => pasteInvitation(event.target.value) })),
          field('origin', origin, setOrigin, { type: 'url', placeholder: 'http://192.168.1.10:4320', autoComplete: 'url' }),
          field('code', code, setCode, { autoComplete: 'off', maxLength: 20 }),
          h('div', null, h('button', { type: 'submit', disabled: busy, className: 'iec-primary' }, t(busy ? 'working' : 'verify'))),
        ) : h('form', { onSubmit: joinEnterprise },
          h('div', { className: 'iec-verified' }, h('small', null, t('verified')), h('strong', null, verified.name), h('small', null, verified.origin)),
          field('email', email, setEmail, { type: 'email', autoComplete: 'username' }),
          field('password', password, setPassword, { type: 'password', autoComplete: 'current-password' }),
          h('p', { className: 'iec-notice' }, t('loginHint'), h('br'), t('accountHost') + ': ', accountOrigin),
          h('details', null, h('summary', null, t('advanced')), field('account', accountOrigin, value => { setAccountOrigin(value); setInsecureAccount(false) }, { type: 'url', autoComplete: 'url' })),
          accountOrigin.startsWith('http://') ? h('label', { className: 'iec-check' }, h('input', { type: 'checkbox', required: true,
            checked: insecureAccount, disabled: busy, onChange: event => setInsecureAccount(event.target.checked) }), t('insecureAccount')) : null,
          h('div', { className: 'iec-row' }, h('button', { type: 'submit', disabled: busy || accountOrigin.startsWith('http://') && !insecureAccount, className: 'iec-primary' }, t(busy ? 'working' : 'login')),
            button('back', () => { setVerified(null); setPassword(''); setError('') })),
        ),
      )

      let content = null
      if (state === null) content = h('p', { role: 'status' }, t('loading'))
      else if (adding || state.connections.length === 0) content = form
      else if (connection) content = h('section', null,
        h('label', null, t('connections'), h('select', { value: selected, disabled: busy, onChange: event => setSelected(event.target.value) },
          state.connections.map(row => h('option', { key: row.id, value: row.id }, `${row.name} · ${row.email}`)))),
        h('nav', { 'aria-label': t('connections') }, ['overview', 'members', 'departments'].map(key => h('button', {
          key, type: 'button', disabled: busy, 'aria-pressed': tab === key, onClick: () => setTab(key),
        }, t(key)))),
        tab === 'overview' ? h('section', { className: 'iec-box' },
          h('h2', null, connection.name),
          h('dl', null, h('dt', null, t('origin')), h('dd', null, connection.origin),
            h('dt', null, t('email')), h('dd', null, connection.email), h('dt', null, t('role')), h('dd', null, t(connection.role)),
            h('dt', null, t('status')), h('dd', null, accessVerified ? t(connection.status) : t('checking')),
            h('dt', null, t('expires')), h('dd', null, new Date(connection.expiresAt).toLocaleString(language))),
          h('div', { className: 'iec-row' }, button('workspace', openWorkspace, true, !accessVerified), button('refresh', refresh)),
          h('p', { className: 'iec-notice' }, t('workspaceHint')),
          h('div', { className: 'iec-row' }, button('reauth', () => {
            setOrigin(connection.origin); setAccountOrigin(connection.accountOrigin); setEmail(connection.email); setInsecureAccount(false)
            setCode(''); setPassword(''); setVerified(null); setAdding(true)
          }), button('disconnect', disconnect)), h('small', null, t('disconnectHint')),
        ) : h('section', { className: 'iec-box' }, h('h2', null, t(tab)),
          directory === null ? h('p', { role: 'status' }, error ? '' : t('loading')) : directory.items.length === 0 ? h('p', null, t('noItems'))
            : h('ul', null, directory.items.map(item => h('li', { key: item.id },
              h('strong', null, tab === 'members' ? item.displayName || item.email : item.name),
              tab === 'members' ? h('small', null, `${item.email} · ${t(item.role)}`) : null))),
          directory?.nextCursor ? button('more', more) : null,
        ),
      )
      return h('div', { className: 'iec' }, h('style', null, styles),
        h('header', null, h('div', null, h('h1', null, t('title')), h('p', null, t('intro'))),
          state?.connections.length && !adding ? button('add', () => { setAdding(true); setVerified(null); setPassword(''); setInsecureAccount(false); setError('') }) : null),
        h('main', null, error ? h('p', { role: 'alert', className: 'iec-error' }, error) : null, content),
      )
    }

    function Icon({ size = 18 }) {
      return h(IconUsersOutlineRegular, { width: size, height: size, 'aria-hidden': true })
    }
    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ipollo-enterprise: dictionaries')
        const localeStore = { subscribe: listener => ctx.locale.subscribe(listener), getSnapshot: () => ctx.locale.getSnapshot() }
        const actions = { startSession: id => ctx.uiWorkspace.startSession(id) }
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS,
          inject: () => ({ localeStore, actions }) }, Panel))
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL,
          order: 7, locale: NS, label: () => t('panel') }, Icon))
      },
    }
  },
})
