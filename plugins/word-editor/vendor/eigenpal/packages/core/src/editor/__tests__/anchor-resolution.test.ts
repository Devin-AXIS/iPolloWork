// DocAnchor resolution semantics (anchor-resolution.ts): paraId case-insensitive,
// `search` exactly-once (or explicit `occurrence`), spans in `paragraphTextOf`'s
// offset vocabulary — the same offsets the ops and the surface selection use.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildParagraphAnchorIndex } from '../../binding/paragraph-anchors.ts';
import { resolveAnchorSelection, resolveDocAnchor } from '../anchor-resolution.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// "one\ttwo two" — a tab pins the offset vocabulary: tabs count one offset each.
const PART = load(
  '<w:p w14:paraId="4C000001"><w:r><w:t>one</w:t><w:tab/><w:t>two two</w:t></w:r></w:p>' +
    '<w:p w14:paraId="4C000002"><w:r><w:t>second paragraph</w:t></w:r></w:p>'
);
const ANCHORS = buildParagraphAnchorIndex([PART]);
const [FIRST, SECOND] = [...ANCHORS.ordinalByNode.keys()];

describe('resolveDocAnchor', () => {
  test('no search spans the whole paragraph', () => {
    const resolved = resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001' });
    expect(resolved).toEqual({
      ok: true,
      span: { nodeId: FIRST!, start: 0, end: 'one\ttwo two'.length },
    });
  });

  test('paraId matches case-insensitively; unknown ids answer notFound', () => {
    const resolved = resolveDocAnchor(PART, ANCHORS, { paraId: '4c000001' });
    expect(resolved.ok).toBe(true);
    const missing = resolveDocAnchor(PART, ANCHORS, { paraId: '0BADF00D' });
    expect(missing).toMatchObject({ ok: false, code: 'notFound' });
  });

  test('a unique search resolves to its span, tab offsets included', () => {
    const resolved = resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001', search: 'one\ttwo' });
    expect(resolved).toEqual({ ok: true, span: { nodeId: FIRST!, start: 0, end: 7 } });
  });

  test('two matches without occurrence are ambiguous, never first-match', () => {
    const resolved = resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001', search: 'two' });
    expect(resolved).toMatchObject({ ok: false, code: 'ambiguous' });
  });

  test('occurrence disambiguates, 1-based; past-the-end answers notFound', () => {
    const second = resolveDocAnchor(PART, ANCHORS, {
      paraId: '4C000001',
      search: 'two',
      occurrence: 2,
    });
    expect(second).toEqual({ ok: true, span: { nodeId: FIRST!, start: 8, end: 11 } });
    expect(
      resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001', search: 'two', occurrence: 3 })
    ).toMatchObject({ ok: false, code: 'notFound' });
  });

  test('invalid arguments are named as such', () => {
    expect(resolveDocAnchor(PART, ANCHORS, { paraId: '' })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    expect(resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001', search: '' })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    expect(
      resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001', search: 'two', occurrence: 0 })
    ).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(
      resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001', search: 'two', occurrence: 1.5 })
    ).toMatchObject({ ok: false, code: 'invalidArgs' });
  });

  test('a missing search phrase answers notFound', () => {
    expect(resolveDocAnchor(PART, ANCHORS, { paraId: '4C000001', search: 'absent' })).toMatchObject(
      { ok: false, code: 'notFound' }
    );
  });
});

describe('resolveAnchorSelection', () => {
  test('{ anchor } collapses the caret at the span start', () => {
    const caret = resolveAnchorSelection(PART, ANCHORS, {
      anchor: { paraId: '4C000001', search: 'two', occurrence: 2 },
    });
    expect(caret).toEqual({
      ok: true,
      selection: {
        anchor: { paragraphId: FIRST!, offset: 8 },
        head: { paragraphId: FIRST!, offset: 8 },
      },
    });
  });

  test('a same-paraId range selects the whole paragraph; search endpoints select the phrase', () => {
    const whole = resolveAnchorSelection(PART, ANCHORS, {
      range: { from: { paraId: '4C000001' }, to: { paraId: '4C000001' } },
    });
    expect(whole).toEqual({
      ok: true,
      selection: {
        anchor: { paragraphId: FIRST!, offset: 0 },
        head: { paragraphId: FIRST!, offset: 'one\ttwo two'.length },
      },
    });
    const phrase = resolveAnchorSelection(PART, ANCHORS, {
      range: {
        from: { paraId: '4C000002', search: 'second' },
        to: { paraId: '4C000002', search: 'second' },
      },
    });
    expect(phrase).toEqual({
      ok: true,
      selection: {
        anchor: { paragraphId: SECOND!, offset: 0 },
        head: { paragraphId: SECOND!, offset: 6 },
      },
    });
  });

  test('a cross-paragraph range runs from-start to to-end', () => {
    const range = resolveAnchorSelection(PART, ANCHORS, {
      range: { from: { paraId: '4C000001' }, to: { paraId: '4C000002' } },
    });
    expect(range).toEqual({
      ok: true,
      selection: {
        anchor: { paragraphId: FIRST!, offset: 0 },
        head: { paragraphId: SECOND!, offset: 'second paragraph'.length },
      },
    });
  });

  test('the failing endpoint names itself as the target', () => {
    const result = resolveAnchorSelection(PART, ANCHORS, {
      range: { from: { paraId: '4C000001' }, to: { paraId: '0BADF00D' } },
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'notFound',
      target: { paraId: '0BADF00D' },
    });
  });

  test('DocLocation endpoints are refused as unsupported, not approximated', () => {
    const result = resolveAnchorSelection(PART, ANCHORS, {
      range: {
        from: { container: { part: 'body' }, path: [0] },
        to: { paraId: '4C000001' },
      },
    });
    expect(result).toMatchObject({ ok: false, code: 'unsupported' });
  });
});
