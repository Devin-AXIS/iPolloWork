import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDocument, type DocumentDraft } from '../src/core/document-merge'
import {
  validateContent,
  applyDocumentOperations,
  documentContentInput,
} from '../src/core/documents'
import { z } from 'zod'
const block = (id: string, text: string) => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
})
const draft = (...items: Array<[string, string]>): DocumentDraft => ({
  title: '研究',
  content: { type: 'doc', content: items.map(([id, t]) => block(id, t)) },
})
test('independent human/AI edits merge, while shared text and ordering conflicts remain explicit', () => {
  const base = draft(['a', 'first'], ['b', 'second'])
  assert.deepEqual(
    mergeDocument(
      base,
      draft(['a', 'human'], ['b', 'second']),
      draft(['a', 'first'], ['b', 'agent']),
    ),
    draft(['a', 'human'], ['b', 'agent']),
  )
  assert.equal(
    mergeDocument(
      base,
      draft(['a', 'human'], ['b', 'second']),
      draft(['a', 'agent'], ['b', 'second']),
    ),
    undefined,
  )
  assert.deepEqual(
    mergeDocument(
      base,
      draft(['a', 'first'], ['b', 'second'], ['c', 'added']),
      draft(['a', 'first'], ['b', 'agent']),
    ),
    draft(['a', 'first'], ['b', 'agent'], ['c', 'added']),
  )
  assert.deepEqual(
    mergeDocument(base, draft(['a', 'first']), draft(['a', 'agent'], ['b', 'second'])),
    draft(['a', 'agent']),
  )
  assert.equal(
    mergeDocument(base, draft(['a', 'first']), draft(['a', 'first'], ['b', 'agent'])),
    undefined,
  )
  assert.equal(
    mergeDocument(base, { ...base, title: 'mine' }, { ...base, title: 'theirs' }),
    undefined,
  )
})
test('content API rejects executable links, duplicate IDs, oversized or invalid shapes; schema is AI-discoverable', () => {
  assert.equal(validateContent(draft(['a', 'text']).content), true)
  assert.equal(validateContent(draft(['a', 'x'], ['a', 'y']).content), false)
  assert.equal(
    validateContent({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
    }),
    false,
  )
  assert.equal(
    validateContent({ type: 'doc', content: [{ type: 'html', text: '<script></script>' }] }),
    false,
  )
  assert.equal(validateContent(draft(['a', 'a'.repeat(510000)]).content), false)
  assert.ok(z.toJSONSchema(documentContentInput))
  const content = applyDocumentOperations(draft(['a', 'original']).content, [
    { op: 'replace', blockId: 'a', block: block('b', 'replacement') },
    { op: 'append', blocks: [block('c', 'new')] },
  ])
  assert.equal(content.content[0].attrs?.id, 'a')
  assert.throws(() => applyDocumentOperations(content, [{ op: 'remove', blockId: 'missing' }]))
})

test('JSONB key ordering is semantically equal and does not create false merge conflicts', async () => {
  const { documentValueEqual } = await import('../src/core/documents')
  const before = draft(['a', 'same'])
  const pg = {
    title: '研究',
    content: {
      content: [
        { content: [{ text: 'same', type: 'text' }], attrs: { id: 'a' }, type: 'paragraph' },
      ],
      type: 'doc' as const,
    },
  }
  assert.equal(documentValueEqual(before, pg), true)
  assert.deepEqual(mergeDocument(before, pg, draft(['a', 'remote'])), draft(['a', 'remote']))
  assert.equal(
    validateContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'invalid nesting' }],
            },
          ],
        },
      ],
    }),
    false,
  )
})

test('editable tables and videos are structured blocks; executable HTML remains unsupported', () => {
  const table = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [block('p', '公司')] },
          { type: 'tableCell', content: [block('q', '收入')] },
        ],
      },
    ],
  }
  assert.equal(
    validateContent({
      type: 'doc',
      content: [table, { type: 'video', attrs: { src: 'https://example.com/film.mp4' } }],
    }),
    true,
  )
  assert.equal(
    validateContent({
      type: 'doc',
      content: [{ type: 'video', attrs: { src: 'javascript:alert(1)' } }],
    }),
    false,
  )
  assert.equal(
    validateContent({
      type: 'doc',
      content: [{ type: 'htmlBlock', attrs: { html: '<h1>disabled</h1>' } }],
    }),
    false,
  )
  assert.equal(
    validateContent({
      type: 'doc',
      content: [{ type: 'table', content: [block('r', 'wrong child')] }],
    }),
    false,
  )
  assert.equal(
    validateContent({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', attrs: { colspan: 5000 }, content: [block('s', 'bad span')] },
              ],
            },
          ],
        },
      ],
    }),
    false,
  )
})
