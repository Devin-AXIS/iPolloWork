window.__ModuleLoader__.load({ id: '@ipollo/dsh-operation-recorder', factory(require) {
 const React = require('react'), h = React.createElement
 const { Button, IconInspectOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
 const { useState, useEffect, useRef, useSyncExternalStore } = React
 const panel = 'ipollo-operation-recorder', base = '/ipollo-operation-recorder'
 function Panel({ themeStore, locale, uiWorkspace }) {
  const language = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot().active)
  const snapshot = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const frame = useRef(null)
  const syncTheme = () => { const doc = frame.current?.contentDocument; if (doc) doc.documentElement.dataset.theme = snapshot.active.colorScheme }
  useEffect(syncTheme, [snapshot])
  const [rows, setRows] = useState(null), [id, setId] = useState(''), [src, setSrc] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)

  useEffect(() => {
   const receive = event => {
    if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
    const message = event.data
    if (message?.jsonrpc !== '2.0' || !message.id) return
    const respond = result => event.source.postMessage({ jsonrpc: '2.0', id: message.id, result }, event.origin)
    if (message.method === 'ui/initialize') respond({ hostCapabilities: { message: true }, hostContext: { theme: snapshot.active.colorScheme } })
    if (message.method === 'ui/message') {
      const text = message.params?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n')
      if (!id || typeof text !== 'string' || text.length > 65536) { respond({ isError: true }); return }
      uiWorkspace.startSession(id, { prompt: text, whenDraftExists: 'append' })
      respond({ isError: false })
    }
   }
   window.addEventListener('message', receive)
   return () => window.removeEventListener('message', receive)
  }, [id, snapshot, uiWorkspace])

  const generation = useRef(0)
  useEffect(() => { const abort = new AbortController(); fetch(base + '/workspaces', { signal: abort.signal }).then(r => { if (!r.ok) throw Error(); return r.json() }).then(v => { setRows(v.workspaces); setId(v.workspaces[0]?.id || '') }).catch(() => { if (!abort.signal.aborted) setError('无法读取工作区 / Could not load workspaces') }); return () => { abort.abort(); generation.current++ } }, [])
  async function open() { const version = ++generation.current; setBusy(true); setError(''); try { const r = await fetch(base + '/open?workspace=' + encodeURIComponent(id), { method: 'POST' }); if (!r.ok) throw Error(); const v = await r.json(); if (version === generation.current) setSrc(v.url) } catch { if (version === generation.current) setError('无法打开工作台，请重试 / Could not open workbench') } finally { if (version === generation.current) setBusy(false) } }
  return h('section', { style: { height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, color: 'var(--dsw-alias-label-primary)' } },
   h('header', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '16px', paddingTop: 'max(16px, var(--dsh-frame-top-clearance, 0px))', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
    h('h1', { style: { fontSize: 16, fontWeight: 500, margin: '0 auto 0 0' } }, '操作录制'),
    rows?.length === 0 && h('span', { role: 'status', style: { marginInlineStart: 'auto', color: 'var(--dsw-alias-label-secondary)' } }, language.startsWith('zh') ? '暂无工作区' : 'No workspaces'),
    rows?.length > 0 && h(React.Fragment, null,
      h('label', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' } }, '工作区 / Workspace ', h('select', { 'aria-label': '工作区 / Workspace', style: { color: 'inherit', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 6, minWidth: 0, maxWidth: 'min(220px, 100%)', font: 'inherit' }, value: id, disabled: busy, onChange: e => { generation.current++; setBusy(false); setSrc(''); setId(e.target.value) } }, rows.map(row => h('option', { key: row.id, value: row.id }, row.title)))),
      h(Button, { disabled: busy || !id, onClick: open }, busy ? '正在打开…' : '打开 / Open'))),
   error && h('p', { role: 'alert', style: { padding: 16 } }, error),
   rows?.length === 0 && h('p', { style: { padding: 16 } }, '请先创建一个工作区 / Create a workspace first.'),
   src && h('iframe', { ref: frame, onLoad: syncTheme, key: src, title: '操作录制', src, style: { width: '100%', flex: 1, border: 0, minHeight: 0 }, sandbox: 'allow-scripts allow-same-origin allow-downloads allow-forms' }))
 }
 return { inject: ['slots', 'locale', 'layout', 'theme', 'uiWorkspace'], apply(ctx) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, inject: () => ({ themeStore: { subscribe: listener => ctx.on('theme/change', listener), getSnapshot: () => ctx.theme.getTheme() }, locale: ctx.locale, uiWorkspace: ctx.uiWorkspace }) }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 9, label: () => '操作录制' }, () => h(IconInspectOutlineRegular, { size: 16 })))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@ipollo/dsh-operation-recorder' }, () => h(Button, { onClick: () => ctx.layout.selectPanel(panel) }, '打开 操作录制')))
 }}
}})
