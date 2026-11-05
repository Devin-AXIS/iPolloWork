export const CARD_WIDTH = 256
const GROUP_WIDTH = 284,
  COLUMN_GAP = 100,
  ROW_GAP = 20
export function portsFor(node, edges) {
  const ports = new Map()
  for (const edge of edges) {
    for (const side of ['source', 'target']) {
      if (edge[side] !== node.id) continue
      const field = edge[`${side}Field`]
      if (!field) continue
      const port = ports.get(field.id) ?? { ...field, side, count: 0 }
      port.count += edge.count ?? 1
      ports.set(field.id, port)
    }
  }
  return [...ports.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  )
}
export function layoutGraph(graph, collapsed = {}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const adjacency = new Map(graph.nodes.map((n) => [n.id, []]))
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.push(edge.target)
    adjacency.get(edge.target)?.push(edge.source)
  }
  const groups = [...new Set(graph.nodes.map((n) => n.tableId))]
  // Keep the entry table first and put strongly connected table groups next to each other.
  const ordered = []
  let next = groups.includes(graph.tableId) ? graph.tableId : groups[0]
  while (next) {
    ordered.push(next)
    const remaining = groups.filter((id) => !ordered.includes(id))
    const score = (id) =>
      graph.edges.filter(
        (e) =>
          (byId.get(e.source)?.tableId === next && byId.get(e.target)?.tableId === id) ||
          (byId.get(e.target)?.tableId === next && byId.get(e.source)?.tableId === id),
      ).length
    next = remaining.sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0]
  }
  const members = new Map(
    ordered.map((id) => [
      id,
      graph.nodes
        .filter((n) => n.tableId === id)
        .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    ]),
  )
  // Barycentric sweeps reduce crossings without a second layout runtime.
  for (let pass = 0; pass < 4; pass++) {
    const rank = new Map([...members.values()].flatMap((nodes) => nodes.map((n, i) => [n.id, i])))
    const center = (n) => {
      const neighbors = adjacency.get(n.id) ?? []
      return neighbors.length
        ? neighbors.reduce((s, id) => s + (rank.get(id) ?? 0), 0) / neighbors.length
        : rank.get(n.id)
    }
    for (const nodes of members.values())
      nodes.sort(
        (a, b) =>
          center(a) - center(b) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
      )
  }
  const nodes = [],
    positions = new Map()
  ordered.forEach((id, column) => {
    const list = members.get(id),
      groupId = `table:${id}`,
      x = column * (GROUP_WIDTH + COLUMN_GAP)
    let y = 52
    const children = list.map((record) => {
      const ports = portsFor(record, graph.edges)
      const compact = collapsed[record.id] ?? graph.nodes.length > 6
      const height = 48 + (compact ? 0 : (record.fields?.length ?? 0) * 26) + ports.length * 30 + 32
      const node = {
        id: record.id,
        type: 'record',
        parentId: groupId,
        extent: 'parent',
        position: { x: 14, y },
        style: { width: CARD_WIDTH, height },
        dragHandle: '.relation-card-heading',
        data: { record, ports, compact },
        zIndex: 2,
      }
      positions.set(record.id, { x: x + 14, y, height, column })
      y += height + ROW_GAP
      return node
    })
    nodes.push(
      {
        id: groupId,
        type: 'tableGroup',
        position: { x, y: 0 },
        style: { width: GROUP_WIDTH, height: Math.max(220, y - ROW_GAP + 14) },
        data: { label: list[0].tableName, count: list.length, root: id === graph.tableId },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 0,
      },
      ...children,
    )
  })
  const edges = graph.edges.map((edge, index) => {
    const a = positions.get(edge.source),
      b = positions.get(edge.target)
    const forward = a.x < b.x,
      same = a.column === b.column
    const sourceSide = forward || same ? 'right' : 'left'
    const targetSide = forward ? 'left' : 'right'
    return {
      ...edge,
      type: 'relation',
      sourceHandle: `${edge.sourceField.id}:${sourceSide}`,
      targetHandle: `${edge.targetField.id}:${targetSide}`,
      zIndex: 1,
      data: {
        edge,
        detour: Math.abs(a.column - b.column) > 1 ? -24 - (index % 4) * 16 : undefined,
        lane: index % 7,
      },
    }
  })
  return { nodes, edges }
}
export function roundedPath(points, radius = 12) {
  let path = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1]
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]),
      bc = Math.hypot(c[0] - b[0], c[1] - b[1])
    if (!ab || !bc) continue
    const r = Math.min(radius, ab / 2, bc / 2)
    path += ` L ${b[0] + ((a[0] - b[0]) * r) / ab} ${b[1] + ((a[1] - b[1]) * r) / ab} Q ${b[0]} ${b[1]} ${b[0] + ((c[0] - b[0]) * r) / bc} ${b[1] + ((c[1] - b[1]) * r) / bc}`
  }
  return `${path} L ${points.at(-1)[0]} ${points.at(-1)[1]}`
}

