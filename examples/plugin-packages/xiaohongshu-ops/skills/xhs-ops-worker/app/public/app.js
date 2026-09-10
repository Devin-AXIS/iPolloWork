(() => {
  const workbenchEntryHint = '当前是浏览器页面，尚未连接对话。请打开 iPolloWork 对话，点击右侧「＋」→「小红书运营台」使用 AI、同步和发布功能；无需手动验证账号。'
  const entryNotice = document.querySelector('[data-workbench-entry-notice]')
  if (window === parent && entryNotice) { entryNotice.textContent = workbenchEntryHint; entryNotice.hidden = false }
  let hostPromise
  let verificationPending = false
  let loginPending = false
  let studioBusy = false
  let studioDirty = false
  let previousState
  let newAccountProfileId = sessionStorage.getItem('xhs-new-account-profile')
  const hostRequests = new Map()
  let hostRequestId = 0
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.jsonrpc !== '2.0' || event.data.method) return
    const pending = hostRequests.get(event.data.id)
    if (!pending) return
    hostRequests.delete(event.data.id)
    clearTimeout(pending.timer)
    event.data.error ? pending.reject(new Error(event.data.error.message)) : pending.resolve(event.data.result)
  })
  function hostRequest(method, params) {
    if (window === parent) return Promise.reject(new Error(workbenchEntryHint))
    return new Promise((resolve, reject) => {
      const id = ++hostRequestId
      const timer = setTimeout(() => { hostRequests.delete(id); reject(new Error('当前会话未响应，请确认会话空闲后重试')) }, 15000)
      hostRequests.set(id, { resolve, reject, timer })
      parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
    })
  }
  function getHost() {
    hostPromise ??= hostRequest('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: '小红书运营台', version: '0.4.5' }, appCapabilities: {} }).then(host => {
      parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*')
      return host
    }).catch(error => { hostPromise = undefined; throw error })
    return hostPromise
  }
  document.querySelectorAll('[data-account-login]').forEach(link => link.addEventListener('click', async event => {
    event.preventDefault()
    if (loginPending) return
    loginPending = true
    try {
      if (link.hasAttribute('data-new-account-login')) {
        newAccountProfileId ||= crypto.randomUUID()
        sessionStorage.setItem('xhs-new-account-profile', newAccountProfileId)
      }
      const browserProfileId = link.hasAttribute('data-new-account-login') ? newAccountProfileId : link.dataset.browserProfileId
      const host = await getHost()
      if (browserProfileId && !host.hostCapabilities?.experimental?.['ai.ipollo/browser-profiles']) throw new Error('请更新并重启软件后使用多账号扫码接入')
      const result = await hostRequest('ui/open-link', { url: link.href, ...(browserProfileId ? { browserProfileId } : {}) })
      if (result?.isError) throw new Error('无法打开软件内登录页，请重新打开运营台')
    } catch (error) { toast(error.message, true) }
    finally { loginPending = false }
  }))
  const accountPicker = document.querySelector('.account-picker')
  if (accountPicker) {
    document.addEventListener('click', event => {
      if (!accountPicker.contains(event.target)) accountPicker.open = false
    })
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && accountPicker.open) {
        accountPicker.open = false
        accountPicker.querySelector('summary').focus()
      }
    })
  }
  document.querySelector('[data-analytics-import]')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = event.currentTarget
    const feedback = form.querySelector('[data-import-status]')
    const button = form.querySelector('button[type="submit"]')
    const file = form.querySelector('input[type="file"]').files[0]
    if (!file) return
    button.disabled = true
    feedback.textContent = '正在导入…'
    try {
      if (file.size > 500_000) throw new Error('CSV 不能超过 500 KB')
      const result = await request(`/api/accounts/${form.dataset.analyticsImport}/analytics`, { method: 'POST', body: JSON.stringify({ csv: await file.text() }) })
      feedback.textContent = `已导入 ${result.articles} 篇文章的数据`
      window.location.reload()
    } catch (error) { feedback.textContent = error.message; button.disabled = false }
  })
  const toastRegion = document.querySelector('#toast-region')
  const pageData = (() => {
    const node = document.querySelector('#page-data')
    if (!node) return {}
    try { return JSON.parse(node.textContent || '{}') } catch { return {} }
  })()
  previousState = pageData.state

  function toast(message, error = false) {
    if (!toastRegion) return
    const item = document.createElement('div')
    item.className = `toast${error ? ' is-error' : ''}`
    item.textContent = message
    toastRegion.append(item)
    window.setTimeout(() => item.remove(), 4200)
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`)
    return data
  }

  function lines(value) {
    return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  }

  function busy(button, label = '处理中') {
    if (!button) return () => {}
    const original = button.innerHTML
    button.disabled = true
    button.textContent = label
    return () => { button.disabled = false; button.innerHTML = original }
  }

  document.querySelectorAll('[data-account-avatar]').forEach(img => {
    const fallback = () => { img.hidden = true; img.nextElementSibling.hidden = false }
    img.addEventListener('error', fallback, { once: true })
    if (img.complete && !img.naturalWidth) fallback()
  })

  const deleteDialog = document.querySelector('#account-delete-dialog')
  let deletingAccountId = null
  document.querySelectorAll('[data-delete-account]').forEach(button => button.addEventListener('click', () => {
    deletingAccountId = button.dataset.deleteAccount
    deleteDialog.querySelector('[data-delete-account-name]').textContent = button.dataset.accountName
    deleteDialog.querySelector('[data-delete-account-error]').textContent = ''
    deleteDialog.showModal()
  }))
  deleteDialog?.addEventListener('close', () => { deletingAccountId = null })
  document.querySelector('[data-confirm-delete-account]')?.addEventListener('click', async event => {
    const id = deletingAccountId
    if (!id) return
    const restore = busy(event.currentTarget, '正在删除')
    try {
      await request('/api/accounts/' + id, { method: 'DELETE' })
      window.location.reload()
    } catch (error) {
      deleteDialog.querySelector('[data-delete-account-error]').textContent = error.message
      restore()
    }
  })

  const accountPanel = document.querySelector('#account-onboarding')
  function setAccountPanel(open) {
    if (!accountPanel) return
    accountPanel.hidden = !open
    if (open) {
      accountPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.setTimeout(() => document.querySelector('#account-name')?.focus(), 120)
    }
  }
  function startAccountLogin() {
    setAccountPanel(true)
    document.querySelector('[data-new-account-login]')?.click()
  }
  document.querySelectorAll('[data-open-account-form]').forEach((button) => button.addEventListener('click', startAccountLogin))
  document.querySelector('[data-close-account-form]')?.addEventListener('click', () => {
    setAccountPanel(false)
    sessionStorage.removeItem('xhs-new-account-profile')
    newAccountProfileId = null
    document.querySelector('#account-form')?.reset()
  })
  if (new URLSearchParams(window.location.search).get('connect') === '1') startAccountLogin()

  const accountForm = document.querySelector('#account-form')
  accountForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = accountForm.querySelector('button[type="submit"]')
    const restore = busy(button, '正在保存')
    const form = new FormData(accountForm)
    const displayName = String(form.get('displayName') || '').trim()
    try {
      const result = await request('/api/accounts', { method: 'POST', body: JSON.stringify({
        handle: displayName, displayName,
        expectedProfileId: form.get('expectedProfileId'), profileUrl: form.get('profileUrl'), workerThreadId: null,
        browserProfileId: newAccountProfileId,
        position: form.get('position'), audience: form.get('audience'), noteTone: form.get('noteTone'), commentTone: form.get('commentTone'),
        contentColumns: lines(form.get('contentColumns')), bannedTopics: lines(form.get('bannedTopics')), dailyLimit: Number(form.get('dailyLimit')),
      }) })
      sessionStorage.removeItem('xhs-new-account-profile')
      newAccountProfileId = null
      toast('账号已保存，登录后返回运营台即可自动连接')
      window.setTimeout(() => { window.location.href = '/accounts' }, 500)
    } catch (error) { toast(error.message, true); restore() }
  })

  document.querySelectorAll('[data-toggle-account-details]').forEach((button) => button.addEventListener('click', () => {
    const form = button.closest('.account-card')?.querySelector('.account-edit-form')
    if (!form) return
    form.hidden = !form.hidden
    button.classList.toggle('is-open', !form.hidden)
  }))
  document.querySelectorAll('[data-account-edit]').forEach((formElement) => formElement.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = formElement.querySelector('button[type="submit"]')
    const restore = busy(button, '保存中')
    const form = new FormData(formElement)
    try {
      await request(`/api/accounts/${formElement.dataset.accountEdit}`, { method: 'PUT', body: JSON.stringify({
        displayName: form.get('displayName'), profileUrl: form.get('profileUrl'), workerThreadId: form.get('workerThreadId') || null,
        position: form.get('position'), audience: form.get('audience'), noteTone: form.get('noteTone'), commentTone: form.get('commentTone'),
        contentColumns: lines(form.get('contentColumns')), bannedTopics: lines(form.get('bannedTopics')), dailyLimit: Number(form.get('dailyLimit')),
      }) })
      toast('账号设置已保存')
      window.setTimeout(() => window.location.reload(), 350)
    } catch (error) { toast(error.message, true); restore() }
  }))
  document.querySelectorAll('[data-toggle-account]').forEach((button) => button.addEventListener('click', async () => {
    const restore = busy(button)
    try {
      await request(`/api/accounts/${button.dataset.toggleAccount}/enabled`, { method: 'POST', body: JSON.stringify({ enabled: button.dataset.enabled === 'true' }) })
      window.location.reload()
    } catch (error) { toast(error.message, true); restore() }
  }))
  document.querySelectorAll('[data-verify-account]').forEach((button) => button.addEventListener('click', async () => {
    if (verificationPending) return
    verificationPending = true
    const restore = busy(button, button.hasAttribute('data-sync-analytics') ? '正在发起同步' : '正在发起验证')
    try {
      const host = await getHost()
      const sessionId = host.hostContext?.['ai.ipollo/workspace']?.sessionId
      if (!sessionId || !host.hostCapabilities?.message) throw new Error('请先打开一个可对话的会话，再从右侧打开运营台')
      const verification = await request(`/api/accounts/${button.dataset.verifyAccount}/verify`, { method: 'POST', body: JSON.stringify({ sessionId, syncAnalytics: button.hasAttribute('data-sync-analytics') }) })
      if (verification.prompt) {
        if (verification.browserTarget.browserProfileId && !host.hostCapabilities?.experimental?.['ai.ipollo/browser-profiles']) throw new Error('请更新并重启软件后使用多账号同步')
        // Send while the workbench is active; opening the browser switches the host panel.
        const sent = await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: verification.prompt }] })
        if (sent?.isError) throw new Error('任务已准备好，但当前会话未接收；请在会话空闲后重新点击同步或验证')
        const opened = await hostRequest('ui/open-link', verification.browserTarget)
        if (opened?.isError) throw new Error('任务已发起，但无法打开所选账号的浏览器；请重新打开运营台后重试')
      }
      toast(button.hasAttribute('data-sync-analytics') ? '已打开所选账号，正在同步可见数据' : '已打开所选账号，正在核对登录状态')
      window.setTimeout(() => window.location.reload(), 450)
    } catch (error) { verificationPending = false; toast(error.message, true); restore() }
  }))

  const studioApi = (action, data = {}) => request(`/api/studio/${action}`, { method: 'POST', body: JSON.stringify({ accountId: pageData.accountId, ...data }) })
  const draftForm = document.querySelector('#post-draft-form')
  const searchForm = document.querySelector('#post-search-form')
  const feedback = message => document.querySelectorAll('[data-studio-feedback]').forEach(node => { node.textContent = message })
  const markEdited = () => { studioDirty = true; feedback('有未保存的修改') }
  document.querySelector('.studio-page')?.addEventListener('input', event => {
    if (event.target.matches('input,textarea,select') && event.target.closest('.studio-form,.candidate-card')) markEdited()
    if (event.target.closest('#post-draft-form')) updatePreview()
    updateSelection()
  })
  window.addEventListener('beforeunload', event => { if (studioDirty) { event.preventDefault(); event.returnValue = '' } })
  function updateSelection() {
    const count = document.querySelectorAll('[data-post-selected]:checked').length
    document.querySelector('[data-selection-count]')?.replaceChildren(document.createTextNode(`已选 ${count} 篇`))
  }
  function draftInput() {
    const form = new FormData(draftForm)
    const selected = [...draftForm.querySelectorAll('[name="assetIds"]:checked')].map(node => node.value)
    const assetIds = [...new Set([...(pageData.draft?.assetIds || []).filter(id => selected.includes(id)), ...selected])]
    return { id: pageData.draft?.id, name: form.get('name'), brief: form.get('brief'), title: form.get('title'), body: form.get('body'), topics: lines(form.get('topics')), mediaKind: form.get('mediaKind'), assetIds }
  }
  function updatePreview() {
    if (!draftForm || pageData.draft?.jobId) return
    const draft = draftInput()
    document.querySelector('[data-preview-title]').textContent = draft.title || '你的帖子标题'
    document.querySelector('[data-preview-body]').textContent = draft.body || '在左侧填写内容，实时预览效果。'
    document.querySelector('[data-preview-topics]').textContent = draft.topics.map(t => '#' + t.replace(/^#/, '')).join(' ')
    const media = draft.assetIds.map(id => {
      const node = draftForm.querySelector(`[name="assetIds"][value="${CSS.escape(id)}"]`)
      const clone = node.closest('label').querySelector('img,video').cloneNode(true)
      if (clone.tagName === 'VIDEO') clone.controls = true
      return clone
    })
    document.querySelector('[data-preview-media]').replaceChildren(...(media.length ? media : [document.createTextNode('选择素材后在这里预览')]))
  }
  function setLocation(key, id) {
    const url = new URL(location.href)
    url.searchParams.set('account', pageData.accountId)
    url.searchParams.set(key, id)
    history.replaceState(null, '', url)
  }
  async function saveDraft(copy = false) {
    if (pageData.draft?.jobId && !copy) return pageData.draft
    const input = copy && pageData.draft?.jobId ? { ...pageData.draft } : draftInput()
    if (copy) { delete input.id; input.name = `${input.name || '草稿'} 副本`.slice(0, 80) }
    const { draft } = await studioApi('save-post-draft', input)
    pageData.draft = draft
    studioDirty = false
    setLocation('draft', draft.id)
    feedback('草稿已保存')
    return draft
  }
  async function saveComments() {
    if (!pageData.search) throw new Error('请先搜索帖子')
    const settings = Object.fromEntries(new FormData(searchForm))
    if (settings.query.trim() !== pageData.search.query || settings.sort !== pageData.search.sort) throw new Error('关键词或平台排序已修改，请先重新搜索')
    const items = [...document.querySelectorAll('[data-post-id]')].filter(node => !node.querySelector('[data-post-selected]').disabled).map(node => ({
      id: node.dataset.postId, selected: node.querySelector('[data-post-selected]').checked, comment: node.querySelector('[data-post-comment]').value,
      reason: pageData.search.results.find(item => item.id === node.dataset.postId)?.reason || '',
    }))
    const result = await studioApi('update-comment-candidates', { searchId: pageData.search.id, items, instruction: settings.instruction, exclude: settings.exclude, limit: Number(settings.limit) })
    pageData.search = result.search
    studioDirty = false
    feedback('选择和评论已保存')
  }
  async function runStudio(button, action) {
    if (studioBusy) return
    studioBusy = true
    const restore = busy(button, '处理中…')
    try { await action() }
    catch (error) { feedback(error.message); toast(error.message, true) }
    finally { studioBusy = false; restore() }
  }
  // Save the current account's draft before internal navigation. A native
  // beforeunload prompt cannot reliably be shown inside the embedded workbench.
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]')
    if (!draftForm || !studioDirty || !link || event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const target = new URL(link.href, location.href)
    if (target.origin !== location.origin || !['/accounts', '/publishing', '/comments', '/analytics'].includes(target.pathname)) return
    event.preventDefault()
    runStudio(null, async () => { await saveDraft(); location.assign(target.href) })
  })
  draftForm?.addEventListener('submit', event => { event.preventDefault(); runStudio(event.submitter, async () => { await saveDraft(); location.reload() }) })
  document.querySelector('[data-save-copy]')?.addEventListener('click', event => runStudio(event.currentTarget, async () => { await saveDraft(true); location.reload() }))
  document.querySelector('[data-save-comments]')?.addEventListener('click', event => runStudio(event.currentTarget, saveComments))
  document.querySelector('[data-studio-upload]')?.addEventListener('change', event => {
    const files = [...event.target.files]
    runStudio(null, async () => {
      if (files.length > 9) throw new Error('一次最多上传 9 个素材')
      const draft = await saveDraft()
      const ids = [...draft.assetIds]
      for (const file of files) {
        if (file.size > (file.type === 'video/mp4' ? 200 : 15) * 1024 * 1024) throw new Error('图片不能超过 15 MB，视频不能超过 200 MB')
        feedback(`正在上传 ${file.name}`)
        const body = new FormData(); body.set('file', file)
        const { asset } = await request('/api/assets', { method: 'POST', body })
        if ((draft.mediaKind === 'video' ? asset.mimeType === 'video/mp4' && ids.length === 0 : asset.mimeType.startsWith('image/') && ids.length < 9) && !ids.includes(asset.id)) ids.push(asset.id)
      }
      await studioApi('save-post-draft', { ...draft, assetIds: ids })
      studioDirty = false
      location.reload()
    })
  })
  for (const [selector, key] of [['#draft-picker', 'draft'], ['#search-picker', 'search']]) document.querySelector(selector)?.addEventListener('change', event => {
    const url = new URL(location.href); url.searchParams.set(key, event.target.value); location.href = url.href
  })
  function sortResults(key) {
    if (!document.querySelector('[data-result-sort]')) return
    if (!['general', 'newest', 'likes', 'comments', 'collections'].includes(key)) key = 'general'
    document.querySelector('[data-result-sort]').value = key
    const cards = [...document.querySelectorAll('[data-post-id]')]
    cards.sort((a, b) => key === 'general' ? Number(a.dataset.order) - Number(b.dataset.order) : Number(b.dataset[key]) - Number(a.dataset[key]))
    document.querySelector('.candidate-list').append(...cards)
  }
  sortResults(new URLSearchParams(location.search).get('listSort'))
  document.querySelector('[data-result-sort]')?.addEventListener('change', event => {
    sortResults(event.target.value)
    const url = new URL(location.href); url.searchParams.set('listSort', event.target.value); history.replaceState(null, '', url)
  })
  document.querySelector('[data-select-posts]')?.addEventListener('click', () => {
    let available = pageData.search.limit - document.querySelectorAll('[data-post-selected]:disabled:checked').length
    document.querySelectorAll('[data-post-selected]:not(:disabled)').forEach(node => { node.checked = available-- > 0 })
    markEdited(); updateSelection()
  })
  async function askStudio(kind) {
    let data
    if (draftForm) {
      const draft = await saveDraft()
      if (kind === 'publish' && (!draft.title || !draft.body || !draft.assetIds.length)) throw new Error('请先填写标题、描述并选择素材')
      data = { draftId: draft.id }
    } else {
      if (kind === 'search' || kind === 'auto-comment') {
        if (!searchForm.reportValidity()) return
        const input = Object.fromEntries(new FormData(searchForm))
        const { search } = await studioApi('create-post-search', { ...input, limit: Number(input.limit) })
        pageData.search = search; studioDirty = false; setLocation('search', search.id)
      } else {
        await saveComments()
        const selected = pageData.search.results.filter(item => item.selected)
        if (['polish', 'comment'].includes(kind) && !selected.length) throw new Error('请先选择帖子')
        if (kind === 'comment' && selected.some(item => !item.comment)) throw new Error('请为每篇选中的帖子填写评论')
      }
      data = { searchId: pageData.search.id }
    }
    if (window === parent) {
      feedback('内容已保存。请从对话右侧「＋」→「小红书运营台」继续。')
      entryNotice?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      toast('内容已保存，请从对话右侧「＋」打开小红书运营台。')
      return
    }
    const host = await getHost()
    if (!host.hostContext?.['ai.ipollo/workspace']?.sessionId || !host.hostCapabilities?.message) throw new Error('内容已保存。请先在主软件打开一个可对话的会话，再从右侧「＋」打开小红书运营台。')
    const { prompt } = await studioApi('request-action', { kind, ...data })
    previousState = (await request('/api/state')).state
    const result = await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: prompt }] })
    if (result?.isError) throw new Error('当前会话未接收任务，请在会话空闲后重试')
    feedback('已交给当前会话执行，结果会自动回到这里。')
    toast('已交给主软件 AI 执行')
    if (kind === 'search' || kind === 'auto-comment') location.reload()
  }
  document.querySelectorAll('[data-studio-action]').forEach(button => button.addEventListener('click', () => runStudio(button, () => askStudio(button.dataset.studioAction))))
  searchForm?.addEventListener('submit', event => { event.preventDefault(); runStudio(event.submitter, () => askStudio('search')) })

  if (['accounts', 'analytics', 'publishing', 'comments'].includes(document.body.dataset.page)) {
    let editing = false
    document.addEventListener('input', event => { if (event.target.closest('form')) editing = true })
    const renderedAccounts = Array.isArray(pageData.accounts) ? JSON.stringify(pageData.accounts.map(account => [account.id, account.sessionStatus, account.updatedAt])) : null
    let polls = 0
    const timer = setInterval(async () => {
      if (++polls > (document.querySelector('.studio-page') ? 1200 : 200)) return clearInterval(timer)
      if (verificationPending || studioBusy || studioDirty || (editing && !document.querySelector('.studio-page')) || (document.hidden && !document.querySelector('.studio-page')) || deleteDialog?.open) return
      try {
        const result = await request('/api/state', { method: 'GET' })
        if (verificationPending || studioBusy || studioDirty || (editing && !document.querySelector('.studio-page')) || deleteDialog?.open) return
        if ((renderedAccounts && renderedAccounts !== JSON.stringify(JSON.parse(result.state).accounts)) || (previousState && previousState !== result.state)) window.location.reload()
        previousState = result.state
      } catch { /* A transient network failure must not discard the page or user input. */ }
    }, 3000)
  }

  document.querySelectorAll('[data-review-action]').forEach((button) => button.addEventListener('click', async () => {
    const restore = busy(button)
    const id = button.dataset.reviewId
    const suggestedText = document.querySelector(`[data-review-text="${CSS.escape(id)}"]`)?.value || ''
    try {
      await request(`/api/reviews/${id}`, { method: 'POST', body: JSON.stringify({ status: button.dataset.reviewAction, suggestedText }) })
      window.location.reload()
    } catch (error) { toast(error.message, true); restore() }
  }))
})()
