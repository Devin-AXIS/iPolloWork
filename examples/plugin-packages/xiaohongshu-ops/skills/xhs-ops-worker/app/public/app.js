(() => {
  let hostPromise
  let verificationPending = false
  let loginPending = false
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
    if (window === parent) return Promise.reject(new Error('请在软件右侧运营台中验证，独立浏览器页面没有绑定会话'))
    return new Promise((resolve, reject) => {
      const id = ++hostRequestId
      const timer = setTimeout(() => { hostRequests.delete(id); reject(new Error('当前会话未响应，请确认会话空闲后重试')) }, 15000)
      hostRequests.set(id, { resolve, reject, timer })
      parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
    })
  }
  function getHost() {
    hostPromise ??= hostRequest('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: '小红书运营台', version: '0.3.14' }, appCapabilities: {} }).then(host => {
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
  document.querySelector('[data-analytics-account]')?.addEventListener('change', event => event.target.form.requestSubmit())
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
    const restore = busy(button, '正在发起验证')
    try {
      const host = await getHost()
      const sessionId = host.hostContext?.['ai.ipollo/workspace']?.sessionId
      if (!sessionId || !host.hostCapabilities?.message) throw new Error('请先打开一个可对话的会话，再从右侧打开运营台')
      const verification = await request(`/api/accounts/${button.dataset.verifyAccount}/verify`, { method: 'POST', body: JSON.stringify({ sessionId, syncAnalytics: button.hasAttribute('data-sync-analytics') }) })
      if (verification.prompt) {
        const sent = await hostRequest('ui/message', { role: 'user', content: [{ type: 'text', text: verification.prompt }] })
        if (sent?.isError) throw new Error('验证已准备好，但当前会话未接收任务；请在会话空闲后重新点击验证')
      }
      toast('已绑定当前会话，请按左侧提示完成只读验证')
      window.setTimeout(() => window.location.reload(), 450)
    } catch (error) { verificationPending = false; toast(error.message, true); restore() }
  }))

  if (document.body.dataset.page === 'accounts' || document.body.dataset.page === 'analytics') {
    let editing = false
    document.addEventListener('input', event => { if (event.target.closest('form')) editing = true })
    let previousState
    const renderedAccounts = Array.isArray(pageData.accounts) ? JSON.stringify(pageData.accounts.map(account => [account.id, account.sessionStatus, account.updatedAt])) : null
    let polls = 0
    const timer = setInterval(async () => {
      if (++polls > 200) return clearInterval(timer)
      if (verificationPending || editing || document.hidden || deleteDialog?.open || document.querySelector('form:focus-within')) return
      try {
        const result = await request('/api/state', { method: 'GET' })
        if (verificationPending || editing || deleteDialog?.open) return
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
