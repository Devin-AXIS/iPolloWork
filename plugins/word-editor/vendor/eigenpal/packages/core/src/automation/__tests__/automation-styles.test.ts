// Paragraph styles through the protocol: a style is named by its NAME, and only a name the
// document already defines can be applied.
//
// THE VOCABULARY IS THE DOCUMENT'S. Word's own object model names a style by the name a reader sees
// in the styles gallery (`heading 1`), not by the internal `w:styleId` (`Heading1`), and the two are
// routinely different. So both directions go through `styles.xml`: a read answers the name the part
// gives the id the paragraph states, and a write looks the name up and writes the id it belongs to.
//
// AN UNKNOWN NAME IS REFUSED, never minted. A host that created a style definition on demand would
// answer "applied" for a style with no formatting in it, and the paragraph would look unchanged
// while reading back as styled — the least useful possible outcome. It also makes an attacker-shaped
// name a new part rather than an error.
//
// READING A STRETCH IS AGREEMENT, same as formatting: every paragraph the span covers states the
// same style, or the answer is no agreed value.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  open,
  p,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>' +
  '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>';

/** A document with a real styles part, one styled paragraph and one that states nothing. */
const STYLED = docx(
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>heading</w:t></w:r></w:p>' +
    p('plain'),
  STYLES
);

/** No styles part at all. Legal, and nothing may pretend it defines names. */
const UNSTYLED = docx(p('alone'));

function styleOf(host: AutomationHost, paragraph: AutomationHandle): string | null {
  const response = host.execute({ operations: [{ op: 'getStyle', span: { paragraph } }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'style') {
    throw new Error(`expected a style: ${JSON.stringify(response.results[0])}`);
  }
  return result.value.name;
}

describe('reading a paragraph style', () => {
  test('answers the name the styles part gives the id the paragraph states', () => {
    // `heading 1`, not `Heading1`: the name is what a reader sees, and it is not the id.
    const host = open(STYLED);
    const [heading] = paragraphsOf(host, roots(host).body);
    expect(styleOf(host, heading!)).toBe('heading 1');
  });

  test('a paragraph that states no style answers the default the part declares', () => {
    const host = open(STYLED);
    const [, plain] = paragraphsOf(host, roots(host).body);
    expect(styleOf(host, plain!)).toBe('Normal');
  });

  test('a document with no styles part answers no name rather than inventing one', () => {
    const host = open(UNSTYLED);
    const [only] = paragraphsOf(host, roots(host).body);
    expect(styleOf(host, only!)).toBe(null);
  });

  test('a stretch whose paragraphs disagree answers no agreed value', () => {
    const host = open(STYLED);
    const body = roots(host).body;
    const response = host.execute({ operations: [{ op: 'getStyle', span: { body } }] });
    const result = response.results[0];
    if (result?.status !== 'ok' || result.value.kind !== 'style') throw new Error('no style');
    expect(result.value.name).toBe(null);
  });
});

describe('applying a paragraph style', () => {
  test('writes the id the name belongs to, and it survives save and reopen', () => {
    const host = open(STYLED);
    const [, plain] = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: plain! }, name: 'Quote' }],
    });
    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(savedMainXml(host)).toContain('<w:pStyle w:val="Quote"/>');

    const next = reopen(host);
    const [, again] = paragraphsOf(next.host, next.body);
    expect(styleOf(next.host, again!)).toBe('Quote');
  });

  test('a name is matched however it is cased, because a gallery name is not an identifier', () => {
    const host = open(STYLED);
    const [, plain] = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: plain! }, name: 'HEADING 1' }],
    });
    expect(response.ok).toBe(true);
    expect(savedMainXml(host)).toContain('<w:pStyle w:val="Heading1"/>');
  });

  test('applies to every paragraph a stretch covers', () => {
    const host = open(STYLED);
    const body = roots(host).body;
    const response = host.execute({
      operations: [{ op: 'setStyle', span: { body }, name: 'Quote' }],
    });
    expect(response.ok).toBe(true);
    const xml = savedMainXml(host);
    expect(xml.split('<w:pStyle w:val="Quote"/>')).toHaveLength(3);
  });

  test('a name the document does not define is refused rather than created', () => {
    const host = open(STYLED);
    const [, plain] = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: plain! }, name: 'Invented' }],
    });
    expect(refusal(response)).toBe('unsupported-content');
    expect(response.changed).toBe(false);
    expect(savedMainXml(host)).not.toContain('Invented');
  });

  test('a CHARACTER style is refused: it is not what a paragraph can be set to', () => {
    const host = open(STYLED);
    const [, plain] = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: plain! }, name: 'Emphasis' }],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('an attacker-shaped name is refused rather than templated into the part', () => {
    const host = open(STYLED);
    const [, plain] = paragraphsOf(host, roots(host).body);
    for (const name of ['"/><w:pStyle w:val="x', 'Quote\u0000', 'x'.repeat(600)]) {
      const response = host.execute({
        operations: [{ op: 'setStyle', span: { paragraph: plain! }, name }],
      });
      expect(refusal(response)).toBe('unsupported-content');
    }
    expect(savedMainXml(host)).not.toContain('w:val="x"');
  });

  test('applying a style keeps the paragraph properties nobody asked about', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="720"/></w:pPr>' +
          '<w:r><w:t>centred</w:t></w:r></w:p>',
        STYLES
      )
    );
    const [only] = paragraphsOf(host, roots(host).body);
    host.execute({ operations: [{ op: 'setStyle', span: { paragraph: only! }, name: 'Quote' }] });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:pStyle w:val="Quote"/>');
    expect(xml).toContain('w:val="center"');
    expect(xml).toContain('w:left="720"');
  });

  test('a style write and a paragraph-format write of one paragraph are refused as conflicting', () => {
    // Both rewrite the same `w:pPr`, each carrying what it read before the batch.
    const host = open(STYLED);
    const [, plain] = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [
        { op: 'setStyle', span: { paragraph: plain! }, name: 'Quote' },
        { op: 'setParagraphFormat', paragraph: { paragraph: plain! }, format: { leftIndent: 18 } },
      ],
    });
    expect(refusal(response)).toBe('conflicting-operations');
  });
});
