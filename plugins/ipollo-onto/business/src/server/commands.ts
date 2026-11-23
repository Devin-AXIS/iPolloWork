import * as documents from './documents'
import { fieldUpdateInput, fieldDeleteInput } from '../core/field-management'
import { updateField, deleteField, previewFieldDelete } from './field-management'
import { documentCreateInput, documentUpdateInput } from '../core/documents'
import { listRecords } from './list-records'
import { recordListShape } from '../core/query'
import { z } from 'zod'
import { projectCreateInput, createManagedProject, withProject, withTable } from './databases'
import { blueprintInput } from '../core/blueprint'
import * as store from './store'
import { applyBlueprint } from './blueprint'
import { importInput, importRecords } from './import'
import { automationInput, createRule } from './automation'

export const commandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('field.update'),
      tableId: z.uuid(),
      fieldId: z.uuid(),
      input: fieldUpdateInput,
    })
    .strict(),
  z
    .object({ action: z.literal('field.delete.preview'), tableId: z.uuid(), fieldId: z.uuid() })
    .strict(),
  z
    .object({
      action: z.literal('field.delete'),
      tableId: z.uuid(),
      fieldId: z.uuid(),
      input: fieldDeleteInput,
    })
    .strict(),
  z
    .object({
      action: z.literal('document.create'),
      tableId: z.uuid(),
      recordId: z.uuid(),
      input: documentCreateInput,
    })
    .strict(),
  z
    .object({
      action: z.literal('document.get'),
      tableId: z.uuid(),
      recordId: z.uuid(),
      documentId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal('document.update'),
      tableId: z.uuid(),
      recordId: z.uuid(),
      documentId: z.uuid(),
      input: documentUpdateInput,
    })
    .strict(),

  z
    .object({
      action: z.literal('field.configure'),
      tableId: z.uuid(),
      fieldId: z.uuid(),
      input: store.apiFieldUpdateInput,
    })
    .strict(),
  z.object({ action: z.literal('project.create'), input: projectCreateInput }).strict(),
  z.object({ action: z.literal('schema.preview'), input: blueprintInput }).strict(),
  z.object({ action: z.literal('schema.apply'), input: blueprintInput }).strict(),
  z.object({ action: z.literal('schema.get'), projectId: z.uuid() }).strict(),
  z
    .object({ action: z.literal('field.create'), tableId: z.uuid(), input: store.fieldInput })
    .strict(),
  z
    .object({
      action: z.literal('records.list'),
      tableId: z.uuid(),
      ...recordListShape,
    })
    .strict(),
  z
    .object({ action: z.literal('record.create'), tableId: z.uuid(), input: store.recordInput })
    .strict(),
  z
    .object({
      action: z.literal('record.update'),
      tableId: z.uuid(),
      recordId: z.uuid(),
      input: store.recordInput.extend({ version: z.number().int().positive() }),
    })
    .strict(),
  z.object({ action: z.literal('records.import'), tableId: z.uuid(), input: importInput }).strict(),
  z
    .object({ action: z.literal('automation.create'), tableId: z.uuid(), input: automationInput })
    .strict(),
])
export async function executeCommand(raw: unknown) {
  const c = commandInput.parse(raw)
  const run = async () => {
    switch (c.action) {
      case 'field.update':
        return updateField(c.tableId, c.fieldId, c.input)
      case 'field.delete.preview':
        return previewFieldDelete(c.tableId, c.fieldId)
      case 'field.delete':
        return deleteField(c.tableId, c.fieldId, c.input)
      case 'document.create':
        return documents.createDocument(c, c.input)
      case 'document.get':
        return documents.getDocument(c, c.documentId)
      case 'document.update':
        return documents.updateDocument(c, c.documentId, c.input)

      case 'project.create':
        return createManagedProject(c.input)
      case 'schema.preview':
        return applyBlueprint(c.input, true)
      case 'schema.apply':
        return applyBlueprint(c.input)
      case 'schema.get':
        return store.getSchema(c.projectId)
      case 'field.create':
        return store.createField(c.tableId, c.input)
      case 'field.configure':
        return store.updateApiField(c.tableId, c.fieldId, c.input)
      case 'records.list':
        return listRecords(
          c.tableId,
          { page: c.page, query: c.query, selection: c.selection, viewId: c.viewId },
          'resolve',
        )
      case 'record.create':
        return { id: await store.saveRecord(c.tableId, c.input) }
      case 'record.update':
        return { id: await store.saveRecord(c.tableId, c.input, c.recordId) }
      case 'records.import':
        return importRecords(c.tableId, c.input)
      case 'automation.create':
        return createRule(c.tableId, c.input)
    }
  }
  if ('tableId' in c) return withTable(c.tableId, run)
  if ('projectId' in c) return withProject(c.projectId, run)
  return run()
}
