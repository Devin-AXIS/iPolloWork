import type { ComponentType } from 'react'
import { Registry } from '../../core/registry'
import type { ValueInputProps } from './input-controls'

export interface FieldEditor {
  id: string
  component: ComponentType<ValueInputProps>
  configure?: ComponentType<{ options: string[]; onChange: (options: string[]) => void }>
  defaultOptions?: string[]
}
// Only enabled, declared plugin fields may register editors. Cleanup follows plugin ownership.
export const fieldEditors = new Registry<FieldEditor>()
