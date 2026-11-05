import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RelationGraph } from '../src/core/contracts'
// The separately delivered view package is browser ESM, outside the host TypeScript build.
// @ts-expect-error No generated declarations for the independent plugin.
import * as relationLayout from '../extensions/relations/layout.js'
const {
  layoutGraph,
  portsFor,
  roundedPath,
  tableOverview,
  layoutOverview,
  relationSubset,
  mergeExploration,
  layoutExploration,
} = relationLayout

const node = (id: string, tableId: string) => ({
  id,
  tableId,
  tableName: tableId,
  label: id,
  root: tableId === 'a',
  fields: [{ id: `name:${id}`, name: '属性', type: 'text', value: '示例', api: false }],
})
const edge = (id: string, source: string, target: string) => ({
  id,
  relationId: id,
  source,
  target,
  label: id,
  sourceField: { id: `${id}:from`, name: '关联', multiple: true },
  targetField: { id: `${id}:to`, name: '反向', multiple: false },
})
const graph: RelationGraph = {
  tableId: 'a',
  limited: false,
  nodes: [node('a1', 'a'), node('a2', 'a'), node('b1', 'b'), node('c1', 'c')],
  edges: [
    edge('ab', 'a1', 'b1'),
    edge('parallel', 'a1', 'b1'),
    edge('ba', 'b1', 'a1'),
    edge('same-table', 'a1', 'a2'),
    edge('self', 'a1', 'a1'),
    edge('ac', 'a1', 'c1'),
  ],
}

test('field handles distinguish parallel, reverse, same-table and self relationships', () => {
  const layout = layoutGraph(graph)
  for (const link of layout.edges) {
    for (const side of ['source', 'target'] as const) {
      const card = layout.nodes.find((n: { id: string }) => n.id === link[side])
      const port = card.data.ports.find((p: { id: string }) => p.id === link[`${side}Field`].id)
      assert.ok(port, `${link.id} has its ${side} field on the record card`)
      assert.equal(port.side, side)
      assert.match(link[`${side}Handle`], new RegExp(`^${port.id}:(left|right)$`))
    }
  }
  const selfPorts = portsFor(graph.nodes[0], graph.edges).filter((p: { id: string }) =>
    p.id.startsWith('self:'),
  )
  assert.equal(selfPorts.length, 2)
  assert.notEqual(layout.edges[0].sourceHandle, layout.edges[1].sourceHandle)
  assert.ok(layout.edges.find((e: { id: string }) => e.id === 'ac').data.detour < 0)
})

test('grouped layout has no overlapping cards and keeps ports when values collapse', () => {
  const expanded = layoutGraph(graph)
  const collapsed = layoutGraph(graph, Object.fromEntries(graph.nodes.map((n) => [n.id, true])))
  assert.equal(expanded.nodes.filter((n: { type: string }) => n.type === 'tableGroup').length, 3)
  for (const layout of [expanded, collapsed]) {
    const cards = layout.nodes.filter((n: { type: string }) => n.type === 'record')
    for (const card of cards) {
      const parent = layout.nodes.find((n: { id: string }) => n.id === card.parentId)
      assert.ok(card.position.x >= 0 && card.position.y >= 0)
      assert.ok(card.position.x + card.style.width <= parent.style.width)
      assert.ok(card.position.y + card.style.height <= parent.style.height)
      for (const other of cards) {
        if (card.id === other.id || card.parentId !== other.parentId) continue
        assert.ok(
          card.position.y + card.style.height <= other.position.y ||
            other.position.y + other.style.height <= card.position.y,
        )
      }
    }
  }
  for (const original of expanded.nodes.filter((n: { type: string }) => n.type === 'record')) {
    const compact = collapsed.nodes.find((n: { id: string }) => n.id === original.id)
    assert.ok(compact.style.height < original.style.height)
    assert.deepEqual(compact.data.ports, original.data.ports)
  }
  assert.deepEqual(
    expanded.nodes,
    layoutGraph({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() })
      .nodes,
  )
})

test('rounded detours stay finite across short, repeated and reversed segments', () => {
  const paths = [
    roundedPath(
      [
        [0, 0],
        [40, 0],
        [40, 80],
        [100, 80],
      ],
      16,
    ),
    roundedPath(
      [
        [0, 0],
        [0, 0],
        [2, 0],
        [2, -3],
        [0, -3],
      ],
      16,
    ),
  ]
  for (const path of paths) {
    assert.ok(!/NaN|Infinity/.test(path))
    assert.match(path, /^M 0 0 /)
    assert.match(path, / Q /)
  }
  assert.ok(paths[0].endsWith('L 100 80'))
})

