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
    hostPromise ??= hostRequest('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: '小红书运营台', version: '0.3.11' }, appCapabilities: {} }).then(host => {
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

  function checked(name, numeric = true) {
    const values = [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value)
    return numeric ? values.map(Number).filter(Number.isInteger) : values
  }

  function busy(button, label = '处理中') {
    if (!button) return () => {}
    const original = button.innerHTML
    button.disabled = true
    button.textContent = label
    return () => { button.disabled = false; button.innerHTML = original }
  }

  function defaultSingleTime() {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0)
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 16)
  }

  const taskPanel = document.querySelector('#task-panel')
  const drawerBackdrop = document.querySelector('.drawer-backdrop')
  let returnFocus = null

  function setTaskPanel(open, trigger = null) {
    if (!taskPanel) return
    if (open) returnFocus = trigger || document.activeElement
    taskPanel.classList.toggle('is-open', open)
    taskPanel.setAttribute('aria-hidden', String(!open))
    document.body.classList.toggle('drawer-open', open)
    if (drawerBackdrop) drawerBackdrop.hidden = !open
    if (open) window.setTimeout(() => taskPanel.querySelector('#campaign-name')?.focus(), 80)
    else if (returnFocus instanceof HTMLElement) returnFocus.focus()
  }

  document.querySelectorAll('[data-open-task-panel]').forEach((button) => button.addEventListener('click', () => setTaskPanel(true, button)))
  document.querySelectorAll('[data-close-task-panel]').forEach((button) => button.addEventListener('click', () => setTaskPanel(false)))
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && taskPanel?.classList.contains('is-open')) setTaskPanel(false) })

  const singleInput = document.querySelector('#scheduled-local')
  if (singleInput && !singleInput.value) singleInput.value = defaultSingleTime()
  document.querySelectorAll('input[name="weekdays"]').forEach((input) => {
    if (['1', '3', '5'].includes(input.value)) input.checked = true
  })

  function updateScheduleFields() {
    const kind = document.querySelector('input[name="scheduleKind"]:checked')?.value || 'weekly'
    const single = document.querySelector('[data-single-schedule]')
    const weekly = document.querySelector('[data-weekly-schedule]')
    if (single) single.hidden = kind !== 'single'
    if (weekly) weekly.hidden = kind !== 'weekly'
  }
  document.querySelectorAll('input[name="scheduleKind"]').forEach((input) => input.addEventListener('change', updateScheduleFields))
  updateScheduleFields()

  document.querySelectorAll('[data-direction]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-direction]').forEach((candidate) => candidate.classList.toggle('is-selected', candidate === button))
    const input = document.querySelector('input[name="direction"]')
    if (input) input.value = button.dataset.direction || ''
  }))

  const campaignForm = document.querySelector('#campaign-form')
  campaignForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = event.submitter
    const restore = busy(button, button?.value === 'active' ? '正在安排' : '正在保存')
    const form = new FormData(campaignForm)
    const kind = String(form.get('scheduleKind') || 'weekly')
    const accountId = Number(form.get('accountId'))
    const direction = String(form.get('direction') || '').trim()
    const theme = String(form.get('theme') || '').trim()
    const intent = button?.value === 'active' ? 'active' : 'draft'
    try {
      if (!accountId) throw new Error('请先选择发布账号')
      const result = await request('/api/campaigns', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), theme: direction ? `${direction}｜${theme}` : theme, accountIds: [accountId],
        commentAccountIds: checked('commentAccountIds'), knowledgeIds: Array.isArray(pageData.knowledgeIds) ? pageData.knowledgeIds : [],
        assetIds: [], noteTones: ['真实', '具体', '自然'], commentTones: ['友好', '实用', '自然'],
        schedule: {
          kind, timezone: 'Asia/Shanghai', scheduledLocal: kind === 'single' ? form.get('scheduledLocal') || null : null,
          weekdays: kind === 'weekly' ? checked('weekdays') : [], publishTime: kind === 'weekly' ? form.get('publishTime') || null : null,
        },
        minComments: 0, maxComments: 0, commentWindowStartMinutes: 30, commentWindowEndMinutes: 240, generateLeadMinutes: 1440,
      }) })
      if (intent === 'active') {
        await request(`/api/campaigns/${result.campaign.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'active' }) })
      }
      toast(intent === 'active' ? '任务已创建并安排' : '任务已保存到草稿')
      window.setTimeout(() => { window.location.href = '/tasks' }, 450)
    } catch (error) { toast(error.message, true); restore() }
  })

  async function moveCampaign(card, targetColumn) {
    const statusMap = { draft: 'paused', scheduled: 'active', completed: 'completed' }
    const nextStatus = statusMap[targetColumn]
    if (!nextStatus || card.dataset.boardColumn === targetColumn) return
    card.classList.add('is-updating')
    try {
      await request(`/api/campaigns/${card.dataset.campaignId}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) })
      toast(targetColumn === 'scheduled' ? '任务已安排' : targetColumn === 'draft' ? '任务已移回草稿' : '任务已完成')
      window.setTimeout(() => window.location.reload(), 350)
    } catch (error) { card.classList.remove('is-updating'); toast(error.message, true) }
  }

  let draggedCard = null
  document.querySelectorAll('[data-task-card][draggable="true"]').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      draggedCard = card
      card.classList.add('is-dragging')
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', card.dataset.campaignId || '')
    })
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging')
      document.querySelectorAll('[data-drop-column]').forEach((column) => column.classList.remove('is-drag-over'))
      draggedCard = null
    })
  })
  document.querySelectorAll('[data-drop-column]').forEach((column) => {
    const target = column.dataset.dropColumn
    if (!['draft', 'scheduled', 'completed'].includes(target)) return
    column.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; column.classList.add('is-drag-over') })
    column.addEventListener('dragleave', (event) => { if (!column.contains(event.relatedTarget)) column.classList.remove('is-drag-over') })
    column.addEventListener('drop', async (event) => { event.preventDefault(); column.classList.remove('is-drag-over'); if (draggedCard) await moveCampaign(draggedCard, target) })
  })

  document.querySelectorAll('[data-task-menu]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const menu = button.closest('[data-task-card]')?.querySelector('.task-menu')
    document.querySelectorAll('.task-menu').forEach((candidate) => { if (candidate !== menu) candidate.hidden = true })
    if (menu) menu.hidden = !menu.hidden
  }))
  document.addEventListener('click', () => document.querySelectorAll('.task-menu').forEach((menu) => { menu.hidden = true }))
  document.querySelectorAll('[data-move-campaign]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    const card = button.closest('[data-task-card]')
    const target = button.dataset.moveCampaign === 'active' ? 'scheduled' : button.dataset.moveCampaign === 'paused' ? 'draft' : 'completed'
    if (card) await moveCampaign(card, target)
  }))

  const filterBar = document.querySelector('[data-filter-bar]')
  document.querySelector('[data-toggle-filter]')?.addEventListener('click', () => { if (filterBar) filterBar.hidden = !filterBar.hidden })
  function applyFilters() {
    const accountId = document.querySelector('[data-account-filter]')?.value || ''
    const status = document.querySelector('[data-status-filter]')?.value || ''
    document.querySelectorAll('[data-task-card]').forEach((card) => {
      const accountMatch = !accountId || card.querySelector(`.account-avatar`)?.nextElementSibling || true
      const data = pageData.accounts?.find((account) => String(account.id) === accountId)
      const nameMatch = !data || card.textContent.includes(data.displayName)
      card.hidden = !(accountMatch && nameMatch && (!status || card.dataset.boardColumn === status))
    })
  }
  document.querySelector('[data-account-filter]')?.addEventListener('change', applyFilters)
  document.querySelector('[data-status-filter]')?.addEventListener('change', applyFilters)
  document.querySelector('[data-clear-filter]')?.addEventListener('click', () => {
    document.querySelectorAll('[data-account-filter], [data-status-filter]').forEach((select) => { select.value = '' })
    applyFilters()
  })
  document.querySelectorAll('[data-focus-campaign]').forEach((button) => button.addEventListener('click', () => {
    const card = document.querySelector(`[data-campaign-id="${CSS.escape(button.dataset.focusCampaign)}"]`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    card?.classList.add('is-highlighted')
    window.setTimeout(() => card?.classList.remove('is-highlighted'), 1800)
  }))

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
        handle: String(form.get('handle') || '').trim() || displayName, displayName,
        expectedProfileId: form.get('expectedProfileId'), profileUrl: form.get('profileUrl'), workerThreadId: form.get('workerThreadId') || null,
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

  if (document.body.dataset.page === 'accounts' || document.body.dataset.page === 'tasks' || document.body.dataset.page === 'analytics') {
    let editing = false
    document.addEventListener('input', event => { if (event.target.closest('form')) editing = true })
    let previousState
    const renderedAccounts = Array.isArray(pageData.accounts) ? JSON.stringify(pageData.accounts.map(account => [account.id, account.sessionStatus, account.updatedAt])) : null
    let polls = 0
    const timer = setInterval(async () => {
      if (++polls > 200) return clearInterval(timer)
      if (verificationPending || editing || document.hidden || document.body.classList.contains('drawer-open') || document.querySelector('form:focus-within')) return
      try {
        const result = await request('/api/state', { method: 'GET' })
        if (verificationPending || editing) return
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
