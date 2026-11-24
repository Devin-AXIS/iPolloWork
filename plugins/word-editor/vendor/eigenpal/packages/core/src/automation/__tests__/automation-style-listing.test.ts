// The `getStyles` read: every style `styles.xml` defines, cached on the styles part.
//
// A batch that lists styles several times (a load, a count, a lookup, a load per item) must not
// rebuild the listing per operation, and neither must an edit that leaves `styles.xml` alone. The
// listing is cached on the styles part root, so every such answer is the same frozen array.

import { describe, expect, test } from 'bun:test';
import { docx, open, p, paragraphsOf, roots } from './support/protocol.ts';
import type { AutomationStyleRead } from '../style-listing.ts';
import type { AutomationHost } from '../protocol.ts';
import type { AutomationOperation } from '../operations.ts';
import { MAX_STYLE_DEFINITIONS, buildStyleCascadeTable } from '../../layout/style-cascade.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { stylesPartOf } from '../../store/package/ooxml-indexes.ts';
import { styleDefinitionsOf } from '../style-definitions.ts';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:uiPriority w:val="0"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:styleId="QuoteChar"><w:name w:val="Quote"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
  // Duplicated children: the first one wins, as layout reads `w:basedOn`.
  '<w:basedOn w:val="Normal"/><w:basedOn w:val="Missing"/>' +
  // A next style the listing leaves out answers no name.
  '<w:next w:val="Nameless"/><w:semiHidden/><w:unhideWhenUsed w:val="true"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Nameless"/>' +
  // A next style of another kind, and a base style of another kind, answer no name.
  '<w:style w:type="paragraph" w:styleId="Probe"><w:name w:val="Probe"/>' +
  '<w:basedOn w:val="QuoteChar"/><w:next w:val="QuoteChar"/><w:uiPriority w:val="x"/></w:style>';

const STYLED = docx(p('first') + p('second'), STYLES);

function answers(
  host: AutomationHost,
  operations: readonly AutomationOperation[]
): (readonly AutomationStyleRead[])[] {
  const response = host.execute({ operations });
  return response.results.map((result) => {
    if (result.status !== 'ok' || result.value.kind !== 'styles')
      throw new Error(`expected styles: ${JSON.stringify(result)}`);
    return result.value.styles;
  });
}

const LIST: AutomationOperation = { op: 'getStyles' };

