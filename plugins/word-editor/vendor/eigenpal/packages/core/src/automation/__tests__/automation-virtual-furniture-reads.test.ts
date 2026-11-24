// A header or footer variant the document does not have is an empty body until text creates it
// (issue #1125). Every read on that body answers what the same read answers on a declared,
// empty part, and a read never creates the part.

import { describe, expect, test } from 'bun:test';
import { handleAt, handlesAt, open, p, roots, savedPartBytes } from './support/protocol.ts';
import {
  footerPart,
  furnitureRef,
  headerPart,
  REL_TYPES,
  richDocx,
  sectionProperties,
} from './support/furniture.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import type { AutomationOperation } from '../operations.ts';

/** One section with a default header. With `empty`, it also declares an empty default footer. */
function host(empty: boolean): AutomationHost {
  return open(
    richDocx({
      body:
        p('Body') +
        sectionProperties([
          furnitureRef('header', 'rId10', 'default'),
          ...(empty ? [furnitureRef('footer', 'rId11', 'default')] : []),
        ]),
      rels: [
        { id: 'rId10', type: REL_TYPES.header, target: 'header1.xml' },
        ...(empty ? [{ id: 'rId11', type: REL_TYPES.footer, target: 'footer1.xml' }] : []),
      ],
      parts: [
        headerPart('word/header1.xml', p('Header text')),
        ...(empty ? [footerPart('word/footer1.xml', '')] : []),
      ],
    })
  );
}

function furniture(
  target: AutomationHost,
  kind: 'header' | 'footer',
  variant: 'default' | 'first' | 'even'
): AutomationHandle {
  const { document } = roots(target);
  const section = handlesAt(
    target.execute({ operations: [{ op: 'getSections', document }] }),
    0
  )[0]!;
  return handleAt(
    target.execute({ operations: [{ op: 'getFurniture', section, kind, variant }] }),
    0
  );
}

const READS = (body: AutomationHandle): AutomationOperation[] => [
  { op: 'getParagraphs', body },
  { op: 'getText', target: body },
  { op: 'getShapes', span: { body } },
  { op: 'getInlinePictures', span: { body } },
  { op: 'getTables', scope: { body } },
  { op: 'getFields', span: { body } },
  { op: 'search', scope: { body }, text: 'x' },
  { op: 'getComments', scope: { body } },
  { op: 'getBookmarks', scope: { body } },
  { op: 'getContentControls', scope: { body } },
  { op: 'getRevisions', body },
  { op: 'getLists', body },
  { op: 'getSpanText', span: { body } },
  { op: 'getSpanParagraphs', span: { body } },
  { op: 'getRange', span: { body }, location: 'Whole' },
  { op: 'getFont', span: { body } },
  { op: 'getStyle', span: { body } },
  { op: 'getHyperlink', span: { body } },
  { op: 'getParagraphFormat', paragraph: { body, at: 'first' } },
  { op: 'getListById', body, id: 1 },
];

/** A result with handle refs removed: two hosts mint different refs for the same answer. */
function shape(target: AutomationHost, operation: AutomationOperation): unknown {
  const result = target.execute({ operations: [operation] }).results[0]!;
  return JSON.parse(JSON.stringify(result).replace(/"ref":"[^"]*"/g, '"ref":""'));
}

describe('reads on a missing header or footer', () => {
  test('answer what the same reads answer on a declared empty footer', () => {
    const missing = host(false);
    const declared = host(true);
    const virtual = READS(furniture(missing, 'footer', 'default'));
    const real = READS(furniture(declared, 'footer', 'default'));
    virtual.forEach((operation, index) => {
      expect([operation.op, shape(missing, operation)]).toEqual([
        operation.op,
        shape(declared, real[index]!),
      ]);
    });
  });

  for (const [kind, variant] of [
    ['header', 'first'],
    ['header', 'even'],
    ['footer', 'default'],
    ['footer', 'first'],
    ['footer', 'even'],
  ] as const) {
    test(`every list read succeeds for ${kind} ${variant}, and none creates the part`, () => {
      const target = host(false);
      const before = savedPartBytes(target, 'word/document.xml');
      for (const operation of READS(furniture(target, kind, variant))) {
        // A range, a paragraph format, and a list number need content; the empty-footer
        // comparison covers those refusals.
        if (['getRange', 'getParagraphFormat', 'getListById'].includes(operation.op)) continue;
        const result = target.execute({ operations: [operation] }).results[0]!;
        expect([operation.op, result.status]).toEqual([operation.op, 'ok']);
      }
      const saved = target.save();
      if (!saved.ok) throw new Error('save refused');
      expect(savedPartBytes(target, 'word/document.xml')).toBe(before);
      expect(savedPartBytes(target, 'word/footer1.xml')).toBe('');
    });
  }

  test('a write that changes nothing succeeds and creates nothing', () => {
    const target = host(false);
    const body = furniture(target, 'footer', 'default');
    const response = target.execute({ operations: [{ op: 'acceptAllRevisions', body }] });
    expect(response.ok).toBe(true);
    expect(response.changed).toBe(false);
    const tracked = target.execute({
      operations: [
        { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' },
        { op: 'rejectAllRevisions', body },
      ],
    });
    expect(tracked.ok).toBe(true);
  });

  test('resolving every revision of the missing body answers without reading it back', () => {
    const target = host(false);
    const body = furniture(target, 'footer', 'default');
    const response = target.execute({
      operations: [{ op: 'resolveRevisionBatch', body, action: 'accept' }],
    });
    expect(response.ok).toBe(true);
    expect(response.changed).toBe(false);
  });

  test('a no-op write does not block the creating write in the same batch', () => {
    const target = host(false);
    const body = furniture(target, 'footer', 'default');
    const response = target.execute({
      operations: [
        { op: 'acceptAllRevisions', body },
        {
          op: 'insertParagraph',
          anchor: { body, at: 'first' },
          where: 'before',
          text: 'Page foot',
        },
      ],
    });
    expect(response.results.map((result) => result.status)).toEqual(['ok', 'ok']);
    // The created part holds one empty paragraph; the new one goes before it.
    expect(target.execute({ operations: [{ op: 'getText', target: body }] }).results[0]).toEqual({
      status: 'ok',
      value: { kind: 'text', text: 'Page foot\r' },
    });
  });

  test('a write that would change the missing body refuses without creating it', () => {
    const target = host(false);
    const before = savedPartBytes(target, 'word/document.xml');
    const body = furniture(target, 'footer', 'default');
    const response = target.execute({
      operations: [
        { op: 'insertTable', span: { body }, rowCount: 1, columnCount: 1, location: 'After' },
      ],
    });
    expect(response.ok).toBe(false);
    expect(response.results[0]).toMatchObject({ status: 'error' });
    expect(savedPartBytes(target, 'word/document.xml')).toBe(before);
  });

  test('text written into the body still creates the part', () => {
    const target = host(false);
    const body = furniture(target, 'footer', 'default');
    const response = target.execute({
      operations: [{ op: 'insertText', at: { body, at: 'end' }, text: 'Page foot' }],
    });
    expect(response.ok).toBe(true);
    expect(
      handlesAt(target.execute({ operations: [{ op: 'getTables', scope: { body } }] }), 0)
    ).toEqual([]);
    expect(target.execute({ operations: [{ op: 'getText', target: body }] }).results[0]).toEqual({
      status: 'ok',
      value: { kind: 'text', text: 'Page foot' },
    });
  });
});
