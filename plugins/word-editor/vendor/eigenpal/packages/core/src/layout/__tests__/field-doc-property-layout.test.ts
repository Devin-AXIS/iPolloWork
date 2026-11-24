// Document-property fields (TITLE, AUTHOR, ...) resolve inside a full layout, not only at the
// piece level. Three surfaces are pinned here:
//   1. Body: `paragraphTextFromLayout` clamps a projected atom to its ONE model unit, so a
//      multi-character AUTHOR value never inflates Select All, the deletion range, or word motion.
//   2. Footnote: the value threads from the body layout options into the note story
//      (`inheritNotesLayoutInput`), so a note field is not painted blank.
//   3. Body-anchored text box: the value threads into the anchored story, so a field in a body or
//      table-cell text box is not painted blank.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type DocumentProperties,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  paragraphTextFromLayout,
  type SemanticLayout,
} from '../index.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const measurer = createFixedMeasurer(6, 14);

// A multi-character value over a single model unit: 12 painted characters, one atom.
const AUTHOR = 'Ada Lovelace';
const PROPS: DocumentProperties = Object.freeze({ creator: AUTHOR });

/** A complex AUTHOR field with no cached result: begin/instr/separate/end. */
const authorField =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText> AUTHOR </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function partOfBody(body: string, ns = `xmlns:w="${W}"`): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document ${ns}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layoutText(layout: SemanticLayout, paragraphId: string): string {
  return paragraphTextFromLayout(layout, paragraphId);
}

describe('body: paragraphTextFromLayout clamps a multi-character field atom to one model unit', () => {
  test('an AUTHOR atom contributes one unit, not its painted length', () => {
    // "A" then an AUTHOR field at the paragraph END = two model units, whatever the painted value.
    // The field is last on purpose: a trailing character would slice the reconstruction back and
    // mask an un-clamped overflow, so the atom must be the final piece to pin the clamp.
    const part = partOfBody(`<w:p><w:r><w:t>A</w:t></w:r>${authorField}</w:p>`);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'doc-prop-layout',
      documentProperties: PROPS,
    });

    // The atom paints the full value — it may split across spans (a space breaks the token), but
    // every projected span carries the SAME one-unit model range. Concatenation proves the
    // projection fired with the multi-character value.
    const spans = layout.pages
      .flatMap((page) => page.fragments)
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      .flatMap((line) => line.spans);
    const projected = spans.filter((span) => span.projected);
    expect(projected.length).toBeGreaterThan(0);
    expect(projected.map((span) => span.text).join('')).toBe(AUTHOR);
    for (const span of projected) expect(span.range.end - span.range.start).toBe(1);

    const paragraphId = projected[0]!.range.paragraphId;
    const text = layoutText(layout, paragraphId);
    // Model length is 2: "A" + one field unit. Reverting the clamp lets the 12-character painted
    // value through as the final piece, making this 5+ instead of 2.
    expect(text.length).toBe(2);
    expect(text[0]).toBe('A');
  });
});

/** Package with a footnote whose body carries an AUTHOR field and no cached result. */
function footnoteAuthorDoc(): Uint8Array {
  const body = `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p>${authorField}</w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

describe('footnote: an AUTHOR field resolves through inheritNotesLayoutInput', () => {
  test('the note story paints the property value, not a blank', () => {
    const loaded = readOoxmlPackage(footnoteAuthorDoc());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
    // The notes input pins NO document properties, so resolution proves body → notes threading.
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer,
      producer: 'doc-prop-note',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      notes,
      producer: 'doc-prop-note',
      documentProperties: PROPS,
    });
    const noteText = layout.pages
      .flatMap((page) => page.footnotes?.notes ?? [])
      .flatMap((note) => note.fragments)
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      .flatMap((line) => line.spans.map((span) => span.text))
      .join('');
    expect(noteText).toContain(AUTHOR);
  });
});

/** Anchored, page-positioned, wrap-none body text box carrying the given story content. */
function bodyTextboxDrawing(content: string): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"' +
    ' relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>1000000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>1000000</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2000000" cy="500000"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="TB"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="500000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

function drawingLayoutFor(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  const ready = mockReadyImageResource({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  });
  return {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => ready,
  };
}

describe('body text box: an AUTHOR field resolves through the anchored story (F2)', () => {
  test('the painted text box carries the property value, not a blank', () => {
    const ns = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;
    const part = partOfBody(
      `<w:p><w:r>${bodyTextboxDrawing(`<w:p>${authorField}</w:p>`)}</w:r></w:p>`,
      ns
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'doc-prop-textbox',
      documentProperties: PROPS,
      inlineDrawingLayout: drawingLayoutFor(part),
    });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const box = container.querySelector<HTMLElement>('.docx-drawing-textbox');
    expect(box).not.toBeNull();
    // Before the F2 fix the body text box omitted documentProperties, so this painted blank.
    expect(box!.textContent).toContain(AUTHOR);
  });
});
