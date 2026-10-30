import type { Registry } from './registry'

// A failed activation removes only registrations owned by that activation.
export class PluginScope {
  private cleanups: Array<() => void> = []
  private closed = false
  effect(cleanup: () => void) {
    if (this.closed) {
      cleanup()
      throw new Error('插件已停用')
    }
    this.cleanups.push(cleanup)
  }
  registry<T extends { id: string }>(
    registry: Registry<T>,
    allowed: string[],
    validate?: (entry: T) => void,
  ) {
    return {
      get: (id: string) => registry.get(id),
      register: (entry: T) => {
        if (this.closed) throw new Error('插件已停用')
        if (!allowed.includes(entry.id)) throw new Error(`插件未声明能力：${entry.id}`)
        validate?.(entry)
        this.effect(registry.register(entry))
      },
    }
  }
  dispose() {
    if (this.closed) return
    this.closed = true
    const errors: unknown[] = []
    for (const cleanup of this.cleanups.reverse()) {
      try {
        cleanup()
      } catch (e) {
        errors.push(e)
      }
    }
    this.cleanups = []
    if (errors.length) throw new AggregateError(errors, '插件清理失败')
  }
}
