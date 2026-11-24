// `CT_PPrBase` is a strict `xsd:sequence`. Consumers refuse a file with an element in the
// wrong slot even when every value in it is correct, and nothing downstream catches it: the
// tree still reads, and the layout still paints.

import { describe, expect, test } from 'bun:test';
import { CT_PPR_SEQUENCE, schemaInsertIndex } from '../tree-op-properties.ts';
import type { OoxmlNode } from '../../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** A `w:` child, or a `w14:` one when `name` carries that prefix. */
const el = (name: string): OoxmlNode => {
  const extension = name.startsWith('w14:');
  const localName = extension ? name.slice(4) : name;
  return {
    kind: 'generic',
    id: name,
    namespaceUri: extension ? W14 : W,
    localName,
    children: [],
  } as unknown as OoxmlNode;
};

describe('schemaInsertIndex ranks against the WHOLE sequence', () => {
  test('w:tabs lands after every element that outranks it', () => {
    // The reported break: a `w:pPr` that already carried `w:keepNext` came out with
    // `w:tabs` in front of it, because only `pStyle` and `numPr` were accounted for.
    expect(schemaInsertIndex([el('keepNext')], CT_PPR_SEQUENCE, 'tabs')).toBe(1);
    expect(schemaInsertIndex([el('pStyle'), el('pBdr'), el('shd')], CT_PPR_SEQUENCE, 'tabs')).toBe(
      3
    );
    expect(
      schemaInsertIndex(
        [el('keepNext'), el('keepLines'), el('pageBreakBefore'), el('widowControl')],
        CT_PPR_SEQUENCE,
        'tabs'
      )
    ).toBe(4);
  });

  test('and before everything it outranks', () => {
    expect(schemaInsertIndex([el('spacing'), el('ind'), el('jc')], CT_PPR_SEQUENCE, 'tabs')).toBe(
      0
    );
    expect(schemaInsertIndex([el('pStyle'), el('spacing')], CT_PPR_SEQUENCE, 'tabs')).toBe(1);
  });

  test('an element the sequence does not model keeps its slot rather than ranking', () => {
    // Its position is not ours to decide, and moving it could reorder it past the very
    // child it was written to modify.
    expect(schemaInsertIndex([el('w14:glow'), el('spacing')], CT_PPR_SEQUENCE, 'tabs')).toBe(1);
  });

  test('an unmodelled name appends rather than claiming slot zero', () => {
    expect(schemaInsertIndex([el('pStyle')], CT_PPR_SEQUENCE, 'mc:AlternateContent')).toBe(1);
  });
});
