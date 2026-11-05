export class Registry<T extends { id: string }> {
  private readonly entries = new Map<string, T>()
  register(entry: T) {
    if (this.entries.has(entry.id)) throw new Error(`重复扩展：${entry.id}`)
    this.entries.set(entry.id, entry)
    return () => {
      if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id)
    }
  }
  get(id: string): T {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`未知扩展：${id}`)
    return entry
  }
  has(id: string) {
    return this.entries.has(id)
  }
  list() {
    return Array.from(this.entries.values())
  }
}
