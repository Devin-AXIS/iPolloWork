export async function activate({ React, views, components, services, effect, i18n }) {
  const asset = (file) => {
    const url = new URL(file, import.meta.url)
    url.search = new URL(import.meta.url).search
    return url.href
  }
  const [
    {
      layoutGraph,
      roundedPath,
      tableOverview,
      layoutOverview,
      relationSubset,
      mergeExploration,
      layoutExploration,
    },
    canvas,
  ] = await Promise.all([import(asset('layout.js')), services.graphCanvas()])
  const sheet = document.createElement('link')
  sheet.rel = 'stylesheet'
  sheet.href = asset('style.css')
  document.head.append(sheet)
  effect(() => sheet.remove())
  const {
    ReactFlow,
    Background,
    Handle,
    Position,
    BaseEdge,
    EdgeLabelRenderer,
    getSmoothStepPath,
    useUpdateNodeInternals,
  } = canvas
  const { translate: tr, useLocale } = i18n,
    h = React.createElement
  const { Button, FieldTypeIcon, FieldValue } = components
  function Icon({ name }) {
    const paths = {
      plus: 'M8 2v12M2 8h12',
      minus: 'M2 8h12',
      fit: 'M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4',
      expand: 'M10 2h4v4m0-4-4 4M6 14H2v-4m0 4 4-4',
      shrink: 'M14 6h-4V2m0 4 4-4M2 10h4v4m0-4-4 4',
      layout: 'M1 1h5v5H1zm9 0h5v5h-5zM1 10h5v5H1zm9 0h5v5h-5z',
      down: 'm4 6 4 4 4-4',
      up: 'm4 10 4-4 4 4',
      open: 'M9 2h5v5m0-5L7 9M6 3H2v11h11v-4',
      search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10m4-1 4 4',
      close: 'm4 4 8 8M4 12l8-8',
      branch: 'M3 3v10m0-5h6V3m0 5v5M1 1h4v4H1zm6 0h4v4H7zm0 10h4v4H7z',
      table: 'M2 2h12v12H2zM2 6h12M6 2v12',
      back: 'm6 3-5 5 5 5M1 8h13',
      refresh: 'M13 5A6 6 0 1 0 14 9m-1-8v4H9',
    }
    return h(
      'svg',
      { viewBox: '0 0 16 16', className: 'relations-icon', 'aria-hidden': true },
      h('path', { d: paths[name] ?? paths.table }),
    )
  }
  function Tool({ name, label, onClick, disabled }) {
    return h(
      'button',
      {
        type: 'button',
        className: 'relation-icon-button',
        title: label,
        'aria-label': label,
        onClick,
        disabled,
      },
      h(Icon, { name }),
    )
  }
  function TableGroup({ data }) {
    return h(
      'div',
      { className: `relation-group${data.root ? ' is-core-group' : ''}` },
      h(
        'div',
        { className: 'relation-group-heading' },
        h(Icon, { name: 'table' }),
        h('span', null, data.label),
        data.root && h('b', { className: 'relation-core-tag' }, tr('当前表')),
        h('small', null, data.count),
      ),
    )
  }
  const RecordCard = React.memo(function RecordCard({ id, data }) {
    const {
      record,
      ports,
      compact,
      chosen,
      dimmed,
      activeFields,
      onToggle,
      onOpen,
      onExplore,
      onField,
      onRecenter,
      expandedRecord,
      expanding,
      expansionDisabled,
      onPortsReady,
      portKey,
    } = data
    const update = useUpdateNodeInternals()
    React.useLayoutEffect(() => {
      update(id)
      const frame = requestAnimationFrame(() => onPortsReady(id, portKey))
      return () => cancelAnimationFrame(frame)
    }, [id, compact, portKey, record.fields?.length, update, onPortsReady])
    return h(
      'article',
      {
        className: `relation-card${record.overview ? ' is-table-card' : ''}${(record.overview || record.exploring) && record.root ? ' is-core' : ''}${chosen ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`,
      },
      (record.overview || record.exploring) &&
        record.root &&
        h('span', { className: 'relation-core-label' }, tr('当前中心')),
      h(
        'header',
        { className: 'relation-card-heading' },
        record.overview
          ? h(Icon, { name: 'table' })
          : h('span', { className: `relation-record-mark${record.root ? ' is-root' : ''}` }),
        h('strong', { title: record.label }, record.label),
        h(
          'div',
          { className: 'nodrag' },
          h(Tool, {
            name: compact ? 'down' : 'up',
            label: tr(compact ? '展开 {0} 的字段' : '收起 {0} 的字段', { 0: record.label }),
            onClick: (event) => {
              event.stopPropagation()
              onToggle(id, compact)
            },
          }),
        ),
      ),
      record.overview &&
        h(
          'div',
          { className: 'relation-table-summary' },
          tr('{0} 条已显示的记录', { 0: record.recordCount }),
        ),
      record.exploring &&
        h(
          'div',
          { className: 'relation-table-summary' },
          h('span', null, record.tableName),
          h('small', null, record.root ? tr('起点') : tr('第 {0} 层', { 0: record.depth })),
        ),
      !compact &&
        h(
          'div',
          { className: 'relation-properties' },
          ...(record.fields ?? []).map((field) =>
            h(
              'div',
              { className: 'relation-property', key: field.id },
              h(FieldTypeIcon, { type: field.type }),
              h('span', { className: 'relation-property-name', title: field.name }, field.name),
              !record.overview &&
                h(
                  'span',
                  { className: 'relation-property-value', title: field.value ?? '' },
                  field.value == null || field.value === ''
                    ? '—'
                    : h(FieldValue, {
                        field: { ...field, tableId: record.tableId, options: [] },
                        value: field.type === 'boolean' ? field.value === 'true' : field.value,
                      }),
                ),
            ),
          ),
        ),
      ...ports.map((port) =>
        h(
          'button',
          {
            key: port.id,
            type: 'button',
            className: `relation-port nodrag${activeFields.has(port.id) ? ' is-active' : ''}`,
            'aria-label': tr('查看字段关联 {0} · {1}', { 0: record.label, 1: port.name }),
            title: tr(port.multiple ? '可关联多条记录' : '可关联一条记录'),
            onClick: (event) => {
              event.stopPropagation()
              onField(id, port.id)
            },
          },
          h(Handle, {
            id: `${port.id}:left`,
            type: port.side,
            position: Position.Left,
            isConnectable: false,
          }),
          h(Icon, { name: 'branch' }),
          h('span', { className: 'relation-port-label' }, port.name),
          h('small', null, tr('{0} 条', { 0: port.count })),
          h(Handle, {
            id: `${port.id}:right`,
            type: port.side,
            position: Position.Right,
            isConnectable: false,
          }),
        ),
      ),
      h(
        'footer',
        { className: 'relation-card-footer nodrag' },
        h(
          'button',
          {
            type: 'button',
            onClick: (event) => {
              event.stopPropagation()
              onOpen(record)
            },
          },
          h(Icon, { name: 'open' }),
          tr(record.overview ? '查看记录' : '打开记录'),
        ),
        h(
          'button',
          {
            type: 'button',
            disabled:
              (record.overview && record.root) ||
              (record.exploring && (expandedRecord || expansionDisabled)),
            onClick: (event) => {
              event.stopPropagation()
              onExplore(record)
            },
          },
          h(Icon, { name: 'branch' }),
          tr(
            record.overview
              ? '以此为中心'
              : expanding
                ? '展开中…'
                : expandedRecord
                  ? '已展开'
                  : '展开关联',
          ),
        ),
        record.exploring &&
          !record.root &&
          h(Tool, {
            name: 'fit',
            label: tr('以 {0} 为中心', { 0: record.label }),
            onClick: (event) => {
              event.stopPropagation()
              onRecenter(record)
            },
          }),
      ),
    )
  })
  function RelationEdge(props) {
    const {
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
      sourcePosition,
      targetPosition,
      data,
      id,
    } = props
    let [path, x, y] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
      sourcePosition,
      targetPosition,
      borderRadius: 16,
      centerX:
        sourcePosition !== targetPosition ? (sx + tx) / 2 + ((data.lane ?? 0) - 3) * 7 : undefined,
      offset: data.self ? 120 : 24,
    })
    if (data.detour !== undefined) {
      const ax = sx + (sourcePosition === Position.Right ? 24 : -24),
        bx = tx + (targetPosition === Position.Left ? -24 : 24)
      path = roundedPath(
        [
          [sx, sy],
          [ax, sy],
          [ax, data.detour],
          [bx, data.detour],
          [bx, ty],
          [tx, ty],
        ],
        12,
      )
      x = (ax + bx) / 2
      y = data.detour
    }
    const text = `${data.edge.sourceField.name} ↔ ${data.edge.targetField.name}`
    const cardinality = tr(
      data.edge.sourceField.multiple
        ? data.edge.targetField.multiple
          ? '多对多'
          : '一对多'
        : data.edge.targetField.multiple
          ? '多对一'
          : '一对一',
    )
    return h(
      React.Fragment,
      null,
      h('title', null, text),
      h(BaseEdge, {
        id,
        path,
        style: {
          stroke: data.active
            ? 'var(--data-accent)'
            : 'color-mix(in srgb, var(--data-text-secondary) 68%, var(--data-border))',
          strokeWidth: data.active ? 1.8 : 1.25,
          opacity: data.dimmed ? 0.18 : 1,
        },
        interactionWidth: 20,
      }),
      data.showLabel &&
        h(
          EdgeLabelRenderer,
          null,
          h(
            'button',
            {
              type: 'button',
              className: `relation-edge-label nodrag nopan${data.overview ? ' is-overview' : ''}${data.active ? ' is-active' : ''}`,
              'aria-label': tr('查看关系 {0}', { 0: data.edge.sourceField.name }),
              onClick: () => data.onSelect(id),
              title: text,
              style: { transform: `translate(-50%, -50%) translate(${x}px,${y}px)` },
            },
            data.overview
              ? h(
                  React.Fragment,
                  null,
                  h('strong', null, data.edge.sourceField.name),
                  h('small', null, `${cardinality} · ${data.edge.count}`),
                )
              : text,
          ),
        ),
    )
  }
  const nodeTypes = { record: RecordCard, tableGroup: TableGroup },
    edgeTypes = { relation: RelationEdge }
  function RelationsCanvas({ data, onOpenLinked, exploration, onChooseStart }) {
    useLocale()
    const [storedPayload, setGraph] = React.useState(null),
      [readError, setError] = React.useState(''),
      [readLoading, setLoading] = React.useState(true)
    const payload = exploration?.graph ?? storedPayload,
      error = exploration?.error || readError,
      loading = exploration?.loading ?? readLoading
    const [history, setHistory] = React.useState([]),
      [revision, setRevision] = React.useState(0),
      [selection, setSelection] = React.useState(null)
    const [collapsed, setCollapsed] = React.useState({}),
      [positions, setPositions] = React.useState({}),
      [measurements, setMeasurements] = React.useState({}),
      [readyPorts, setReadyPorts] = React.useState({}),
      [query, setQuery] = React.useState('')
    const [instance, setInstance] = React.useState(null),
      [zoom, setZoom] = React.useState(1),
      [expanded, setExpanded] = React.useState(false)
    const [mode, setMode] = React.useState(exploration ? 'records' : 'tables'),
      [relationFilter, setRelationFilter] = React.useState(null)
    const canvasRef = React.useRef(null)
    const focus = history.at(-1),
      tableId = focus?.tableId ?? data.table.id
    const graph = React.useMemo(
      () =>
        payload
          ? exploration
            ? payload
            : mode === 'tables'
              ? tableOverview(payload, {
                  name: focus?.label ?? data.table.name,
                  fields: tableId === data.table.id ? data.fields : [],
                })
              : relationSubset(payload, relationFilter)
          : null,
      [
        payload,
        mode,
        relationFilter,
        tableId,
        data.table.name,
        data.fields,
        focus?.label,
        !!exploration,
      ],
    )
    const centerName =
      payload?.nodes.find((n) => n.tableId === tableId)?.tableName ??
      focus?.label ??
      data.table.name
    const contextKey = `${tableId}:${focus?.id ?? data.page}:${data.records.map((r) => r.id).join(',')}`
    React.useEffect(() => {
      setHistory([])
      setMode(exploration ? 'records' : 'tables')
      setRelationFilter(null)
      setSelection(null)
      setQuery('')
    }, [data.table.id])
    React.useEffect(() => {
      if (exploration) return
      let active = true
      setLoading(true)
      setError('')
      services
        .graph(tableId, {
          recordId: focus?.id,
          page: focus ? 1 : data.page,
          seedIds: focus ? undefined : data.records.map((r) => r.id),
        })
        .then((result) => {
          if (active) setGraph(result)
        })
        .catch((e) => {
          if (active) setError(e.message)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
      return () => {
        active = false
      }
    }, [data.table.id, data.page, data.records, tableId, focus, revision, !!exploration])
    React.useEffect(() => {
      setGraph(null)
      setPositions({})
      setSelection(null)
      setQuery('')
    }, [contextKey])
    React.useEffect(() => {
      setPositions({})
      setSelection(null)
      setQuery('')
    }, [mode, relationFilter])
    React.useEffect(() => {
      if (exploration) {
        setSelection(null)
        setQuery('')
      }
    }, [exploration?.graph])
    const open = React.useCallback(
      async (record) => {
        if (record.overview) {
          setMode('records')
          setRelationFilter(null)
          if (!record.root)
            setHistory((old) => [...old, { tableId: record.tableId, label: record.label }])
          return
        }
        if (!onOpenLinked) return
        try {
          await onOpenLinked(record.tableId, record.id)
        } catch (e) {
          setError(e.message)
        }
      },
      [onOpenLinked],
    )
    const explore = React.useCallback(
      (record) => {
        if (exploration) {
          exploration.onExpand(record)
          return
        }
        setRelationFilter(null)
        if (record.overview) setMode('tables')
        setHistory((old) => [
          ...old,
          {
            id: record.overview ? undefined : record.id,
            tableId: record.tableId,
            label: record.label,
          },
        ])
      },
      [exploration?.onExpand],
    )
    const toggle = React.useCallback((id, compact) => {
      setCollapsed((old) => ({ ...old, [id]: !compact }))
      setPositions({})
    }, [])
    const chooseField = React.useCallback((id, fieldId) => setSelection({ id, fieldId }), [])
    const portsReady = React.useCallback(
      (id, key) => setReadyPorts((old) => (old[id] === key ? old : { ...old, [id]: key })),
      [],
    )
    const activeEdges = React.useMemo(
      () =>
        new Set(
          (graph?.edges ?? [])
            .filter((e) =>
              selection?.edgeId
                ? e.id === selection.edgeId
                : selection?.fieldId
                  ? (e.source === selection.id && e.sourceField.id === selection.fieldId) ||
                    (e.target === selection.id && e.targetField.id === selection.fieldId)
                  : selection?.id && (e.source === selection.id || e.target === selection.id),
            )
            .map((e) => e.id),
        ),
      [graph, selection],
    )
    const layout = React.useMemo(
      () =>
        graph
          ? exploration
            ? layoutExploration(graph, collapsed)
            : mode === 'tables'
              ? layoutOverview(graph, collapsed)
              : layoutGraph(graph, collapsed)
          : { nodes: [], edges: [] },
      [graph, collapsed, mode, !!exploration],
    )
    const nodes = React.useMemo(() => {
      const connected = new Set(
        [...activeEdges].flatMap((id) => {
          const edge = graph.edges.find((e) => e.id === id)
          return [edge.source, edge.target]
        }),
      )
      if (selection?.id) connected.add(selection.id)
      return layout.nodes.map((node) => {
        if (node.type === 'tableGroup') return { ...node, measured: measurements[node.id] }
        const n = node.data.record
        const activeFields = new Set(
          graph.edges
            .filter((e) => activeEdges.has(e.id))
            .flatMap((e) => [
              ...(e.source === n.id ? [e.sourceField.id] : []),
              ...(e.target === n.id ? [e.targetField.id] : []),
            ]),
        )
        const matches =
          !query ||
          `${n.label} ${n.tableName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        return {
          ...node,
          position: positions[node.id] ?? node.position,
          measured: measurements[node.id],
          ariaLabel: tr(n.overview ? '选择数据表 {0}' : '选择记录 {0}', { 0: n.label }),
          selected: selection?.id === node.id,
          data: {
            ...node.data,
            portKey: node.data.ports.map((p) => `${p.id}:${p.side}`).join(','),
            onPortsReady: portsReady,
            chosen: selection?.id === node.id,
            dimmed: !matches || (!!selection && !connected.has(node.id)),
            activeFields,
            onToggle: toggle,
            onOpen: open,
            onExplore: explore,
            onField: chooseField,
            onRecenter: exploration?.onRecenter,
            expandedRecord: exploration?.expandedIds.has(n.id),
            expanding: exploration?.pending === n.id,
            expansionDisabled: exploration && (exploration.loading || graph.limited),
          },
        }
      })
    }, [
      layout,
      graph,
      positions,
      measurements,
      selection,
      activeEdges,
      query,
      toggle,
      open,
      explore,
      chooseField,
      i18n.getLocale(),
      exploration,
      portsReady,
    ])
    const edges = React.useMemo(
      () =>
        layout.edges
          .filter((edge) =>
            [edge.source, edge.target].every((id) => {
              const node = nodes.find((n) => n.id === id)
              return node && readyPorts[id] === node.data.portKey
            }),
          )
          .map((edge) => ({
            ...edge,
            selected: selection?.edgeId === edge.id,
            ariaLabel: `${edge.data.edge.sourceField.name} ↔ ${edge.data.edge.targetField.name}`,
            data: {
              ...edge.data,
              active: activeEdges.has(edge.id),
              dimmed: !!selection && !activeEdges.has(edge.id),
              showLabel: mode === 'tables' || !!exploration || selection?.edgeId === edge.id,
              onSelect: (id) => setSelection({ edgeId: id }),
            },
          })),
      [layout, activeEdges, selection, mode, !!exploration, nodes, readyPorts],
    )
    const frameCanvas = React.useCallback(
      (readable = true) => {
        if (!instance || !canvasRef.current || !layout.nodes.length) return
        const currentNodes = instance.getNodes()
        const bounds = instance.getNodesBounds(currentNodes)
        const core = mode === 'tables' && currentNodes.find((n) => n.data.record?.root)
        const centerX = core
          ? core.position.x + (core.measured?.width ?? core.style.width) / 2
          : null
        const top = Math.min(
          bounds.y - (mode === 'tables' || exploration ? 36 : 0),
          ...layout.edges.map((e) => e.data.detour ?? bounds.y),
        )
        const totalHeight = bounds.y + bounds.height - top
        const width = canvasRef.current.clientWidth,
          height = canvasRef.current.clientHeight
        const horizontalZoom =
          readable && centerX !== null
            ? (width / 2 - 24) / Math.max(centerX - bounds.x, bounds.x + bounds.width - centerX)
            : (width - 48) / bounds.width
        const z = Math.max(
          readable ? (exploration ? 0.4 : mode === 'tables' ? 0.75 : 0.85) : 0.06,
          Math.min(1, horizontalZoom, (height - 48) / totalHeight),
        )
        instance.setViewport(
          {
            x:
              readable && centerX !== null
                ? width / 2 - centerX * z
                : bounds.width * z < width - 48
                  ? (width - bounds.width * z) / 2 - bounds.x * z
                  : 24 - bounds.x * z,
            y:
              (readable && mode !== 'tables' ? 24 : Math.max(24, (height - totalHeight * z) / 2)) -
              top * z,
            zoom: z,
          },
          { duration: readable ? 0 : 200 },
        )
      },
      [instance, layout, mode, !!exploration],
    )
    const fit = () => frameCanvas(false)
    const frameReadable = () => frameCanvas(true)
    const signature = `${mode}:${graph?.nodes.map((n) => n.id).join(',')}`
    const measured =
      nodes.length > 0 &&
      nodes.every(
        (n) =>
          measurements[n.id]?.width === n.style.width &&
          measurements[n.id]?.height === n.style.height,
      )
    React.useEffect(() => {
      if (instance && signature && measured) {
        const frame = requestAnimationFrame(frameReadable)
        return () => cancelAnimationFrame(frame)
      }
    }, [instance, signature, contextKey, expanded, measured])
    React.useEffect(() => {
      if (!expanded) return
      const escape = (event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !event.target?.closest?.('[role="dialog"]')
        )
          setExpanded(false)
      }
      window.addEventListener('keydown', escape)
      return () => window.removeEventListener('keydown', escape)
    }, [expanded])
    const selectedNode = graph?.nodes.find((n) => n.id === selection?.id)
    const selectedEdge = graph?.edges.find((e) => e.id === selection?.edgeId)
    const found =
      graph?.nodes.filter((n) =>
        `${n.label} ${n.tableName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ) ?? []
    function locate() {
      if (!found[0]) return
      setSelection({ id: found[0].id })
      instance?.fitView({ nodes: [{ id: found[0].id }], padding: 0.6, maxZoom: 1.1, duration: 220 })
    }
    const regroup = () => {
      setPositions({})
      requestAnimationFrame(frameReadable)
    }
    const selectionDetails =
      selection &&
      h(
        'div',
        { className: 'relations-selection' },
        h(Icon, { name: 'branch' }),
        selectedEdge
          ? h(
              React.Fragment,
              null,
              h('strong', null, graph.nodes.find((n) => n.id === selectedEdge.source)?.label),
              h('small', null, selectedEdge.sourceField.name),
              '↔',
              h('strong', null, graph.nodes.find((n) => n.id === selectedEdge.target)?.label),
              h('small', null, selectedEdge.targetField.name),
            )
          : h(
              React.Fragment,
              null,
              h('strong', null, selectedNode?.label),
              selection.fieldId &&
                h(
                  'span',
                  null,
                  nodes
                    .find((n) => n.id === selection.id)
                    ?.data.ports.find((p) => p.id === selection.fieldId)?.name,
                ),
              h(
                'small',
                null,
                tr('{0} 条已显示的关联', {
                  0: graph.edges
                    .filter((e) => activeEdges.has(e.id))
                    .reduce((n, e) => n + (e.count ?? 1), 0),
                }),
              ),
            ),
        mode === 'tables' &&
          selectedEdge &&
          h(
            Button,
            {
              size: '1',
              variant: 'ghost',
              color: 'gray',
              onClick: () => {
                setRelationFilter(selectedEdge.relationId)
                setMode('records')
              },
            },
            tr('展开这组记录'),
          ),
        h(Tool, { name: 'close', label: tr('取消选中'), onClick: () => setSelection(null) }),
      )
    return h(
      'div',
      { className: `relations-view${expanded ? ' is-expanded' : ''}` },
      h(
        'div',
        { className: 'relations-toolbar' },
        h(Tool, { name: 'search', label: tr('选择起点'), onClick: onChooseStart }),
        h(
          'div',
          { className: 'relations-heading' },
          (history.length > 0 || exploration?.canUndo) &&
            h(Tool, {
              name: 'back',
              label: tr('返回上一级关系'),
              onClick: () =>
                exploration ? exploration.onUndo() : setHistory((old) => old.slice(0, -1)),
            }),
          h(Icon, { name: 'branch' }),
          h('span', { className: 'relations-center-caption' }, tr('当前中心')),
          h(
            'strong',
            null,
            exploration?.root.label ?? (mode === 'records' && focus?.id ? focus.label : centerName),
          ),
          h(
            'small',
            null,
            tr(mode === 'tables' ? '{0} 个表 · {1} 类关系' : '{0} 条记录 · {1} 条关联', {
              0: graph?.nodes.length ?? 0,
              1: graph?.edges.length ?? 0,
            }),
          ),
        ),
        !exploration &&
          h(
            'div',
            { className: 'relations-mode', role: 'group', 'aria-label': tr('关系图层级') },
            ...[
              ['tables', '表关系'],
              ['records', '记录关系'],
            ].map(([value, label]) =>
              h(
                'button',
                {
                  key: value,
                  type: 'button',
                  'aria-pressed': mode === value,
                  onClick: () => {
                    setMode(value)
                    setRelationFilter(null)
                  },
                },
                tr(label),
              ),
            ),
          ),
        exploration &&
          h(
            'div',
            { className: 'relations-mode', role: 'group', 'aria-label': tr('展开层数') },
            ...[1, 2, 3].map((depth) =>
              h(
                'button',
                {
                  key: depth,
                  type: 'button',
                  disabled: loading,
                  'aria-pressed': exploration.depth === depth,
                  onClick: () => exploration.onDepth(depth),
                },
                tr('{0} 层', { 0: depth }),
              ),
            ),
          ),
        relationFilter &&
          h(
            Button,
            { size: '1', variant: 'ghost', color: 'gray', onClick: () => setRelationFilter(null) },
            tr('全部记录'),
          ),
        h(
          'label',
          { className: 'relations-search' },
          h(Icon, { name: 'search' }),
          h('input', {
            value: query,
            'aria-label': tr(mode === 'tables' ? '查找图中数据表' : '查找图中记录'),
            placeholder: tr(mode === 'tables' ? '查找数据表…' : '查找记录…'),
            onChange: (e) => {
              setQuery(e.target.value)
              setSelection(null)
            },
            onKeyDown: (e) => {
              if (e.key === 'Enter') locate()
              if (e.key === 'Escape') setQuery('')
            },
          }),
        ),
        query &&
          h(
            Button,
            {
              size: '1',
              variant: 'ghost',
              color: 'gray',
              disabled: !found.length,
              onClick: locate,
            },
            tr('定位'),
          ),
        h(
          Button,
          { size: '1', variant: 'ghost', color: 'gray', onClick: regroup },
          h(Icon, { name: 'layout' }),
          tr('整理布局'),
        ),
        h(Tool, {
          name: 'refresh',
          label: tr('刷新关系图'),
          onClick: () =>
            exploration ? exploration.onRecenter(exploration.root) : setRevision((v) => v + 1),
          disabled: loading,
        }),
        h(Tool, {
          name: expanded ? 'shrink' : 'expand',
          label: tr(expanded ? '收起画布' : '展开画布'),
          onClick: () => setExpanded((value) => !value),
        }),
      ),
      error && h('div', { role: 'alert', className: 'relations-note' }, error),
      !graph?.nodes.length
        ? h(
            'div',
            { className: 'relations-empty' },
            loading
              ? tr('正在读取真实关联…')
              : error
                ? tr('暂时无法读取关系，请重试。')
                : tr('还没有记录。新建记录并添加关联字段后，会在这里形成业务关系。'),
          )
        : h(
            'div',
            { className: 'relations-canvas', ref: canvasRef },
            h(
              ReactFlow,
              {
                nodes,
                edges,
                nodeTypes,
                edgeTypes,
                nodesConnectable: false,
                edgesReconnectable: false,
                deleteKeyCode: null,
                minZoom: 0.06,
                maxZoom: 2,
                attributionPosition: 'bottom-left',
                onInit: setInstance,
                onMove: (_, viewport) => setZoom(viewport.zoom),
                snapToGrid: true,
                snapGrid: [8, 8],
                onNodesChange: (changes) => {
                  const resized = changes.filter((c) => c.type === 'dimensions' && c.dimensions)
                  if (resized.length)
                    setMeasurements((old) => {
                      const next = { ...old }
                      let changed = false
                      for (const c of resized) {
                        if (
                          old[c.id]?.width === c.dimensions.width &&
                          old[c.id]?.height === c.dimensions.height
                        )
                          continue
                        next[c.id] = c.dimensions
                        changed = true
                      }
                      return changed ? next : old
                    })
                  const moved = changes.filter((c) => c.type === 'position' && c.position)
                  if (moved.length)
                    setPositions((old) => ({
                      ...old,
                      ...Object.fromEntries(moved.map((c) => [c.id, c.position])),
                    }))
                  const picked = changes.find(
                    (c) => c.type === 'select' && c.selected && !c.id.startsWith('table:'),
                  )
                  if (picked) setSelection({ id: picked.id })
                },
                onNodeClick: (_, node) => {
                  if (node.type === 'record') setSelection({ id: node.id })
                },
                onNodeDoubleClick: (_, node) => {
                  if (node.type === 'record')
                    node.data.record.overview ? explore(node.data.record) : open(node.data.record)
                },
                onEdgeClick: (_, edge) => setSelection({ edgeId: edge.id }),
                onEdgesChange: (changes) => {
                  const picked = changes.find((c) => c.type === 'select' && c.selected)
                  if (picked) setSelection({ edgeId: picked.id })
                },
                onPaneClick: () => setSelection(null),
                ariaLabelConfig: {
                  'node.a11yDescription.default': tr('按 Enter 选择，方向键移动节点。'),
                  'controls.fitView.ariaLabel': tr('适应画布'),
                },
              },
              h(Background, { gap: 20, size: 0.7, color: 'var(--data-border-strong)' }),
            ),
            selectionDetails,
            loading &&
              h('div', { className: 'relations-canvas-message', role: 'status' }, tr('正在更新…')),
            query &&
              !found.length &&
              h(
                'div',
                { className: 'relations-canvas-message', role: 'status' },
                tr(mode === 'tables' ? '没有匹配的数据表' : '没有匹配的记录'),
              ),
            h(
              'div',
              { className: 'relations-controls' },
              h(Tool, {
                name: 'minus',
                label: tr('缩小关系图'),
                onClick: () => instance?.zoomOut({ duration: 150 }),
              }),
              h('span', null, `${Math.round(zoom * 100)}%`),
              h(Tool, {
                name: 'plus',
                label: tr('放大关系图'),
                onClick: () => instance?.zoomIn({ duration: 150 }),
              }),
              h(Tool, { name: 'fit', label: tr('适应画布'), onClick: fit }),
            ),
          ),
      h(
        'div',
        { className: 'relations-note' },
        h(
          'span',
          null,
          graph?.limited
            ? tr('已达到展示上限，可选择其他记录作为起点继续探索。')
            : exploration
              ? !graph?.edges.length && !loading
                ? tr('当前条件下没有找到关联。可调整范围或选择其他起点。')
                : tr('沿已保存关系按需展开 · 双击打开记录 · 查询不会新增关联')
              : mode === 'tables'
                ? tr(
                    '以当前表为中心 · 连线代表字段关系，数字为当前范围内的记录关联数 · 双击关联表切换中心',
                  )
                : tr('当前页及项目内直接关联 · 点击字段追踪连线 · 双击打开记录'),
        ),
      ),
    )
  }

  function StartPicker({ data, onPick, onOverview, onReturn }) {
    const [term, setTerm] = React.useState(''),
      [scope, setScope] = React.useState(''),
      [active, setActive] = React.useState(0)
    const [result, setResult] = React.useState(null),
      [error, setError] = React.useState(''),
      [revision, setRevision] = React.useState(0)
    const [tables, setTables] = React.useState([{ id: data.table.id, name: data.table.name }])
    const key = `${scope}:${term.trim()}:${revision}`,
      listId = React.useId()
    const ready = result?.key === key,
      records = ready ? result.records : []
    React.useEffect(() => {
      let live = true
      setError('')
      setActive(0)
      const timer = setTimeout(
        () => {
          services
            .graphRecords(data.table.id, { query: term.trim(), tableId: scope || undefined })
            .then((value) => {
              if (live) {
                setTables(value.tables)
                setResult({ ...value, key })
              }
            })
            .catch((e) => {
              if (live) {
                setError(e.message)
                setResult({ key, records: [] })
              }
            })
        },
        term ? 200 : 0,
      )
      return () => {
        live = false
        clearTimeout(timer)
      }
    }, [data.table.id, key])
    return h(
      'div',
      { className: 'relations-start' },
      h(
        'div',
        { className: 'relations-start-actions' },
        onReturn &&
          h(
            Button,
            { size: '1', variant: 'ghost', color: 'gray', onClick: onReturn },
            tr('返回关系图'),
          ),
        h(
          Button,
          { size: '1', variant: 'ghost', color: 'gray', onClick: onOverview },
          tr('查看表关系'),
        ),
      ),
      h(
        'section',
        { className: 'relations-start-node', 'aria-label': tr('选择关系图起点') },
        h(
          'div',
          { className: 'relations-start-heading' },
          h(Icon, { name: 'branch' }),
          h('h2', null, tr('从一个对象开始')),
        ),
        h('p', null, tr('选择一条已有记录，沿它的真实关联逐层探索。')),
        h(
          'div',
          { className: 'relations-start-input' },
          h(Icon, { name: 'search' }),
          h('input', {
            role: 'combobox',
            'aria-label': tr('搜索起点名称'),
            'aria-autocomplete': 'list',
            'aria-expanded': true,
            'aria-controls': listId,
            'aria-activedescendant': records[active] ? `${listId}-${active}` : undefined,
            placeholder: tr('输入名称，例如百度、微软…'),
            value: term,
            maxLength: 80,
            onChange: (e) => {
              setTerm(e.target.value)
              setActive(0)
            },
            onKeyDown: (e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) =>
                  Math.max(0, Math.min(records.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
                )
              }
              if (e.key === 'Enter' && records[active]) {
                e.preventDefault()
                onPick(records[active])
              }
              if (e.key === 'Escape') setTerm('')
            },
          }),
        ),
        h(
          'div',
          { className: 'relations-start-scope' },
          h(
            'label',
            null,
            tr('搜索范围'),
            h(
              'select',
              {
                'aria-label': tr('搜索范围'),
                value: scope,
                onChange: (e) => setScope(e.target.value),
              },
              h('option', { value: '' }, tr('当前项目')),
              ...tables.map((t) => h('option', { value: t.id, key: t.id }, t.name)),
            ),
          ),
          h('small', null, term ? tr('按名称开头匹配') : tr('从当前表开始')),
        ),
        h(
          'div',
          {
            id: listId,
            role: 'listbox',
            'aria-label': tr('匹配的记录'),
            'aria-busy': !ready,
            className: 'relations-start-results',
          },
          ...records.map((record, index) =>
            h(
              'button',
              {
                id: `${listId}-${index}`,
                type: 'button',
                role: 'option',
                'aria-selected': index === active,
                key: record.id,
                onClick: () => onPick(record),
                onFocus: () => setActive(index),
                className: index === active ? 'is-active' : '',
              },
              h(Icon, { name: 'table' }),
              h('strong', null, record.label),
              h('small', null, record.tableName),
              h(Icon, { name: 'open' }),
            ),
          ),
        ),
        !ready &&
          h('div', { role: 'status', className: 'relations-start-status' }, tr('正在搜索…')),
        error
          ? h(
              'div',
              { role: 'alert', className: 'relations-start-status' },
              error,
              h(
                Button,
                { size: '1', variant: 'ghost', onClick: () => setRevision((n) => n + 1) },
                tr('重试'),
              ),
            )
          : ready &&
              !records.length &&
              h(
                'div',
                { role: 'status', className: 'relations-start-status' },
                tr('没有匹配的记录，试试其他名称或数据表。'),
              ),
        result?.hasMore &&
          ready &&
          h(
            'small',
            { className: 'relations-start-status' },
            tr('还有更多结果，继续输入名称可缩小范围。'),
          ),
        result?.tablesLimited &&
          ready &&
          h(
            'small',
            { className: 'relations-start-status' },
            tr('当前项目较大，本次搜索前 64 个表。可从其他表进入继续查找。'),
          ),
      ),
    )
  }

  function RelationsView(props) {
    useLocale()
    const [view, setView] = React.useState('start'),
      [session, setSession] = React.useState(null)
    const [pending, setPending] = React.useState(null),
      [error, setError] = React.useState('')
    const generation = React.useRef(0),
      busy = React.useRef(false)
    React.useEffect(
      () => () => {
        generation.current++
        busy.current = false
      },
      [],
    )
    const initialQuery = JSON.stringify(props.exploration ?? null)
    React.useEffect(() => {
      generation.current++
      busy.current = false
      setSession(null)
      setPending(null)
      setError('')
      setView('start')
      if (props.exploration)
        start(
          {
            tableId: props.data.table.id,
            id: props.exploration.recordIds[0],
            label: tr('正在读取…'),
          },
          props.exploration,
        )
    }, [props.data.table.id, initialQuery])
    async function start(root, query = { recordIds: [root.id], depth: 1 }) {
      const request = ++generation.current
      busy.current = true
      setError('')
      setPending(root.id)
      setSession({ root, query, pages: [] })
      setView('record')
      try {
        const graph = await services.graphExplore(root.tableId, query)
        if (request === generation.current) {
          setSession({
            root: graph.nodes.find((n) => n.id === root.id) ?? root,
            query: graph.query,
            pages: [{ id: root.id, graph }],
          })
          props.onExplorationQuery?.(root.tableId, graph.query)
        }
      } catch (e) {
        if (request === generation.current) setError(e.message)
      } finally {
        if (request === generation.current) {
          busy.current = false
          setPending(null)
        }
      }
    }
    async function expand(record) {
      if (busy.current || session.pages.some((p) => p.id === record.id)) return
      const request = generation.current
      busy.current = true
      setPending(record.id)
      setError('')
      try {
        const query = { ...session.query, recordIds: [record.id], depth: 1 }
        if (query.tableIds) query.tableIds = [...new Set([session.root.tableId, ...query.tableIds])]
        const graph = await services.graphExplore(record.tableId, query)
        if (request === generation.current)
          setSession((old) => ({ ...old, pages: [...old.pages, { id: record.id, graph }] }))
      } catch (e) {
        if (request === generation.current) setError(e.message)
      } finally {
        if (request === generation.current) {
          busy.current = false
          setPending(null)
        }
      }
    }
    const graph = React.useMemo(
      () =>
        session
          ? mergeExploration(
              session.pages.map((p) => p.graph),
              session.root,
              session.query.nodeLimit ?? 100,
              session.query.edgeLimit ?? 200,
              session.query.recordIds,
            )
          : null,
      [session],
    )
    if (view === 'start')
      return h(StartPicker, {
        data: props.data,
        onPick: start,
        onOverview: () => setView('table'),
        onReturn: session ? () => setView('record') : undefined,
      })
    const exploration =
      view === 'record' && session
        ? {
            root: session.root,
            graph,
            loading: !!pending,
            pending,
            error,
            depth: session.query.depth,
            onDepth: (depth) => start(session.root, { ...session.query, depth }),
            expandedIds: new Set(session.pages.filter((p) => !p.graph.limited).map((p) => p.id)),
            canUndo: session.pages.length > 1 && !pending,
            onExpand: expand,
            onRecenter: (root) =>
              start(root, {
                ...session.query,
                recordIds: root.id === session.root.id ? session.query.recordIds : [root.id],
              }),
            onUndo: () => {
              generation.current++
              busy.current = false
              setPending(null)
              setError('')
              setSession((old) => ({ ...old, pages: old.pages.slice(0, -1) }))
            },
          }
        : undefined
    return h(RelationsCanvas, {
      ...props,
      key: exploration ? session.root.id : 'tables',
      exploration,
      onChooseStart: () => setView('start'),
    })
  }
  views.register({
    id: 'relations',
    name: '关系图',
    description: '探索记录之间的真实关联',
    icon: components.icons.relations,
    component: RelationsView,
  })
}