// Table overview is a projection of this bounded graph, never a second relationship store.
export function tableOverview(graph, fallback) {
  const tables = new Map(),
    records = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const record of graph.nodes) {
    const table = tables.get(record.tableId) ?? {
      id: record.tableId,
      tableId: record.tableId,
      tableName: record.tableName,
      label: record.tableName,
      root: record.tableId === graph.tableId,
      overview: true,
      fields: record.fields,
      recordCount: 0,
    }
    table.recordCount++
    tables.set(table.id, table)
  }
  if (!tables.has(graph.tableId) && fallback)
    tables.set(graph.tableId, {
      id: graph.tableId,
      tableId: graph.tableId,
      tableName: fallback.name,
      label: fallback.name,
      root: true,
      overview: true,
      recordCount: 0,
      fields: (fallback.fields ?? [])
        .filter((f) => !f.isPrimary && f.type !== 'relation')
        .slice(0, 4),
    })
  const relations = new Map()
  for (const edge of graph.edges) {
    if (relations.has(edge.relationId)) {
      relations.get(edge.relationId).count++
      continue
    }
    const source = records.get(edge.source)?.tableId,
      target = records.get(edge.target)?.tableId
    if (!source || !target) continue
    // Orient the overview from the current table; record-level canonical edges stay untouched.
    const reverse = target === graph.tableId && source !== target
    relations.set(edge.relationId, {
      ...edge,
      id: `relation:${edge.relationId}`,
      source: reverse ? target : source,
      target: reverse ? source : target,
      sourceField: reverse ? edge.targetField : edge.sourceField,
      targetField: reverse ? edge.sourceField : edge.targetField,
      count: 1,
    })
  }
  return {
    ...graph,
    nodes: [...tables.values()].sort(
      (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    ),
    edges: [...relations.values()].sort((a, b) => a.relationId.localeCompare(b.relationId)),
  }
}
export function relationSubset(graph, relationId) {
  if (!relationId) return graph
  const edges = graph.edges.filter((e) => e.relationId === relationId)
  const ids = new Set(edges.flatMap((e) => [e.source, e.target]))
  return { ...graph, edges, nodes: graph.nodes.filter((n) => ids.has(n.id)) }
}

// Pages are fetched only after the user expands that record. Keep the original root and dedupe cycles.
export function mergeExploration(pages, root, maxNodes = 200, maxEdges = 400, rootIds = [root.id]) {
  const nodes = new Map(),
    edges = new Map()
  for (const page of pages) {
    for (const node of page.nodes)
      nodes.set(node.id, { ...node, root: rootIds.includes(node.id), exploring: true })
    for (const edge of page.edges) edges.set(edge.id, edge)
  }
  const visible = new Set(rootIds.filter((id) => nodes.has(id))),
    accepted = new Map()
  // Keep only paths reachable from this starting record, never detached leftovers.
  let changed = true,
    limited = pages.some((p) => p.limited)
  while (changed) {
    changed = false
    for (const edge of edges.values()) {
      if (accepted.has(edge.id) || !nodes.has(edge.source) || !nodes.has(edge.target)) continue
      if (!visible.has(edge.source) && !visible.has(edge.target)) continue
      const missing = new Set([edge.source, edge.target].filter((id) => !visible.has(id)))
      if (visible.size + missing.size > maxNodes || accepted.size >= maxEdges) {
        limited = true
        continue
      }
      for (const id of missing) visible.add(id)
      accepted.set(edge.id, edge)
      changed = true
    }
  }
  return {
    tableId: root.tableId,
    rootId: root.id,
    nodes: [...visible].map((id) => nodes.get(id)),
    edges: [...accepted.values()],
    limited,
  }
}

