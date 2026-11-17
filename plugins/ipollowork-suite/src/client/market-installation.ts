import type { ChangeResult, ClientRemote, PluginInstallProgress, PluginInstallRequestId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MarketItem } from '../shared/types.ts'

type MarketTarget = Pick<MarketItem, 'name' | 'title' | 'spec' | 'version' | 'registry'>
type Target = Pick<MarketTarget, 'title' | 'spec'> & { name?: string; version?: string; registry?: string | null }
type Phase = 'checking' | 'starting' | PluginInstallProgress['phase'] | 'reconciling' | 'unconfirmed' | 'done' | 'failed' | 'cancelled' | 'unknown'
interface Task {
  target: Target
  requestId: PluginInstallRequestId
  phase: Phase
  result?: ChangeResult
  completedRevision?: number
  enabling?: boolean
  enableFailed?: boolean
  inspectionError?: string
}
interface Snapshot {
  task: Task | null
  open: boolean
  manual: boolean
  notice: boolean
  revision: number
}

export function installPending(phase: Phase): boolean {
  return phase === 'checking' || phase === 'starting' || phase === 'installing' || phase === 'cancelling' || phase === 'applying' || phase === 'reconciling'
}

/** Keep manual and market installs alive independently of the dialog and Plugins page. */
export class MarketInstallation {
  private snapshot: Snapshot = { task: null, open: false, manual: false, notice: false, revision: 0 }
  private listeners = new Set<() => void>()

