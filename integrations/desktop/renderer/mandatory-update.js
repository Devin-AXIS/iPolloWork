/** Text-only policy rendering; the main process owns task inspection and every privileged action. */
const api = window.dshMandatoryUpdate
let current
let busy = false
let localError
const element = id => document.getElementById(id)
const format = (message, values) => message.replaceAll(/\{([^{}]+)\}/gu, (match, key) => values[key] ?? match)

function render(view) {
  document.body.classList.toggle('visible', view.policy.blocking)
  if (!view.policy.blocking) return
  const wasConfirming = current?.confirmation !== undefined
  current = view
  const { locale: { id, messages }, policy, update, confirmation, navigation } = view
  const confirming = confirmation !== undefined
  const failed = update.phase === 'error'
  const configurationError = failed && update.failedOperation === 'configuration'
  const ready = update.phase === 'ready' || (failed && update.failedOperation === 'install')
  const downloadable = update.phase === 'available' || (failed && update.failedOperation === 'download')
  const authenticationRequired = policy.error === 'authentication-required'
  const preparationMessages = {
    'stop-failed': messages.updateStopFailed,
    'tasks-changed': messages.updateTasksChanged,
    'tasks-unavailable': messages.updateTasksUnavailable,
    'fullscreen-timeout': messages.updateFullscreenTimeout,
  }
  const fallback = failed || update.phase === 'idle' || view.error !== undefined
  let title = policy.title ?? messages.mandatoryTitle
  let detail = policy.detail ?? messages.mandatoryDetail
  let primary = '', action = '', status = ''
  if (downloadable) { primary = failed ? messages.updateRetry : messages.updateDownload; action = 'download' }
  if (ready) { primary = failed ? messages.updateRetry : messages.mandatoryContinue; action = 'install' }
  if (view.deferred) { title = messages.mandatoryReady; detail = messages.mandatoryDeferred }
  if (update.phase === 'downloading') status = format(messages.updateDownloading, { percent: String(Math.floor(update.percent ?? 0)) })
  if (update.phase === 'verifying') status = messages.updateVerifying
  if (update.phase === 'installing') status = messages.mandatoryInspecting
  if (update.phase === 'checking' || (policy.checking && ['idle', 'error'].includes(update.phase))) status = messages.updateChecking
  if (confirming) {
    title = confirmation.active ? messages.updateActiveTasks : messages.mandatoryReady
    detail = confirmation.active ? messages.updateActiveTasksDetail : messages.mandatoryReadyDetail
    if (confirmation.pluginDetail) detail += '\n\n' + confirmation.pluginDetail
    primary = confirmation.active ? messages.updateStopTasks : messages.installAndRestart
    action = 'install'; status = ''
  }
  if (view.restart !== undefined) {
    title = messages.updateInstalling
    detail = view.restart === 'stopping-tasks' ? messages.mandatoryStopping : messages.mandatoryRestarting
    status = ''; primary = ''; action = ''
  }
  const error = localError ?? view.error ?? (configurationError ? messages.updateConfigurationRead
    : authenticationRequired ? messages.policyLoginRequired : failed
    ? update.failedOperation === 'download' ? messages.mandatoryDownloadFailed
      : update.failedOperation === 'install'
        ? preparationMessages[update.preparationFailure] ?? messages.mandatoryInstallFailed
        : messages.mandatoryUnavailable
    : update.phase === 'idle' && !policy.checking ? messages.mandatoryNoRelease : undefined)
  const technicalDetails = failed && !configurationError ? update.technicalDetails ?? update.message ?? '' : ''
  const pluginBlock = confirming || view.restart !== undefined ? undefined : view.pluginBlock
  if (pluginBlock && primary) primary = messages.updateRetry
  document.documentElement.lang = id
  document.title = messages.mandatoryTitle
  element('title').textContent = title
  element('detail').textContent = detail
  element('status').textContent = status
  element('version').textContent = update.version === undefined ? '' : format(messages.mandatoryVersion, { version: update.version })
  const progress = element('progress')
  progress.hidden = confirming || (status === '' && view.restart === undefined)
  if (update.phase === 'downloading') progress.value = update.percent ?? 0
  else progress.removeAttribute('value')
  progress.setAttribute('aria-label', status || title)
  element('error').textContent = error ?? ''
  element('error').hidden = error === undefined || confirming
  element('plugin-block').hidden = pluginBlock === undefined
  element('plugin-block-title').textContent = pluginBlock?.title ?? ''
  element('plugin-block-detail').textContent = pluginBlock?.detail ?? ''
  const folders = element('plugin-folders')
  const localPlugins = pluginBlock?.localPlugins ?? []
  if (folders.children.length !== localPlugins.length
    || localPlugins.some((name, index) => folders.children[index]?.dataset.plugin !== name)) {
    folders.replaceChildren(...localPlugins.map(name => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'secondary'
      button.dataset.plugin = name
      button.addEventListener('click', () => { void act('open-plugin', name) })
      return button
    }))
  }
  for (const button of folders.children) {
    button.textContent = `${messages.updateOpenPluginFolder} · ${button.dataset.plugin}`
    button.disabled = busy
  }
  if (element('technical-details-content').textContent !== technicalDetails) element('technical-details').open = false
  element('technical-details').hidden = technicalDetails === '' || confirming
  element('technical-details-label').textContent = messages.updateTechnicalDetails
  element('technical-details-content').textContent = technicalDetails
  element('update').hidden = !primary
  element('update').textContent = primary
  element('update').dataset.action = action
  element('update').disabled = busy && !confirming
  element('later').textContent = messages.updateLater
  element('later').hidden = !confirmation?.active
  element('refresh').textContent = configurationError ? messages.updateConfigurationDetails
    : authenticationRequired ? messages.policyLogin : messages.mandatoryRefresh
  element('refresh').hidden = confirming || view.restart !== undefined || (!authenticationRequired && (!!primary || !fallback))
  element('refresh').disabled = busy || policy.checking
  element('page').textContent = navigation ? messages.mandatoryReopen : messages.mandatoryPage
  element('page').hidden = !fallback || confirming || view.restart !== undefined || pluginBlock !== undefined || policy.page === undefined
  element('actions').hidden = [...element('actions').children].every(child => child.hidden)
  element('fallback').hidden = !navigation || !fallback || confirming || pluginBlock !== undefined || policy.page === undefined
  element('browser-message').textContent = navigation?.page === 'failed' ? messages.mandatoryPageFailed : messages.mandatoryOpenHelp
  element('copy').textContent = navigation?.copy === 'copied' ? messages.mandatoryCopied : messages.mandatoryCopy
  element('copy-message').textContent = navigation?.copy === 'failed' ? messages.mandatoryCopyFailed : ''
  element('manual-copy').hidden = navigation?.copy !== 'failed'
  element('address-label').textContent = messages.mandatoryAddress
  element('address').value = navigation?.copy === 'failed' ? policy.page ?? '' : ''
  // A download button can become an install button while a key remains held.
  if (confirming && !wasConfirming && document.activeElement?.id === 'update') document.activeElement.blur()
}