test('table overview aggregates by relation identity and follows the current table perspective', () => {
  const rows = {
    ...graph,
    edges: [...graph.edges, { ...graph.edges[0]!, id: 'ab-second', source: 'a2' }],
  }
  const overview = tableOverview(rows)
  assert.equal(overview.nodes.length, 3)
  assert.equal(overview.nodes.find((n: { id: string }) => n.id === 'a').recordCount, 2)
  assert.equal(overview.edges.find((e: { relationId: string }) => e.relationId === 'ab').count, 2)
  assert.equal(
    overview.edges.filter(
      (e: { source: string; target: string }) => e.source === 'a' && e.target === 'b',
    ).length,
    3,
  )
  const reverse = overview.edges.find((e: { relationId: string }) => e.relationId === 'ba')
  assert.equal(reverse.sourceField.id, 'ba:to')
  assert.equal(reverse.targetField.id, 'ba:from')
  assert.equal(reverse.source, 'a')
  assert.equal(graph.edges[2]!.source, 'b1')
  const subset = relationSubset(rows, 'ab')
  assert.equal(subset.edges.length, 2)
  assert.deepEqual(
    new Set(subset.nodes.map((n: { id: string }) => n.id)),
    new Set(['a1', 'a2', 'b1']),
  )
  const port = portsFor(
    overview.nodes.find((n: { id: string }) => n.id === 'a'),
    overview.edges,
  ).find((p: { id: string }) => p.id === 'ab:from')
  assert.equal(port.count, 2)
})

test('overview layout identifies one center and connects aggregate lines to valid field ports', () => {
  const overview = tableOverview(graph)
  const layout = layoutOverview(overview)
  const root = layout.nodes.find((n: { id: string }) => n.id === 'a')
  assert.ok(root.data.record.root)
  assert.equal(
    layout.nodes.filter((n: { data: { record: { root: boolean } } }) => n.data.record.root).length,
    1,
  )
  assert.ok(layout.nodes.some((n: { position: { x: number } }) => n.position.x < root.position.x))
  assert.ok(layout.nodes.some((n: { position: { x: number } }) => n.position.x > root.position.x))
  for (const link of layout.edges) {
    for (const side of ['source', 'target'] as const) {
      const card = layout.nodes.find((n: { id: string }) => n.id === link[side])
      assert.ok(
        card.data.ports.some((p: { id: string }) => link[`${side}Handle`].startsWith(p.id + ':')),
      )
    }
  }
  const empty = tableOverview(
    { tableId: 'empty', nodes: [], edges: [], limited: false },
    { name: '空表', fields: [] },
  )
  assert.equal(layoutOverview(empty).nodes[0].data.record.label, '空表')
  assert.equal(empty.nodes[0].recordCount, 0)
  assert.equal(empty.edges.length, 0)
})

test('incremental exploration preserves the root and path while deduplicating reverse visits and cycles', () => {
  const root = { id: 'a1', tableId: 'a' }
  const first = {
    tableId: 'a',
    limited: false,
    nodes: [node('a1', 'a'), node('b1', 'b')],
    edges: [edge('ab', 'a1', 'b1')],
  }
  const second = {
    tableId: 'b',
    limited: false,
    nodes: [node('b1', 'b'), node('a1', 'a'), node('c1', 'c')],
    edges: [first.edges[0], edge('bc', 'b1', 'c1')],
  }
  const unrelated = {
    tableId: 'x',
    limited: false,
    nodes: [node('x1', 'x'), node('x2', 'x')],
    edges: [edge('xx', 'x1', 'x2')],
  }
  const initial = mergeExploration([first], root)
  assert.deepEqual(
    initial.nodes.map((n: { id: string }) => n.id),
    ['a1', 'b1'],
  )
  const merged = mergeExploration([first, second, second, unrelated], root)
  assert.equal(merged.nodes.length, 3)
  assert.equal(merged.edges.length, 2)
  assert.deepEqual(
    merged.nodes.filter((n: { root: boolean }) => n.root).map((n: { id: string }) => n.id),
    ['a1'],
  )
  assert.deepEqual(merged.edges[0], first.edges[0])
  const layout = layoutExploration(merged)
  assert.deepEqual(
    layout.nodes.map((n: { data: { record: { depth: number } } }) => n.data.record.depth),
    [0, 1, 2],
  )
  for (const link of layout.edges)
    for (const side of ['source', 'target']) {
      const card = layout.nodes.find((n: { id: string }) => n.id === link[side])
      assert.ok(
        card.data.ports.some((p: { id: string }) => link[`${side}Handle`].startsWith(p.id + ':')),
      )
    }
  const limited = mergeExploration([first, second], root, 2, 1)
  assert.equal(limited.limited, true)
  assert.deepEqual(
    limited.nodes.map((n: { id: string }) => n.id),
    ['a1', 'b1'],
  )
  assert.equal(limited.edges.length, 1)
  assert.deepEqual(mergeExploration([first], root), initial)
  const isolated = mergeExploration([{ ...first, nodes: [first.nodes[0]], edges: [] }], root)
  assert.equal(isolated.nodes.length, 1)
  assert.equal(isolated.edges.length, 0)
})