  constructor(
    private readonly manager: Pick<ClientRemote['pluginManager'], 'inspect' | 'installBundle' | 'waitForInstall' | 'cancelInstall' | 'setBundleEnabled'>,
    private readonly signal: AbortSignal,
  ) {}

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(change: Partial<Snapshot>) {
    if (this.signal.aborted) return
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  invalidate = () => this.publish({ revision: this.snapshot.revision + 1 })
  show = () => this.publish({ open: true, manual: false, notice: false })
  hide = () => this.publish({ open: false })
  dismissNotice = () => this.publish({ notice: false })

  private hasActiveTask(): boolean {
    const task = this.snapshot.task
    return Boolean(task && (installPending(task.phase) || task.phase === 'unconfirmed' || task.enabling))
  }

  openManual = () => {
    if (this.hasActiveTask()) this.show()
    else this.publish({ open: true, manual: true, notice: false })
  }

  startManual = async (spec: string, registry: string, title: string) => {
    if (this.hasActiveTask()) { this.show(); return }
    spec = spec.trim()
    if (!spec || this.signal.aborted) return
    const target: Target = { spec, title, ...(registry ? { registry } : {}) }
    const requestId = crypto.randomUUID() as PluginInstallRequestId
    this.publish({ task: { target, requestId, phase: 'checking' }, open: true, manual: false, notice: false })
    const answer = await this.manager.inspect(spec, registry ? { registry } : {}, this.signal).catch(() => null)
    const current = this.snapshot.task
    if (this.signal.aborted || current?.requestId !== requestId) return
    if (!answer?.ok || answer.value.status === 'refused') {
      const inspectionError = answer?.ok && answer.value.status === 'refused' ? answer.value.problem : 'unknown'
      this.publish({ task: { ...current, phase: 'failed', inspectionError }, notice: !this.snapshot.open })
      return
    }
    const { name, version } = answer.value
    const inspected: Target = {
      spec, title: name ?? title, registry: answer.value.registry,
      ...(name === undefined ? {} : { name }), ...(version === undefined ? {} : { version }),
    }
    const task: Task = { target: inspected, requestId, phase: 'starting' }
    this.publish({ task })
    await this.run(task)
  }

  start = (target: MarketTarget) => {
    const { task } = this.snapshot
    if (this.hasActiveTask() || (task?.target.name === target.name && task.phase === 'failed')) {
      this.show()
      return
    }
    this.begin(target)
  }

  retry = (approveScripts: boolean) => {
    const task = this.snapshot.task
    const scripts = task?.result?.pendingBuilds
    if (task?.phase !== 'failed') return
    if (task.inspectionError) { this.openManual(); return }
    if (Boolean(scripts?.length) === approveScripts) this.begin(task.target, scripts)
  }

  reconcile = async () => {
    const task = this.snapshot.task
    if (task?.phase !== 'unconfirmed') return
    this.publish({ task: { ...task, phase: 'reconciling' } })
    await this.recover(task)
  }

  progress = ({ requestId, phase }: PluginInstallProgress) => {
    const task = this.snapshot.task
    if (task?.requestId !== requestId || !installPending(task.phase) || task.phase === 'applying' || task.phase === 'reconciling') return
    if (task.phase === 'cancelling' && phase === 'installing') return
    this.publish({ task: { ...task, phase } })
  }

  cancel = async () => {
    const task = this.snapshot.task
    if (task?.phase !== 'installing') return
    this.publish({ task: { ...task, phase: 'cancelling' } })
    const answer = await this.manager.cancelInstall(task.requestId).catch(() => null)
    const current = this.snapshot.task
    if (current?.requestId !== task.requestId || current.phase !== 'cancelling') return
    if (answer?.ok && answer.value.status === 'cancelled') this.finish(task.requestId, 'cancelled')
    else this.publish({ task: { ...current, phase: answer?.ok && answer.value.status === 'too-late' ? 'applying' : 'installing' } })
  }

  enable = async () => {
    const task = this.snapshot.task
    if (task?.phase !== 'done' || task.enabling || task.result?.enabled) return
    this.publish({ task: { ...task, enabling: true, enableFailed: false } })
    const name = task.result?.bundle
    if (!name) return
    const answer = await this.manager.setBundleEnabled(name, true).catch(() => null)
    if (this.snapshot.task?.requestId !== task.requestId) return
    const applied = answer?.ok && (answer.value.application === 'applied' || answer.value.application === 'restart-required')
    this.publish({
      task: { ...task, enabling: false, enableFailed: !applied, ...(applied ? { result: answer.value } : {}) },
      notice: !this.snapshot.open,
      revision: this.snapshot.revision + 1,
    })
  }

  private begin(target: Target, approvedBuilds?: string[]) {
    const requestId = crypto.randomUUID() as PluginInstallRequestId
    const task: Task = { target, requestId, phase: 'starting' }
    this.publish({ task, open: true, manual: false, notice: false })
    void this.run(task, approvedBuilds)
  }

  private async run(task: Task, approvedBuilds?: string[]) {
    if (this.signal.aborted) return
    const { target, requestId } = task
    const answer = await this.manager.installBundle(target.spec, {
      requestId,
      enabled: false,
      ...(target.name && target.version ? { expected: { name: target.name, version: target.version } } : {}),
      ...(target.registry === undefined ? {} : { registry: target.registry }),
      ...(approvedBuilds?.length ? { approvedBuilds } : {}),
    }).catch(() => null)
    if (this.signal.aborted || this.snapshot.task?.requestId !== requestId) return
    // A missing reply does not mean that the Host stopped. Ask for the same run, never submit another one here.
    if (answer?.ok) this.settle(task, answer.value)
    else await this.recover(task)
  }

  private async recover(task: Task) {
    const answer = await this.manager.waitForInstall(task.requestId).catch(() => null)
    if (answer?.ok) this.settle(task, answer.value)
    else this.finish(task.requestId, 'unconfirmed')
  }

  private settle({ target, requestId }: Task, result: ChangeResult | null) {
    if (!result) this.finish(requestId, 'unknown')
    else if (result.application === 'cancelled') this.finish(requestId, 'cancelled', result)
    else if (result.application === 'failed' || !result.bundle || (target.name && result.bundle !== target.name)) this.finish(requestId, 'failed', result)
    else this.finish(requestId, 'done', result)
  }

  private finish(requestId: PluginInstallRequestId, phase: Phase, result?: ChangeResult) {
    const { task, open, revision } = this.snapshot
    if (task?.requestId !== requestId || !installPending(task.phase)) return
    this.publish({
      task: { ...task, phase, completedRevision: revision + 1, ...(result ? { result } : {}) },
      notice: !open,
      revision: revision + 1,
    })
  }
}
