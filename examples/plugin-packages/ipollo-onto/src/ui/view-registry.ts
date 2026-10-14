import type { ExplorationQuery } from '../core/exploration'
import type { ComponentType } from 'react'
import { Registry } from '../core/registry'
import type { DataRecord, FieldDef, TableData } from '../core/contracts'

export interface ViewProps {
  exploration?: ExplorationQuery
  onExplorationQuery?: (tableId: string, query: ExplorationQuery) => void
  data: TableData
  onOpen: (record: DataRecord) => void
  onAdd: () => void
  onCreateRecord?: (initialValues: Record<string, unknown>) => void
  onUpdateRecord?: (record: DataRecord, values: Record<string, unknown>) => Promise<void>
  onAddField: () => void
  onReorderFields?: (ids: string[]) => Promise<void>
  onEditField?: (field: FieldDef) => void
  onOpenLinked?: (tableId: string, recordId: string) => Promise<void>
  editMode?: boolean
  onCellEditingChange?: (editing: boolean) => void
  onCellSaved?: () => void
}

export interface ViewPlugin {
  id: string
  name: string
  description: string
  icon: ComponentType
  builtIn?: boolean
  component: ComponentType<ViewProps>
}

export const views = new Registry<ViewPlugin>()
