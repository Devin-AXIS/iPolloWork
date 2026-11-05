import { focusInput, type WorkbenchFocus } from '../core/live-data'
import { api, message } from './api'
import type { Project } from '../core/contracts'
import { translate as tr } from './i18n'

// Plugin-owned conversation preferences. No credentials or business bodies cross this bridge.
type WorkbenchState = {
  id?: string
  binding?: { projectId: string; name: string } | null
  following: boolean
  pending: boolean
}
let state: WorkbenchState = { following: true, pending: false }
let hostOrigin: string | undefined
let navigationId: string | number | undefined
let pendingFocus: WorkbenchFocus | undefined
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
export const workbenchSnapshot = () => state
export function subscribeWorkbench(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function update(patch: Partial<WorkbenchState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}
function post(data: unknown) {
  if (hostOrigin !== undefined)
    window.parent.postMessage(data, hostOrigin === 'null' ? '*' : hostOrigin)
}
export function workspaceEditing() {
  return Boolean(
    document.querySelector('[data-onto-editing="true"]') ||
    document.activeElement?.closest('input,textarea,select,[contenteditable="true"]'),
  )
}
export function publishWorkspaceSelection() {
  post({
    type: 'ipollo-onto:ready',
    hash: window.location.hash,
    navigationId,
    workbenchId: state.id,
  })
  navigationId = undefined
}
export async function bindWorkbench(projectId: string | null, id?: string | number) {
  const workbenchId = state.id
  try {
    if (workspaceEditing()) throw new Error(tr('请先完成当前编辑，再切换对话项目'))
    const project = projectId
      ? (await api<Project[]>('/projects')).find((p) => p.id === projectId)
      : undefined
    if (state.id !== workbenchId) return
    if (projectId && !project) throw new Error(tr('项目不存在或不可用'))
    pendingFocus = undefined
    update({
      binding: project ? { projectId: project.id, name: project.name } : null,
      pending: false,
      following: true,
    })
    if (project && new URLSearchParams(location.hash.slice(1)).get('project') !== project.id)
      location.hash = new URLSearchParams({ project: project.id }).toString()
    post({
      type: 'ipollo-onto:bound',
      workbenchId,
      id,
      projectId: project?.id ?? null,
      name: project?.name,
    })
  } catch (error) {
    post({ type: 'ipollo-onto:bound', workbenchId, id, error: message(error) })
    throw error
  }
}
function reveal() {
  timer = undefined
  if (!pendingFocus || !state.following || document.hidden) return
  if (workspaceEditing()) {
    update({ following: false })
    return
  }
  const focus = pendingFocus
  pendingFocus = undefined
  update({ pending: false })
  window.dispatchEvent(new CustomEvent('onto:reveal', { detail: focus }))
}
export function queueWorkbenchFocus(focus: WorkbenchFocus) {
  if (
    !state.id ||
    !state.binding ||
    new URLSearchParams(focus.href.split('#')[1]).get('project') !== state.binding.projectId
  )
    return
  pendingFocus = focus
  update({ pending: true })
  clearTimeout(timer)
  timer = setTimeout(reveal, 300)
}
export function setWorkbenchFollowing(following: boolean) {
  update({ following })
  if (following) reveal()
}
export function connectWorkspaceHost() {
  if (window.parent === window || new URLSearchParams(location.search).get('workbench') !== '1')
    return
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reveal()
  })
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return
    const data = event.data
    if (data.type === 'ipollo-onto:connect') {
      if (hostOrigin !== undefined && event.origin !== hostOrigin) return
      hostOrigin = event.origin
      if (typeof data.workbenchId === 'string') {
        if (state.id !== data.workbenchId) {
          pendingFocus = undefined
          update({ following: true, pending: false })
        }
        update({ id: data.workbenchId, binding: data.binding })
      }
      publishWorkspaceSelection()
    } else if (event.origin === hostOrigin && data.type === 'ipollo-onto:bind') {
      void bindWorkbench(data.projectId, data.id).catch(() => {})
    } else if (event.origin === hostOrigin && data.type === 'ipollo-onto:navigate') {
      if (workspaceEditing()) {
        post({
          type: 'ipollo-onto:navigation-error',
          id: data.id,
          error: tr('当前正在编辑，页面未切换。完成编辑后再导航。'),
        })
        return
      }
      if (
        typeof data.href !== 'string' ||
        data.href.length > 10000 ||
        !(data.href === '/' || data.href.startsWith('/#') || data.href.startsWith('#'))
      )
        return
      navigationId = data.id
      const hash = new URL(data.href, location.origin).hash
      const focus = focusInput.safeParse({ href: '/' + hash })
      if (focus.success)
        window.dispatchEvent(new CustomEvent('onto:reveal', { detail: focus.data }))
      else if (hash !== location.hash) location.hash = hash
      else publishWorkspaceSelection()
    }
  })
}
