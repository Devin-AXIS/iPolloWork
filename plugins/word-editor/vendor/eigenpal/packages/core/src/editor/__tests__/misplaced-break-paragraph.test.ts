// A `w:br` or `w:cr` written directly under a paragraph or a hyperlink, outside any run.
//
// The schema only admits both inside a run (`EG_RunInnerContent`). Typed as a hard break
// there, the stray element failed its container's content check and demoted the WHOLE
// paragraph to generic, which layout drops — so every run beside it stopped painting and
// could no longer be edited. The misplaced element is the thing that stays generic: it
// round-trips verbatim at its position, while the paragraph around it stays typed. The
// stray element does not paint a line break; that is outside the typed contract.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { linesOf } from '../../layout/index.ts';
import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  readOoxmlPackage,
  semanticDigest,
} from '../../store/index.ts';
import type { OoxmlElement, OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const LINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${LINK}" Target="https://example.com/" TargetMode="External"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
/** Two runs around a direct break, then an ordinary paragraph as the control. */
const DIRECT_BREAK = `<w:p>${run('Alpha')}<w:br w:type="textWrapping" w:clear="all"/>${run('Beta')}</w:p><w:p>${run('Gamma')}</w:p>`;
const DIRECT_CR = `<w:p>${run('Alpha')}<w:cr/>${run('Beta')}</w:p>`;
const BREAK_BEFORE_LINK = `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run('Alpha')}<w:br/><w:hyperlink r:id="rId7">${run('Beta')}</w:hyperlink></w:p>`;
const BREAK_IN_LINK = `<w:p>${run('Alpha')}<w:hyperlink r:id="rId7">${run('Beta')}<w:br/>${run('Delta')}</w:hyperlink></w:p>`;
const RUN_BREAK = `<w:p><w:r><w:t>Alpha</w:t><w:br/><w:t>Beta</w:t></w:r></w:p>`;

function mount(bytes: Uint8Array): PaginatedSurface {
  const result = mountPaginatedSurface(document.createElement('div'), bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.surface;
}

function mainPart(bytes: Uint8Array) {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.package.parts.get(read.package.mainDocumentPart)!;
}

function elements(node: OoxmlNode, out: OoxmlElement[] = []): OoxmlElement[] {
  if (node.kind === 'textValue') return out;
  out.push(node);
  for (const child of node.children) elements(child, out);
  return out;
}

function kindsByName(bytes: Uint8Array, localName: string): string[] {
  return elements(mainPart(bytes).root)
    .filter((node) => node.localName === localName)
    .map((node) => node.kind);
}

/** The text every painted span of the first paragraph carries, in paint order. */
function paintedText(surface: PaginatedSurface, paragraphIndex = 0): string {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  const text = paragraphTextOf(surface.session.part(), paragraphId) ?? '';
  return linesOf(surface.layout())
    .filter((line) => line.range.paragraphId === paragraphId)
    .flatMap((line) => line.spans)
    .map((span) => text.slice(span.range.start, span.range.end))
    .join('');
}

/**
 * Element names, attributes sorted by name, and exact text of the body. Ignores the paragraph
 * ids a session mints at open, attribute order, and `xml:space`, which serialization re-derives
 * from the text; the text values themselves must match exactly.
 */
function structure(node: OoxmlNode): unknown {
  if (node.kind === 'textValue') return node.value;
  const attributes = node.attributes
    .filter((attribute) => !['paraId', 'textId', 'space'].includes(attribute.localName))
    .map((attribute) => `${attribute.localName}=${attribute.value}`)
    .sort();
  return [node.localName, attributes, node.children.map(structure)];
}

describe('a break outside a run stays generic and keeps its paragraph typed', () => {
  test('a direct `w:br` or `w:cr` is generic; the paragraph and its runs stay typed', () => {
    expect(kindsByName(docx(DIRECT_BREAK), 'p')).toEqual(['paragraph', 'paragraph']);
    expect(kindsByName(docx(DIRECT_BREAK), 'br')).toEqual(['generic']);
    expect(kindsByName(docx(DIRECT_BREAK), 'r')).toEqual(['run', 'run', 'run']);
    expect(kindsByName(docx(DIRECT_CR), 'p')).toEqual(['paragraph']);
    expect(kindsByName(docx(DIRECT_CR), 'cr')).toEqual(['generic']);
  });

  test('a direct `w:br` inside a hyperlink keeps the link and its paragraph typed', () => {
    expect(kindsByName(docx(BREAK_IN_LINK), 'p')).toEqual(['paragraph']);
    expect(kindsByName(docx(BREAK_IN_LINK), 'hyperlink')).toEqual(['hyperlink']);
    expect(kindsByName(docx(BREAK_IN_LINK), 'br')).toEqual(['generic']);
  });

  test('a `w:br` inside a run is still a typed hard break', () => {
    expect(kindsByName(docx(RUN_BREAK), 'br')).toEqual(['hardBreak']);
    expect(mount(docx(RUN_BREAK)).session.bodyText()).toContain('Alpha\nBeta');
  });

  test('the runs on both sides of the stray break lay out and paint', () => {
    const surface = mount(docx(DIRECT_BREAK));
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(paintedText(surface)).toBe('AlphaBeta');
    expect(paintedText(surface, 1)).toBe('Gamma');

    const linked = mount(docx(BREAK_BEFORE_LINK));
    expect(paintedText(linked)).toBe('AlphaBeta');
    expect(paintedText(mount(docx(BREAK_IN_LINK)))).toBe('AlphaBetaDelta');
  });

  test('save and reopen keep the stray break verbatim, in place, with both D9 oracles equal', () => {
    for (const body of [DIRECT_BREAK, DIRECT_CR, BREAK_BEFORE_LINK, BREAK_IN_LINK]) {
      const source = docx(body);
      const surface = mount(source);
      // The session mints paragraph ids at open, so the oracles compare the opened part.
      const before = surface.session.part();
      const after = mainPart(surface.session.save());
      expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(before));
      expect(diffSemanticDigests(semanticDigest([before]), semanticDigest([after]))).toEqual([]);
      // Independently of the oracles: the authored structure and text come back unchanged.
      expect(structure(after.root)).toEqual(structure(mainPart(source).root));
    }
  });

  test('an edit next to the stray break commits, undoes, and survives save and reopen', () => {
    const surface = mount(docx(DIRECT_BREAK));
    const paragraphId = surface.session.paragraphIds()[0]!;
    const original = surface.session.bodyText();
    surface.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 5 },
    });
    surface.type('X');
    expect(paintedText(surface)).toBe('AlphaXBeta');
    expect(surface.state().selection.head).toEqual({ paragraphId, offset: 6 });

    const reopened = mount(surface.session.save());
    expect(paintedText(reopened)).toBe('AlphaXBeta');
    expect(structure(mainPart(reopened.session.save()).root)).toEqual(
      structure(mainPart(docx(DIRECT_BREAK.replace('Alpha<', 'AlphaX<'))).root)
    );

    surface.session.undo();
    expect(surface.session.bodyText()).toBe(original);
    expect(paintedText(surface)).toBe('AlphaBeta');
  });

  // The documented boundary: only `w:br`/`w:cr` are handled. Other run content outside a run
  // still makes its paragraph unknown content, which is kept on save with its text.
  test('other run content outside a run is kept on save with its text', () => {
    for (const stray of ['<w:tab/>', '<w:t>Delta</w:t>']) {
      const source = docx(
        `<w:p>${run('Alpha')}${stray}${run('Beta')}</w:p><w:p>${run('Gamma')}</w:p>`
      );
      const saved = mount(source).session.save();
      expect(structure(mainPart(saved).root)).toEqual(structure(mainPart(source).root));
    }
  });

  // Run content with no typed kind already stays generic in place outside a run, so its
  // paragraph renders. The public note names only the typed elements that still demote.
  test('untyped run content outside a run stays generic and its paragraph renders', () => {
    for (const stray of [
      '<w:sym w:font="Symbol" w:char="F0B7"/>',
      '<w:softHyphen/>',
      '<w:noBreakHyphen/>',
    ]) {
      const source = docx(`<w:p>${run('Alpha')}${stray}${run('Beta')}</w:p>`);
      expect(kindsByName(source, 'p')).toEqual(['paragraph']);
      const surface = mount(source);
      expect(paintedText(surface)).toBe('AlphaBeta');
      expect(structure(mainPart(surface.session.save()).root)).toEqual(
        structure(mainPart(source).root)
      );
    }
  });

  test('the stray break takes no text offset, so the caret walks straight across it', () => {
    const surface = mount(docx(DIRECT_BREAK));
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 4 },
    });
    const offsets: number[] = [];
    for (let step = 0; step < 3; step += 1) {
      surface.navigate('right');
      offsets.push(surface.state().selection.head.offset);
    }
    expect(offsets).toEqual([5, 6, 7]);
    surface.navigate('lineEnd');
    expect(surface.state().selection.head).toEqual({ paragraphId, offset: 9 });
  });

  test('a delete across the stray break removes the text and keeps the break', () => {
    const surface = mount(docx(DIRECT_BREAK));
    const paragraphId = surface.session.paragraphIds()[0]!;
    const result = surface.session.applyTreeOps([
      { op: 'deleteText', paragraphId, start: 4, end: 6 },
    ]);
    expect(result.committed).toBe(true);
    expect(paintedText(surface)).toBe('Alpheta');
    expect(kindsByName(surface.session.save(), 'br')).toEqual(['generic']);
  });
});