describe('getStyles', () => {
  test('keeps same-name styles of different kinds apart by id', () => {
    const [styles] = answers(open(STYLED), [LIST]);
    expect(styles!.map((style) => [style.id, style.name, style.type])).toEqual([
      ['Normal', 'Normal', 'paragraph'],
      ['QuoteChar', 'Quote', 'character'],
      ['Quote', 'Quote', 'paragraph'],
      ['Probe', 'Probe', 'paragraph'],
    ]);
  });

  test('resolves references only to listed styles of the allowed kind', () => {
    const [styles] = answers(open(STYLED), [LIST]);
    const byId = new Map(styles!.map((style) => [style.id, style]));
    expect(byId.get('Quote')!.basedOn).toBe('Normal');
    expect(byId.get('Quote')!.next).toBe(null);
    expect(byId.get('Normal')!.next).toBe('Normal');
    expect(byId.get('QuoteChar')!.next).toBe(null);
    expect(byId.get('Probe')!.basedOn).toBe(null);
    expect(byId.get('Probe')!.next).toBe(null);
  });

  test('reads visibility, priority, quick style, and unhide flags', () => {
    const [styles] = answers(open(STYLED), [LIST]);
    expect(
      styles!.map((style) => [
        style.id,
        style.hidden,
        style.uiPriority,
        style.quickStyle,
        style.unhideWhenUsed,
      ])
    ).toEqual([
      ['Normal', false, 0, true, false],
      ['QuoteChar', false, null, false, false],
      ['Quote', true, null, false, true],
      ['Probe', false, null, false, false],
    ]);
  });

  test('a name lookup prefers the paragraph style and compares like setStyle', () => {
    const host = open(STYLED);
    const [quote, missing] = answers(host, [
      { op: 'getStyles', name: '  QUOTE ' },
      { op: 'getStyles', name: 'Absent' },
    ]);
    expect(quote!.map((style) => style.id)).toEqual(['Quote']);
    expect(missing).toEqual([]);
  });

  test('narrower questions answer one entry or a count, not the listing', () => {
    const host = open(STYLED);
    const [byId, unknownId, tooLong] = answers(host, [
      { op: 'getStyles', id: 'QuoteChar' },
      { op: 'getStyles', id: 'Absent' },
      { op: 'getStyles', name: ` ${'Quote'.padEnd(300, ' ')}` },
    ]);
    expect(byId!.map((style) => [style.id, style.type])).toEqual([['QuoteChar', 'character']]);
    expect(unknownId).toEqual([]);
    // Longer than any style name may be, so nothing is folded or found.
    expect(tooLong).toEqual([]);

    const counted = host.execute({ operations: [{ op: 'getStyles', count: true }] });
    expect(counted.results[0]).toEqual({ status: 'ok', value: { kind: 'number', value: 4 } });

    const both = host.execute({ operations: [{ op: 'getStyles', id: 'Quote', name: 'Quote' }] });
    expect(both.ok).toBe(false);
    expect(both.results[0]).toMatchObject({
      status: 'error',
      error: { code: 'unsupported-content' },
    });
  });

  test('answers one listing, shared across operations, batches, and body edits', () => {
    const host = open(STYLED);
    const [first, second, third] = answers(host, [LIST, LIST, LIST]);
    expect(second).toBe(first!);
    expect(third).toBe(first!);
    expect(answers(host, [LIST])[0]).toBe(first!);

    const [paragraph] = paragraphsOf(host, roots(host).body);
    const written = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: paragraph! }, name: 'Quote' }],
    });
    expect(written.ok).toBe(true);
    // The edit changed the body, not `styles.xml`, so the listing is reused.
    expect(answers(host, [LIST])[0]).toBe(first!);
  });

  test('counts only the definitions layout counts', () => {
    const over = MAX_STYLE_DEFINITIONS + 4;
    let styles = '';
    for (let index = 0; index < over; index += 1)
      styles += `<w:style w:type="paragraph" w:styleId="S${index}"><w:name w:val="S${index}"/></w:style>`;
    const host = open(docx(p('one'), styles));
    const [listing] = answers(host, [LIST]);
    expect(listing!.length).toBe(MAX_STYLE_DEFINITIONS);
    expect(listing!.at(-1)!.name).toBe(`S${MAX_STYLE_DEFINITIONS - 1}`);

    // The setter index has the same bound: a style past it is not one a write may apply.
    const [paragraph] = paragraphsOf(host, roots(host).body);
    const refused = host.execute({
      operations: [
        { op: 'setStyle', span: { paragraph: paragraph! }, name: `S${MAX_STYLE_DEFINITIONS}` },
      ],
    });
    expect(refused.ok).toBe(false);
    const applied = host.execute({
      operations: [
        { op: 'setStyle', span: { paragraph: paragraph! }, name: `S${MAX_STYLE_DEFINITIONS - 1}` },
      ],
    });
    expect(applied.ok).toBe(true);
  });

  test('links only a paragraph style with a character style', () => {
    const host = open(
      docx(
        p('one'),
        '<w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/><w:link w:val="H1Char"/></w:style>' +
          '<w:style w:type="character" w:styleId="H1Char"><w:name w:val="Heading 1 Char"/><w:link w:val="H1"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Same"><w:name w:val="Same"/><w:link w:val="H1"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Self"><w:name w:val="Self"/><w:link w:val="Self"/></w:style>' +
          '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/><w:link w:val="H1Char"/></w:style>'
      )
    );
    const [styles] = answers(host, [LIST]);
    expect(styles!.map((style) => [style.id, style.linked])).toEqual([
      ['H1', true],
      ['H1Char', true],
      ['Same', false],
      ['Self', false],
      ['Grid', false],
    ]);
  });

  test('a repeated style id resolves to its last definition, as layout resolves it', () => {
    const host = open(
      docx(
        p('one'),
        '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Dup"><w:name w:val="Dup Paragraph"/></w:style>' +
          '<w:style w:type="character" w:styleId="Dup"><w:name w:val="Dup Character"/></w:style>'
      )
    );
    const [styles] = answers(host, [LIST]);
    expect(styles!.map((style) => [style.id, style.name, style.type])).toEqual([
      ['Normal', 'Normal', 'paragraph'],
      ['Dup', 'Dup Character', 'character'],
    ]);
    const [paragraph] = paragraphsOf(host, roots(host).body);
    // The paragraph definition lost its id, so the setter no longer knows its name.
    const refusedWrite = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: paragraph! }, name: 'Dup Paragraph' }],
    });
    expect(refusedWrite.ok).toBe(false);
  });

  test('keeps the default paragraph style when a later duplicate id has another type, as layout does', () => {
    const opened = readOoxmlPackage(
      docx(
        p('one'),
        '<w:style w:type="paragraph" w:styleId="Body" w:default="1"><w:name w:val="Body"/></w:style>' +
          '<w:style w:type="character" w:styleId="Body"><w:name w:val="Body Character"/></w:style>'
      )
    );
    if (!opened.ok) throw new Error('package did not open');
    const part = stylesPartOf(opened.package)!;
    const layout = buildStyleCascadeTable(part.root);
    expect(layout.defaultParagraphStyleId).toBe('Body');
    expect(styleDefinitionsOf(part).defaultParagraphId).toBe(layout.defaultParagraphStyleId);
  });
});
