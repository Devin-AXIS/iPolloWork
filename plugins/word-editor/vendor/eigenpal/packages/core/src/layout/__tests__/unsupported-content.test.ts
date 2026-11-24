import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
  type HeadlessDocumentView,
} from '@docx-editor.dev/core/store';
import { createUnsupportedContentProjector } from '../unsupported-content.ts';
import type { UnsupportedElement } from '../unsupported-content-types.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { documentOrder } from '../document-order.ts';
import { caretStops } from '../semantic-interaction.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { PendingLine } from '../pending-line.ts';
import { storyBlocks, noteStoryBlocks } from '../story-roots.ts';

function load(body: string, root = 'document'): OoxmlPart {
  const content = root === 'document' ? `<w:body>${body}</w:body>` : body;
  const result = readOoxmlPart(
    `<w:${root} xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:custom">${content}</w:${root}>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const measurer = createFixedMeasurer(6, 14);
const dimensions = { width: 40, height: 30 };
const spans = (part: OoxmlPart) =>
  linesOf(layoutSemanticDocument(part, 1, { measurer })).flatMap((line) => line.spans);

describe('opaque unsupported content layout projection', () => {
  test('custom run and paragraph content reserves geometry without moving canonical offsets', () => {
    const source = load(
      '<w:p><w:r><w:t>A</w:t><x:chip/></w:r><x:badge/><w:r><w:t>Z</w:t></w:r></w:p>'
    );
    const before = canonicalOoxmlFingerprint(source);
    const seen: UnsupportedElement[] = [];
    const projector = createUnsupportedContentProjector((element) => {
      seen.push(element);
      return dimensions;
    });
    const projected = projector.part(source);
    const result = spans(projected);
    expect(result.map((span) => [span.text, span.range.start, span.range.end])).toEqual([
      ['A', 0, 1],
      ['\uFFFC', 1, 1],
      ['\uFFFC', 1, 1],
      ['Z', 1, 2],
    ]);
    expect(result.filter((span) => span.unsupported).map((span) => span.box.width)).toEqual([
      40, 40,
    ]);
    expect(result.filter((span) => span.unsupported).map((span) => span.box.height)).toEqual([
      30, 30,
    ]);
    expect(seen.map((element) => element.localName)).toEqual(['chip', 'badge']);
    expect(seen[0]!.source).toBeDefined();
    expect(canonicalOoxmlFingerprint(source)).toEqual(before);
    expect(serializeOoxmlPart(projected)).toEqual(serializeOoxmlPart(source));
    expect(projector.part(source)).toBe(projected);
    const second = createUnsupportedContentProjector(() => ({ ...dimensions, width: 80 })).part(
      source
    );
    expect(spans(second).find((span) => span.unsupported)!.box.width).toBe(80);
  });

  test('opaque body blocks and cell blocks use read-only synthetic paragraphs', () => {
    const source = load(
      '<x:panel/><w:p><w:r><w:t>After</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><x:widget/><w:p/></w:tc></w:tr></w:tbl>'
    );
    const projected = createUnsupportedContentProjector(() => ({
      width: 80,
      height: 45,
    })).part(source);
    const result = spans(projected).filter((span) => span.unsupported);
    expect(result.map((span) => span.unsupported!.element.localName)).toEqual(['panel', 'widget']);
    expect(result.every((span) => span.range.start === span.range.end)).toBe(true);
    expect(result.every((span) => span.box.height === 45)).toBe(true);
    // The two blocks, then the empty paragraph the body reads after its final table.
    expect(storyBlocks(source).length).toBe(3);
    expect(storyBlocks(projected).length).toBe(4);
  });

  test('the shared walker supports header and note content slots', () => {
    const projector = createUnsupportedContentProjector(() => ({
      width: 80,
      height: 45,
    }));
    const header = projector.part(load('<x:headerCard/>', 'hdr'));
    expect(storyBlocks(header).length).toBe(1);
    expect(
      piecesOfParagraph(storyBlocks(header)[0]!).find((piece) => piece.unsupported)?.unsupported
        ?.element.localName
    ).toBe('headerCard');
    const notes = projector.part(
      load('<w:footnote w:id="1"><x:noteCard/></w:footnote>', 'footnotes')
    );
    expect(noteStoryBlocks(notes.root.children[0]!).length).toBe(1);
  });

  test('properties, structural markers, and supported symbols are not offered', () => {
    const source = load(
      '<w:sectPr/><w:p><w:pPr><x:property/></w:pPr><w:bookmarkStart w:id="1" w:name="A"/><w:r><w:rPr><x:style/></w:rPr><w:sym w:font="Symbol" w:char="F061"/></w:r></w:p>'
    );
    const seen: string[] = [];
    const projected = createUnsupportedContentProjector((element) => {
      seen.push(element.localName);
      return dimensions;
    }).part(source);
    expect(seen).toEqual([]);
    expect(projected).toBe(source);
  });

  test('geometry changes invalidate reused paragraph breaks', () => {
    const source = load('<w:p><x:chip/></w:p>');
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const first = createUnsupportedContentProjector(() => dimensions).part(source);
    const second = createUnsupportedContentProjector(() => ({ ...dimensions, width: 80 })).part(
      source
    );
    const firstLayout = layoutSemanticDocument(first, 1, { measurer, cache });
    const secondLayout = layoutSemanticDocument(second, 1, { measurer, cache });
    expect(linesOf(firstLayout)[0]!.spans[0]!.box.width).toBe(40);
    expect(linesOf(secondLayout)[0]!.spans[0]!.box.width).toBe(80);
  });

  test('opaque blocks never expose synthetic editable caret positions', () => {
    const source = load('<x:panel/><w:p><w:r><w:t>After</w:t></w:r></w:p>');
    const projected = createUnsupportedContentProjector(() => ({
      width: 80,
      height: 45,
    })).part(source);
    const layout = layoutSemanticDocument(projected, 1, { measurer });
    const opaque = spans(projected).find((span) => span.unsupported)!.unsupported!.element.nodeId;
    expect(documentOrder(layout)).not.toContain(opaque);
    expect(caretStops(layout).some((stop) => stop.position.paragraphId === opaque)).toBe(false);
  });

  test('content control wrappers keep opaque blocks in their flow', () => {
    const source = load(
      '<w:sdt><w:sdtPr/><w:sdtContent><x:panel/><w:p><x:chip/></w:p></w:sdtContent></w:sdt>'
    );
    const projected = createUnsupportedContentProjector(() => dimensions).part(source);
    expect(
      spans(projected)
        .filter((span) => span.unsupported)
        .map((span) => span.unsupported!.element.localName)
    ).toEqual(['panel', 'chip']);
  });

  test('opaque blocks stop tracked paragraph-mark merge groups', () => {
    const source = load(
      '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr><w:r><w:t>Before</w:t></w:r></w:p><x:panel/><w:p><w:r><w:t>After</w:t></w:r></w:p>'
    );
    const projected = createUnsupportedContentProjector(() => dimensions).part(source);
    const blocks = storyBlocks(projected, 'proposed');
    expect(blocks).toHaveLength(3);
    const opaque = blocks[1]!;
    expect(piecesOfParagraph(opaque).every((piece) => piece.unsupported !== undefined)).toBe(true);
    expect(
      piecesOfParagraph(blocks[0]!)
        .map((piece) => piece.text)
        .join('')
    ).toBe('Before');
  });

  test('projected views preserve new capabilities and frozen canonical receivers', () => {
    const source = load('<w:p><x:chip/></w:p>');
    const canonical = Object.freeze({
      part: () => source,
      readFutureCapability() {
        return this === canonical ? 'canonical receiver' : 'wrong receiver';
      },
    });
    const projected = createUnsupportedContentProjector(() => dimensions).view(
      canonical as unknown as HeadlessDocumentView
    );
    expect(projected.part()).not.toBe(source);
    expect((projected as unknown as typeof canonical).readFutureCapability()).toBe(
      'canonical receiver'
    );
    expect(canonical.part()).toBe(source);
  });

  test('unmatched and invalid dimensions preserve invisible content', () => {
    const source = load('<x:panel/><w:p><x:chip/></w:p>');
    expect(createUnsupportedContentProjector(() => null).part(source)).toBe(source);
    expect(
      createUnsupportedContentProjector(() => ({ ...dimensions, width: NaN })).part(source)
    ).toBe(source);
    expect(
      createUnsupportedContentProjector(() => ({ ...dimensions, height: -1 })).part(source)
    ).toBe(source);
  });
});
