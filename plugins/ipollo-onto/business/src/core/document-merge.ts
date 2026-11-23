import { documentValueEqual, type DocumentContent, type DocumentNode } from './documents'
export interface DocumentDraft {
  title: string
  content: DocumentContent
}
const same = documentValueEqual
// Merge independent top-level blocks. Conflicting text/order edits remain explicit; never guess prose.
export function mergeDocument(
  base: DocumentDraft,
  local: DocumentDraft,
  remote: DocumentDraft,
): DocumentDraft | undefined {
  const mergeValue = <T>(a: T, b: T, c: T): { value: T } | undefined =>
    same(b, c) ? { value: b } : same(a, b) ? { value: c } : same(a, c) ? { value: b } : undefined
  const title = mergeValue(base.title, local.title, remote.title)
  if (!title) return
  const whole = mergeValue(base.content, local.content, remote.content)
  if (whole) return { title: title.value, content: whole.value }
  const b = base.content.content,
    l = local.content.content,
    r = remote.content.content
  const id = (node: DocumentNode) => node.attrs?.id as string | undefined
  if ([...b, ...l, ...r].some((n) => !id(n))) return
  const maps = [b, l, r].map((nodes) => new Map(nodes.map((n) => [id(n)!, n])))
  const result = new Map<string, DocumentNode>()
  for (const key of new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])) {
    const value = mergeValue(maps[0].get(key), maps[1].get(key), maps[2].get(key))
    if (!value) return
    if (value.value) result.set(key, value.value)
  }
  const oldOrder = b.map((n) => id(n)!).filter((key) => result.has(key))
  const stable = (nodes: DocumentNode[]) =>
    nodes.map((n) => id(n)!).filter((key) => maps[0].has(key) && result.has(key))
  const order = mergeValue(oldOrder, stable(l), stable(r))
  if (!order) return
  const keys = [...order.value]
  // New blocks keep their neighboring position. Remote inserts precede concurrent local inserts.
  for (const nodes of [r, l])
    for (let i = 0; i < nodes.length; i++) {
      const key = id(nodes[i])!
      if (keys.includes(key) || !result.has(key)) continue
      const next = nodes
        .slice(i + 1)
        .map((n) => id(n)!)
        .find((k) => keys.includes(k))
      if (next) keys.splice(keys.indexOf(next), 0, key)
      else keys.push(key)
    }
  return {
    title: title.value,
    content: { type: 'doc', content: keys.map((key) => result.get(key)!) },
  }
}
