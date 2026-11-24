// The store and layout agree on where every offset is — checked over real documents.
//
// This is the invariant three separate bugs violated in three different places, which is what
// makes it worth stating once instead of fixing again: a painted span's TEXT LENGTH is not its
// MODEL RANGE. A field occupies one offset and paints its whole cached result, so "Scope of the
// discussions" is twenty-four glyphs over a range of one.
//
// Every consumer that quietly assumed the two were the same broke differently:
//
//   - the paragraph offset walk counted a struck field result twice, so the paragraph measured
//     longer than anything laid out from it and the caret and the keystroke landed at different
//     offsets — click here, type there;
//   - the DOM selection mapper derived an endpoint as `start + textContent.length`, handing back
//     an offset the paragraph does not have, so a caret just after a field could not type;
//   - the composition readback joined the painted text and diffed it against the model, and
//     explained the difference by deleting the field and inserting its own rendering.
//
// None of those were reachable from hand-written XML that nobody thought to write. So the check
// runs over the fixture corpus and states the property directly: what the store says a paragraph
// is worth, layout must lay out — exactly, with no gap and no overlap.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  paragraphTextOf,
  readOoxmlPart,
  readOoxmlPackage,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { storyBlocks } from '../story-roots.ts';

import { PERFORMANCE_FIXTURE_BASENAMES } from '../../__tests__/performance-fixture-registry.ts';

const FIXTURES = resolve(import.meta.dir, '../../../../../e2e/fixtures');
const NON_CORPUS_FIXTURES = PERFORMANCE_FIXTURE_BASENAMES;

interface OffsetDefect {
  readonly fixture: string;
  readonly part: string;
  readonly detail: string;
}

/**
 * Whether the paragraph holds an atom that occupies a model offset but emits no piece unless
 * the caller supplies the context that renders it — a drawing, or a note reference.
 *
 * Document layout passes those; this per-paragraph harness cannot. Their shortfall is the
 * harness's own, so the exact-coverage arm steps around such paragraphs instead of being
 * loosened for everyone.
 */
function holdsUnrenderedAtom(paragraph: OoxmlNode): boolean {
  const seen = (node: OoxmlNode, depth: number): boolean => {
    if (node.kind === 'textValue' || depth > 24) return false;
    for (const child of node.children ?? []) {
      if (child.kind === 'textValue') continue;
      if (
        child.kind === 'drawing' ||
        child.kind === 'noteReference' ||
        child.kind === 'noteRef' ||
        child.kind === 'separator' ||
        child.kind === 'continuationSeparator' ||
        // `mc:AlternateContent` at run level takes the same one-offset-no-piece path.
        child.localName === 'AlternateContent' ||
        child.localName === 'object' ||
        child.localName === 'pict'
      ) {
        return true;
      }
      if (seen(child, depth + 1)) return true;
    }
    return false;
  };
  return seen(paragraph, 0);
}

function defectsIn(fixture: string): OffsetDefect[] {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(resolve(FIXTURES, fixture))));
  if (!pkg.ok) return [];
  const defects: OffsetDefect[] = [];
  for (const [part, content] of pkg.package.parts as Map<string, OoxmlPart>) {
    if (!part.endsWith('.xml')) continue;
    for (const block of storyBlocks(content, 'all-markup')) {
      if (block.kind !== 'paragraph') continue;
      const model = paragraphTextOf(content, (block as { id: string }).id);
      if (model === null) continue;
      const pieces = piecesOfParagraph(
        block as OoxmlNode,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        'all-markup'
      );
      const add = (detail: string): void => defects.push({ fixture, part, detail });

      // 1. No span may claim an offset the paragraph does not have. Always checkable, and the
      //    direction that puts an edit outside the text entirely.
      const laidOut = pieces.length === 0 ? 0 : pieces[pieces.length - 1]!.end;
      if (laidOut > model.length) {
        add(`paragraph is ${model.length} long, layout reaches ${laidOut}`);
      }

      // 2. Ranges must not overlap: an offset two spans both claim is one they will disagree
      //    about, and which of them a gesture resolves to is then a DOM-order accident.
      for (let index = 1; index < pieces.length; index += 1) {
        const previous = pieces[index - 1]!;
        const current = pieces[index]!;
        if (current.start < previous.end) {
          add(`ranges overlap at ${current.start} (previous ended ${previous.end})`);
          break;
        }
      }

      // 3. Layout must reach the END of the paragraph — the direction that displaced the caret
      //    and left it typing somewhere else.
      //
      //    Only assertable where every atom emits a piece. A drawing and a note reference each
      //    occupy one offset and emit NOTHING without the context that renders them, which the
      //    document-wide layout supplies and this per-paragraph harness does not. Their absence
      //    is the harness's, not the engine's, so paragraphs holding one are skipped here
      //    rather than counted as defects and quietly taught to be ignored.
      if (!holdsUnrenderedAtom(block as OoxmlNode) && laidOut < model.length) {
        add(`paragraph is ${model.length} long, layout covers ${laidOut}`);
      }

      // 3. A span that is NOT layout-owned must be 1:1 with its range. Where it is not, every
      //    consumer deriving an offset from its text is wrong — and `projected` is the marker
      //    paint puts on the DOM (`data-docx-field`) for the ones that are allowed to differ.
      for (const piece of pieces) {
        if (piece.projected) continue;
        if (piece.positionalTab) continue;
        if (piece.text.length !== piece.end - piece.start) {
          add(
            `unprojected span ${JSON.stringify(piece.text.slice(0, 24))} is ` +
              `${piece.text.length} chars over a range of ${piece.end - piece.start}`
          );
          break;
        }
      }
    }
  }
  return defects;
}