export function layoutExploration(graph, collapsed = {}) {
  const pending = graph.nodes.filter((n) => n.root).map((n) => n.id)
  const depth = new Map(pending.map((id) => [id, 0]))
  for (let i = 0; i < pending.length; i++) {
    for (const e of graph.edges) {
      const other = e.source === pending[i] ? e.target : e.target === pending[i] ? e.source : null
      if (other && !depth.has(other)) {
        depth.set(other, depth.get(pending[i]) + 1)
        pending.push(other)
      }
    }
  }
  const nextY = new Map()
  const nodes = graph.nodes.map((record) => {
    const ports = portsFor(record, graph.edges),
      compact = collapsed[record.id] ?? true,
      level = depth.get(record.id) ?? 0
    const height = 48 + 26 + (compact ? 0 : record.fields.length * 26) + ports.length * 30 + 32
    const y = nextY.get(level) ?? 0
    nextY.set(level, y + height + 46)
    return {
      id: record.id,
      type: 'record',
      position: { x: level * (CARD_WIDTH + 220), y },
      style: { width: CARD_WIDTH, height },
      data: { record: { ...record, depth: level }, ports, compact },
      dragHandle: '.relation-card-heading',
      zIndex: 2,
    }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = graph.edges.map((edge, index) => {
    const a = byId.get(edge.source),
      b = byId.get(edge.target),
      same = a === b,
      right = a.position.x < b.position.x
    return {
      ...edge,
      type: 'relation',
      sourceHandle: `${edge.sourceField.id}:${right || (!same && a.position.x === b.position.x) ? 'right' : 'left'}`,
      targetHandle: `${edge.targetField.id}:${same || right ? 'left' : 'right'}`,
      zIndex: 1,
      data: { edge, lane: 3, self: same, labelLane: index },
    }
  })
  return { nodes, edges }
}
export function layoutOverview(graph, collapsed = {}) {
  const nodes = graph.nodes.map((record) => {
    const ports = portsFor(record, graph.edges),
      compact = collapsed[record.id] ?? true
    return {
      id: record.id,
      type: 'record',
      position: { x: 0, y: 0 },
      style: {
        width: CARD_WIDTH,
        height: 48 + 26 + (compact ? 0 : record.fields.length * 26) + ports.length * 30 + 32,
      },
      data: { record, ports, compact },
      dragHandle: '.relation-card-heading',
      zIndex: 2,
    }
  })
  const root = nodes.find((n) => n.id === graph.tableId)
  if (!root) return { nodes: [], edges: [] }
  const neighbors = nodes
    .filter((n) => n !== root)
    .sort(
      (a, b) => a.data.record.label.localeCompare(b.data.record.label) || a.id.localeCompare(b.id),
    )
  const sides = [[], []]
  neighbors.forEach((n, i) => sides[i % 2].push(n))
  const heights = sides.map((side) => side.reduce((s, n) => s + n.style.height + 40, -40))
  const height = Math.max(root.style.height, ...heights)
  root.position.y = (height - root.style.height) / 2
  sides.forEach((side, index) => {
    let y = (height - heights[index]) / 2
    for (const n of side) {
      n.position = { x: (index ? -1 : 1) * (CARD_WIDTH + 220), y }
      y += n.style.height + 40
    }
    // A single related table aligns at its exact field port, keeping the main link straight.
    if (side.length === 1) {
      const n = side[0],
        link = graph.edges.find((e) => e.source === root.id && e.target === n.id)
      if (link) {
        const offset = (card, field) =>
          48 +
          26 +
          (card.data.compact ? 0 : card.data.record.fields.length * 26) +
          card.data.ports.findIndex((p) => p.id === field) * 30 +
          15
        n.position.y =
          root.position.y + offset(root, link.sourceField.id) - offset(n, link.targetField.id)
      }
    }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = graph.edges.map((edge, index) => {
    const a = byId.get(edge.source),
      b = byId.get(edge.target),
      same = a === b
    const right = !same && a.position.x < b.position.x
    return {
      ...edge,
      type: 'relation',
      sourceHandle: `${edge.sourceField.id}:${right ? 'right' : 'left'}`,
      targetHandle: `${edge.targetField.id}:${same || right ? 'left' : 'right'}`,
      zIndex: 1,
      data: { edge, overview: true, lane: 3, self: same, labelLane: index },
    }
  })
  return { nodes, edges }
}
