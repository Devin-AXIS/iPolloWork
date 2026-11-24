// A paragraph edit writes the paragraph's OWN properties, never the cascade.
//
// The layout's property bag is `w:docDefaults` + the style chain + direct formatting
// flattened for rendering. Echoing it back into a `setParagraphProperties` op did two
// things a user can see:
//
// 1. The op was REFUSED outright whenever the cascade named anything outside the D8 op
//    vocabulary — `w:outlineLvl` (on every Heading), `w:contextualSpacing` (on Word's
//    List Paragraph). Pressing Centre on a heading did nothing at all.
// 2. What survived baked style-inherited values onto the paragraph as direct formatting,
//    so editing the style afterwards no longer moved the paragraph.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { directParagraphProperties } from '../surface-formatting.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Word's own Heading 1 and List Paragraph, trimmed to the properties that matter here. */
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259"/>' +
  '</w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/>' +
  '</w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/styles.xml': strToU8(STYLES),
  });
}

function mount(body: string): PaginatedSurface {
  // Detached on purpose: these tests address the MODEL, and a mounted container left in the
  // document keeps the shared browser selection alive for whatever test file runs next.
  const opened = mountPaginatedSurface(document.createElement('div'), docx(body), { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  const surface = opened.surface;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
  return surface;
}

/** The element names the first paragraph's OWN `w:pPr` holds, in authored order. */
function ownParagraphProperties(surface: PaginatedSurface): string[] {
  const paragraphId = surface.session.paragraphIds()[0]!;
  const found = (function find(node: {
    id?: string;
    kind: string;
    children?: readonly unknown[];
  }): { children?: readonly unknown[] } | null {
    if (node.kind === 'textValue') return null;
    if (node.id === paragraphId) return node;
    for (const child of (node.children ?? []) as never[]) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  })(surface.session.part().root as never);
  if (!found) throw new Error('paragraph not in the tree');
  const pPr = ((found.children ?? []) as { kind: string; localName?: string }[]).find(
    (child) => child.kind === 'paragraphProperties' || child.localName === 'pPr'
  ) as { children?: readonly { kind: string; localName?: string }[] } | undefined;
  return (pPr?.children ?? [])
    .filter((child) => child.kind !== 'textValue')
    .map((child) => child.localName ?? '');
}

const HEADING =
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>';

describe('a paragraph property press writes the paragraph, not its cascade', () => {
  test('pressing Centre on a Heading paragraph actually centres it', () => {
    const surface = mount(HEADING);
    const before = surface.session.revision();
    surface.setParagraphProperty('jc', { val: 'center' });
    expect(surface.session.revision()).toBeGreaterThan(before);
    expect(surface.formatting().alignment).toBe('center');
    expect(ownParagraphProperties(surface)).toContain('jc');
  });

  test('pressing Centre on a List Paragraph works — contextualSpacing is the style’s', () => {
    const surface = mount(
      '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t>item</w:t></w:r></w:p>'
    );
    surface.setParagraphProperty('jc', { val: 'center' });
    expect(surface.formatting().alignment).toBe('center');
  });

  test('style-inherited properties are not baked onto the paragraph', () => {
    const surface = mount(HEADING);
    surface.setParagraphProperty('jc', { val: 'center' });
    // `keepNext` and `spacing` belong to Heading 1 and to docDefaults. Restating them here
    // would freeze this paragraph against a later edit of the style.
    expect(ownParagraphProperties(surface).sort()).toEqual(['jc', 'pStyle']);
  });

  test('the paragraph keeps everything it DOES author', () => {
    const surface = mount(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/>' +
        '<w:numId w:val="3"/></w:numPr><w:pBdr><w:bottom w:val="single" w:sz="4"/></w:pBdr>' +
        '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs><w:ind w:left="360"/>' +
        '<w:rPr><w:i/></w:rPr></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>'
    );
    surface.setParagraphProperty('jc', { val: 'center' });
    const own = ownParagraphProperties(surface);
    for (const name of ['pStyle', 'numPr', 'pBdr', 'tabs', 'ind', 'rPr', 'jc']) {
      expect(own).toContain(name);
    }
    // Nested children survive the rewrite: the numbering identity, the tab stop, the mark.
    const xml = JSON.stringify(surface.session.part().root);
    expect(xml).toContain('numId');
    expect(xml).toContain('1440');
  });

  test('a w:pPr demoted to generic is still read as the paragraph’s own', () => {
    // The canonical read demotes a container its known-node invariant refuses, and Word's
    // own `w:rPr` + `w:sectPr` tail (CT_PPr order, 17.3.1.26) is one such shape. Matching
    // the typed kind alone would send an op with NO base and silently drop the paragraph's
    // style, numbering and indent on the next press.
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/>` +
        '<w:ind w:left="360"/><w:rPr><w:i/></w:rPr><w:sectPr/></w:pPr>' +
        '<w:r><w:t>Chapter one</w:t></w:r></w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const body = read.part.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    const demoted = {
      ...paragraph,
      children: paragraph.children.map((child) =>
        child.kind === 'paragraphProperties' ? ({ ...child, kind: 'generic' } as OoxmlNode) : child
      ),
    } as OoxmlElement;
    const part = {
      ...read.part,
      root: {
        ...read.part.root,
        children: [{ ...body, children: [demoted] } as OoxmlNode],
      } as OoxmlElement,
    };
    expect(
      directParagraphProperties(part, paragraph.id)
        .map((p) => p.localName)
        .sort()
    ).toEqual(['ind', 'pStyle']);
  });

  test('Increase Indent on a Heading indents it', () => {
    const surface = mount(HEADING);
    expect(surface.canAdjustIndent('increase')).toBe(true);
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(ownParagraphProperties(surface)).toContain('ind');
    expect(ownParagraphProperties(surface).sort()).toEqual(['ind', 'pStyle']);
  });
});

/** The first paragraph's own `w:ind` attributes, by local name. */
function ownIndent(surface: PaginatedSurface): Record<string, string> {
  const paragraphId = surface.session.paragraphIds()[0]!;
  const find = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.id === paragraphId) return node;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  const paragraph = find(surface.session.part().root);
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('paragraph not in the tree');
  const pPr = paragraph.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'pPr'
  );
  if (!pPr || pPr.kind === 'textValue') return {};
  const ind = pPr.children.find((child) => child.kind !== 'textValue' && child.localName === 'ind');
  if (!ind || ind.kind === 'textValue') return {};
  return Object.fromEntries(ind.attributes.map((entry) => [entry.localName, entry.value]));
}

describe('an indent step rewrites the spelling the paragraph already uses', () => {
  // `CT_Ind` carries the left indent under two names — `w:left` and the direction-relative
  // `w:start` (17.3.1.12) — and both may appear on one element. Writing `w:left` onto a
  // paragraph authored with `w:start` therefore did not restate the indent, it ADDED a
  // second, different one; nothing makes the two readers agree about which wins, and this
  // engine's own rule is `left ?? start`, so the paragraph moved here and not in Word.
  const startIndented = (twips: string) =>
    `<w:p><w:pPr><w:ind w:start="${twips}"/></w:pPr><w:r><w:t>hello</w:t></w:r></w:p>`;

  test('Increase Indent on a w:start paragraph states one indent, not two', () => {
    const surface = mount(startIndented('720'));
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(ownIndent(surface)).toEqual({ start: '1440' });
  });

  test('Decrease Indent on a w:start paragraph actually outdents it', () => {
    // The worse half: the outdent was written as `w:left="0"` beside an untouched
    // `w:start="720"`, so a reader honouring `w:start` saw no change at all.
    const surface = mount(startIndented('720'));
    expect(surface.adjustIndent('decrease')).toBe(true);
    expect(ownIndent(surface)).toEqual({ start: '0' });
  });

  test('a paragraph authoring BOTH spellings keeps them in step', () => {
    const surface = mount(
      '<w:p><w:pPr><w:ind w:start="720" w:left="720"/></w:pPr><w:r><w:t>hello</w:t></w:r></w:p>'
    );
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(ownIndent(surface)).toEqual({ start: '1440', left: '1440' });
  });

  test('a paragraph authoring neither still gets w:left, and keeps its hanging', () => {
    const surface = mount(
      '<w:p><w:pPr><w:ind w:hanging="360"/></w:pPr><w:r><w:t>hello</w:t></w:r></w:p>'
    );
    expect(surface.adjustIndent('increase')).toBe(true);
    expect(ownIndent(surface)).toEqual({ hanging: '360', left: '720' });
  });
});