async function act(action, pluginName) {
  const navigation = ['page', 'copy'].includes(action)
  const confirmation = current?.confirmation !== undefined && ['install', 'later'].includes(action)
  if (current === undefined || (busy && !navigation && !confirmation)) return
  if (!navigation) busy = true
  localError = undefined
  render(current)
  try { await api.action(action, current.confirmation?.version ?? current.update.version, current.confirmation?.revision, pluginName) }
  catch { localError = action === 'open-plugin' ? current.locale.messages.updatePluginFolderUnavailable
    : current.locale.messages.mandatoryActionFailed }
  finally { if (!navigation) busy = false; render(current) }
}

for (const action of ['refresh', 'page', 'copy', 'later']) element(action).addEventListener('click', () => { void act(action) })
element('update').addEventListener('click', event => {
  if (event.detail <= 1) void act(element('update').dataset.action)
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' || (event.repeat && ['Enter', ' '].includes(event.key))) event.preventDefault()
  if (event.key !== 'Tab') return
  const controls = [...document.querySelectorAll('button:not(:disabled), summary, details[open] > pre, textarea')]
    .filter(control => control.getClientRects().length > 0)
  event.preventDefault()
  if (controls.length === 0) return
  const currentIndex = controls.indexOf(document.activeElement)
  const next = currentIndex < 0 ? (event.shiftKey ? controls.length - 1 : 0)
    : (currentIndex + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
  controls[next].focus()
})
let changed = false
const unsubscribe = api.subscribe(view => { changed = true; render(view) })
window.addEventListener('pagehide', unsubscribe, { once: true })
void api.status().then(view => { if (!changed) render(view) })
