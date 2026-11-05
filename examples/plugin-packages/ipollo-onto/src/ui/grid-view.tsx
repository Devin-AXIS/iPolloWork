import { useEffect, useMemo, useRef, useState } from 'react'
import { ResizeHandle, useSavedWidths } from './components/resize-handle'
import { FieldTypeIcon } from './components/icons'
import { useReorder } from './components/use-reorder'
import { translate as tr, useLocale } from './i18n'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { ArrowTopRightIcon, PlusIcon, TableIcon, DragHandleDots2Icon } from '@radix-ui/react-icons'
import { Button } from '@radix-ui/themes'
import { fieldTypes } from '../core/fields'
import type { DataRecord } from '../core/contracts'
import type { ViewProps } from './view-registry'
import { FieldValue } from './fields/value'
import { CellEditor } from './fields/cell-editor'

export default function GridView({
  data,
  onOpen,
  onAdd,
  onAddField,
  onEditField,
  onReorderFields,
  editMode,
  onCellEditingChange,
  onCellSaved,
}: ViewProps) {
  useLocale()
  const previousRows = useRef<{ scope: string; versions: Map<string, number> } | undefined>(
    undefined,
  )
  const [changedRows, setChangedRows] = useState(new Set<string>())
  const rowScope = JSON.stringify([data.table.id, data.page, data.appliedQuery])
  useEffect(() => {
    const previous = previousRows.current
    previousRows.current = {
      scope: rowScope,
      versions: new Map(data.records.map((r) => [r.id, r.version])),
    }
    const changed =
      previous?.scope === rowScope
        ? data.records.filter((r) => previous.versions.get(r.id) !== r.version).map((r) => r.id)
        : []
    setChangedRows(new Set(changed))
    if (!changed.length) return
    const timer = setTimeout(() => setChangedRows(new Set()), 1800)
    return () => clearTimeout(timer)
  }, [data.records, rowScope])
  const layout = useSavedWidths(`ipollo-data.column-widths.${data.table.id}`)
  const defaultWidth = (type: string) =>
    type === 'longtext' ? 260 : type === 'relation' ? 220 : 180
  const reorder = useReorder(
    data.fields.map((f) => f.id),
    'x',
    onReorderFields,
  )
  const columns = useMemo<ColumnDef<DataRecord>[]>(
    () => [
      {
        id: 'index',
        header: '',
        cell: (info) => (
          <span className="row-number">{(data.page - 1) * data.pageSize + info.row.index + 1}</span>
        ),
        size: 48,
      },
      ...data.fields.map((field) => ({
        id: field.id,
        header: () =>
          onEditField ? (
            <button
              className="field-edit"
              onClick={() => onEditField(field)}
              aria-label={tr('编辑字段 {0}', { 0: field.name })}
              title={tr('编辑字段')}
            >
              {field.name}
            </button>
          ) : (
            <span className="field-header-label">{field.name}</span>
          ),
        cell: ({ row }: { row: { original: DataRecord } }) => (
          <FieldValue
            field={field}
            value={row.original.values[field.id]}
            state={row.original.dynamic?.[field.id]}
          />
        ),
        size: defaultWidth(field.type),
        minSize: 100,
        maxSize: 800,
      })),
    ],
    [data.fields, data.page, data.pageSize, onEditField],
  )
  const table = useReactTable({
    data: data.records,
    columns,
    state: { columnSizing: layout.widths },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })
  return (
    <div className="grid-frame">
      <div className="grid-scroll" ref={reorder.containerRef}>
        <table className="data-grid" style={{ width: table.getTotalSize() + 56 }}>
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
            <col />
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header, index) => (
                  <th
                    data-field-id={header.id}
                    key={header.id}
                    {...(index > 0 ? reorder.itemProps(header.id) : {})}
                  >
                    <div className="column-header-content">
                      {index > 0 && (
                        <FieldTypeIcon
                          type={data.fields[index - 1].type}
                          source={data.fields[index - 1].source}
                        />
                      )}
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {index > 0 && (
                        <button {...reorder.handleProps(header.id, data.fields[index - 1].name)}>
                          <DragHandleDots2Icon />
                        </button>
                      )}
                    </div>
                    {index > 0 && (
                      <ResizeHandle
                        label={tr('调整 {0} 列宽', { 0: data.fields[index - 1].name })}
                        value={header.getSize()}
                        min={100}
                        max={800}
                        defaultValue={defaultWidth(data.fields[index - 1].type)}
                        onChange={(width) => layout.change(header.id, width)}
                        onCommit={(width) => layout.commit(header.id, width)}
                      />
                    )}
                  </th>
                ))}
                <th className="add-column">
                  <button aria-label={tr('添加字段')} onClick={onAddField}>
                    <PlusIcon />
                  </button>
                </th>
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                data-record-id={row.id}
                className={changedRows.has(row.id) ? 'record-just-updated' : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {editMode && data.fields.some((f) => f.id === cell.column.id && !f.source) ? (
                      <CellEditor
                        field={data.fields.find((f) => f.id === cell.column.id)!}
                        record={row.original}
                        onSaved={onCellSaved}
                        onEditingChange={onCellEditingChange}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </CellEditor>
                    ) : (
                      <button
                        className="record-open"
                        onClick={() => onOpen(row.original)}
                        aria-label={tr('打开记录 {0}', {
                          0:
                            fieldTypes
                              .get('text')
                              .format(
                                row.original.values[data.fields.find((f) => f.isPrimary)?.id ?? ''],
                              ) || tr('未命名'),
                        })}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        <ArrowTopRightIcon />
                      </button>
                    )}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        <button className="add-row" onClick={onAdd}>
          <PlusIcon />
          {tr('新建记录')}
        </button>
      </div>
      {data.total === 0 && (
        <div className="table-empty">
          <div className="empty-mark">
            <TableIcon />
          </div>
          <h3>
            {data.appliedQuery?.filter || data.appliedQuery?.search
              ? tr('没有符合条件的记录')
              : tr('让第一条记录，连接业务')}
          </h3>
          <p>
            {data.appliedQuery?.filter || data.appliedQuery?.search
              ? tr('试试调整或清除筛选条件，已有数据不会被删除。')
              : tr('添加客户、项目或任何你想管理的信息。')}
          </p>
          <Button onClick={onAdd}>
            <PlusIcon />
            {tr('新建记录')}
          </Button>
        </div>
      )}
    </div>
  )
}
