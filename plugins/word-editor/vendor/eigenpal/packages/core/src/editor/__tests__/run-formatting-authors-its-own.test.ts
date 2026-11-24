// A run property change states what the RUN authors, not what it inherits.
//
// The layout's span properties are the flattened cascade — `w:docDefaults` + the style chain
// + direct formatting — and the formatting lane used to merge the toggled property over that
// bag and send it back as one op across the whole range. Two things a user could see:
//
//  - Word's own `styles.xml` puts `w:lang` (and usually `w:noProof`) in
//    `docDefaults/rPrDefault` (17.7.5.3). Neither is in the D8 run vocabulary, so
//    `setRunProperties` refused the op outright and Bold did nothing at all, silently, on
//    every document Word had written.
//  - One op carried ONE run's properties across the whole range, so a mixed selection came
//    out homogenised: bolding two runs in different fonts gave both the first one's font.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const styles = (defaults: string) =>
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>${defaults}` +
  '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>';

/** `docDefaults` as Word writes them: two properties outside the op vocabulary. */
const WORD_STYLES = styles('<w:noProof/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/>');

/** The same defaults with nothing unauthorable, so the op is applied rather than refused. */
const PLAIN_STYLES = styles('');

function docx(body: string, stylesXml = WORD_STYLES): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(stylesXml),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function withSurface(
  body: string,
  run: (surface: PaginatedSurface) => void,
  stylesXml = WORD_STYLES
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body, stylesXml));
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

const paragraph = (runs: string) => `<w:p>${runs}</w:p>`;
const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

function firstParagraphNode(surface: PaginatedSurface): OoxmlNode {
  const node = surface.session.part().root;
  const found = findFirst(node, (candidate) => candidate.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

function findFirst(node: OoxmlNode, match: (node: OoxmlNode) => boolean): OoxmlNode | null {
  if (match(node)) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findFirst(child, match);
    if (found) return found;
  }
  return null;
}

/** Each top-level run's own `w:rPr`, as `name` or `name=val` per child, in authored order. */
function authoredRunProperties(surface: PaginatedSurface): string[][] {
  const result: string[][] = [];
  const target = firstParagraphNode(surface);
  if (target.kind === 'textValue') return result;
  for (const child of target.children) {
    if (child.kind !== 'run') continue;
    const rPr = child.children.find((grand) => grand.kind === 'runProperties');
    result.push(rPr && rPr.kind !== 'textValue' ? describeProperties(rPr) : []);
  }
  return result;
}

/** The paragraph mark's own `w:pPr/w:rPr`, in the same shape. */
function authoredMarkProperties(surface: PaginatedSurface): string[] {
  const target = firstParagraphNode(surface);
  if (target.kind === 'textValue') return [];
  const pPr = target.children.find((child) => child.kind === 'paragraphProperties');
  if (!pPr || pPr.kind === 'textValue') return [];
  const rPr = pPr.children.find((child) => child.kind !== 'textValue' && child.localName === 'rPr');
  return rPr && rPr.kind !== 'textValue' ? describeProperties(rPr) : [];
}

function describeProperties(container: OoxmlNode): string[] {
  if (container.kind === 'textValue') return [];
  return container.children.flatMap((child) => {
    if (child.kind === 'textValue') return [];
    const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
    return [val === undefined ? child.localName : `${child.localName}=${val}`];
  });
}

function selectAll(surface: PaginatedSurface, length: number): void {
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: length },
  });
}

describe('a run property change authors only what the run itself states', () => {
  test('bold works on a document whose docDefaults carry w:lang', () => {
    // The headline symptom: on a file Word wrote, pressing Bold changed nothing and
    // reported nothing, because the op restated `w:lang`/`w:noProof` from the cascade and
    // the store refused the whole transaction with `unsupported-property`.
    withSurface(paragraph(textRun('hello world')), (surface) => {
      selectAll(surface, 'hello world'.length);
      expect(surface.formatting().bold).toBe(false);
      surface.toggleRunProperty('b');
      expect(surface.formatting().bold).toBe(true);
      expect(authoredRunProperties(surface)).toEqual([['b']]);
    });
  });

  test('a mixed selection keeps each run its own font', () => {
    // Nothing unauthorable in these defaults, so the op reaches the tree and the second
    // failure shows on its own: one op carrying the FIRST run's bag across the range gave
    // the Georgia run Calibri.
    withSurface(
      paragraph(
        textRun('hello ') +
          textRun('Georgia', '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>')
      ),
      (surface) => {
        selectAll(surface, 'hello Georgia'.length);
        surface.toggleRunProperty('b');
        expect(authoredRunProperties(surface)).toEqual([['b'], ['rFonts', 'b']]);
        const fonts = surface
          .layout()
          .pages.flatMap((page) => page.fragments)
          .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
          .flatMap((line) => line.spans)
          .map((span) => span.style.fontFamily);
        expect(fonts).toEqual(['Calibri', 'Georgia']);
      },
      PLAIN_STYLES
    );
  });

  test('formatting part of a run leaves the rest of it alone', () => {
    withSurface(paragraph(textRun('hello world')), (surface) => {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 5 },
      });
      surface.toggleRunProperty('i');
      expect(authoredRunProperties(surface)).toEqual([['i'], []]);
    });
  });

  test('inherited formatting is not frozen into the run as direct formatting', () => {
    // The run states only its size; `w:rFonts` comes from `docDefaults`. Bolding must leave
    // the font inherited, or editing the style would stop moving this text.
    withSurface(
      paragraph(textRun('hello world', '<w:rPr><w:sz w:val="28"/></w:rPr>')),
      (surface) => {
        selectAll(surface, 'hello world'.length);
        surface.toggleRunProperty('b');
        expect(authoredRunProperties(surface)).toEqual([['b', 'sz=28']]);
      },
      PLAIN_STYLES
    );
  });

  test('the paragraph mark gets the intended property and nothing inherited', () => {
    withSurface(paragraph(textRun('hello world')), (surface) => {
      selectAll(surface, 'hello world'.length);
      surface.setRunProperty('sz', { val: '52' });
      expect(authoredMarkProperties(surface)).toEqual(['sz=52']);
    });
  });

  test('toggling off still states the off value rather than dropping the element', () => {
    withSurface(paragraph(textRun('hello world', '<w:rPr><w:b/></w:rPr>')), (surface) => {
      selectAll(surface, 'hello world'.length);
      expect(surface.formatting().bold).toBe(true);
      surface.toggleRunProperty('b');
      expect(authoredRunProperties(surface)).toEqual([['b=0']]);
      expect(surface.formatting().bold).toBe(false);
    });
  });
});
