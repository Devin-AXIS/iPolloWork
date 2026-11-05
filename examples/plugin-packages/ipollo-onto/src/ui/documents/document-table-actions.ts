import { createContext } from 'react'
import type { TableData } from '../../core/contracts'

// Node views inherit the record drawer's navigation and mutation lifecycle.
export const DocumentTableActions = createContext<{
  revision: number
  onCreate: (data: TableData, values: Record<string, unknown>) => void
  onChanged: () => void
} | null>(null)