/**
 * Paragraphs that still disagree, all of them CONTENT CONTROLS and all off by one.
 *
 * A ceiling rather than a clean zero, because this is a second instance of the same class in a
 * subsystem this change does not touch: an inline `w:sdt` accounts for an offset differently in
 * the two walks. It is pre-existing and identical to the count at the base commit — the point of
 * pinning it is that it cannot GROW, so the next `w:sdt` walk to drift is caught the way the
 * three field bugs were not.
 *
 * Concentrated in `sdt-custom-node-databinding*.docx` (7 body + 3 footer paragraphs each),
 * `comprehensive-word-element-test.docx` (7), and single paragraphs in a few headers. Lowering
 * this number is a content-control change and wants its own proposal; raising it is a
 * regression.
 */
const KNOWN_CONTENT_CONTROL_DISAGREEMENTS = 31;

describe('paragraph offset coverage', () => {
  test('inline run wrappers paint their text in reading order over the model range', () => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        '<w:body><w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
        '<w:smartTag><w:r><w:t>smart</w:t></w:r></w:smartTag>' +
        '<w:customXml><w:r><w:t>custom</w:t></w:r></w:customXml>' +
        '<w:dir w:val="rtl"><w:r><w:rPr>' +
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun"/>' +
        '</w:rPr><w:t>A漢B</w:t></w:r></w:dir>' +
        '<w:bdo w:val="rtl"><w:r><w:t>abc</w:t></w:r></w:bdo>' +
        '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun"/>' +
        '</w:rPr><w:t>C字D</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const paragraph = storyBlocks(result.part, 'all-markup').find(
      (block) => block.kind === 'paragraph'
    );
    if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('no paragraph');
    const model = paragraphTextOf(result.part, paragraph.id);
    const pieces = piecesOfParagraph(paragraph, [], undefined, undefined, undefined, undefined);

    expect(model).toBe('before smartcustomA漢BabcC字D after');
    expect(pieces.map((piece) => piece.text).join('')).toBe(model);
    expect(pieces[pieces.length - 1]?.end).toBe(model?.length);
    expect(
      pieces.filter((piece) => piece.fontSlot === 'eastAsia').map((piece) => piece.text)
    ).toEqual(['漢', '字']);
  });

  test('what the store says a paragraph is worth, layout lays out — across the corpus', () => {
    const fixtures = readdirSync(FIXTURES).filter(
      (name) => name.endsWith('.docx') && !NON_CORPUS_FIXTURES.has(name)
    );
    // An oracle that reads no corpus passes by finding nothing, which is the one way it lies.
    expect(fixtures.length).toBeGreaterThan(50);

    const defects = fixtures.flatMap(defectsIn);
    if (defects.length > KNOWN_CONTENT_CONTROL_DISAGREEMENTS) {
      throw new Error(
        `${defects.length} paragraph(s) where the store and layout disagree, above the known ` +
          `${KNOWN_CONTENT_CONTROL_DISAGREEMENTS}:\n\n` +
          defects
            .slice(0, 40)
            .map((defect) => `  ${defect.fixture} ${defect.part}\n      ${defect.detail}`)
            .join('\n') +
          (defects.length > 40 ? `\n  … ${defects.length - 40} more` : '') +
          '\n'
      );
    }
    // Fixing one without lowering the ceiling leaves the next regression free to hide behind it.
    expect(defects.length).toBe(KNOWN_CONTENT_CONTROL_DISAGREEMENTS);
  });
});
