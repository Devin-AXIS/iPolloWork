/** Native plugin connection registry; entries follow their contributing plugin lifetime. */
import type { ConnectionManager, ConnectionProvider } from '../shared/connections.ts'
export interface ConnectionSnapshot {
  providers: readonly ConnectionProvider[]
  open: boolean
  selected: string | undefined
  revision: number
}
/** Keep registration identity and dialog navigation scoped to the suite lifetime. */
export class Connections implements ConnectionManager {
  private registrations = new Map<string, ConnectionProvider[]>()
  private listeners = new Set<() => void>()
  private snapshot: ConnectionSnapshot = { providers: [], open: false, selected: undefined, revision: 0 }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(change: Partial<ConnectionSnapshot> = {}, invalidate = false) {
    this.snapshot = { ...this.snapshot, ...change, providers: [...this.registrations.values()].map(items => items[0]!), revision: this.snapshot.revision + Number(invalidate) }
    for (const listener of this.listeners) listener()
  }
  register(provider: ConnectionProvider): () => void {
    const entries = this.registrations.get(provider.id) ?? []
    entries.push(provider); this.registrations.set(provider.id, entries); this.publish({}, true)
    return () => {
      const active = this.registrations.get(provider.id)?.filter(item => item !== provider) ?? []
      if (active.length) this.registrations.set(provider.id, active)
      else this.registrations.delete(provider.id)
      this.publish(!active.length && this.snapshot.selected === provider.id ? { selected: undefined } : {}, true)
    }
  }
  open = (id?: string) => this.publish({ open: true, selected: id })
  close = () => this.publish({ open: false, selected: undefined })
  changed = () => this.publish({}, true)
}
