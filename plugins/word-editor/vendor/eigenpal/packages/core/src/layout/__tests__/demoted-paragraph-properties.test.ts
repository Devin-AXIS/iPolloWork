// A `w:pPr` the canonical read demoted to generic is still the paragraph's properties.
//
// The known-node invariant refuses shapes that are ordinary Word output — a paragraph mark
// (`w:rPr`) followed by `w:sectPr` or `w:pPrChange`, which is the CT_PPr order (17.3.1.26) —
// and the container lands in the tree as generic. Layout matched the TYPED kind alone, so
// such a paragraph rendered with none of its own alignment, indent, numbering or style: the
// document opened left-aligned and unindented, and the toolbar agreed with the wrong picture.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, resolveParagraphLayoutInputs } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function readRoot(xml: string): OoxmlElement {
  const result = readOoxmlPart(xml, { name: '/word/part.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

const STYLES = readRoot(
  `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading1">` +
    '<w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240"/><w:outlineLvl w:val="0"/>' +
    '</w:pPr></w:style></w:styles>'
);

const PARAGRAPH =
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/><w:ind w:left="720"/>' +
  '<w:rPr><w:b/></w:rPr><w:sectPr/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>';

/** The paragraph as the tree holds it, with its `w:pPr` demoted the way the reader does. */
function demotedParagraph(): OoxmlElement {
  const body = readRoot(`<w:document xmlns:w="${W}"><w:body>${PARAGRAPH}</w:body></w:document>`)
    .children[0] as OoxmlElement;
  const paragraph = body.children[0] as OoxmlElement;
  const children: OoxmlNode[] = paragraph.children.map((child) =>
    child.kind === 'paragraphProperties' ? ({ ...child, kind: 'generic' } as OoxmlNode) : child
  );
  return { ...paragraph, children } as OoxmlElement;
}

describe('paragraph layout reads the paragraph its own properties, typed or not', () => {
  test('a demoted w:pPr still carries alignment, indent and style — with a style table', () => {
    const inputs = resolveParagraphLayoutInputs(
      demotedParagraph(),
      468,
      buildStyleCascadeTable(STYLES)
    );
    expect(inputs.alignment).toBe('center');
    expect(inputs.indent.left).toBe(36); // 720 twips = 36pt
    expect(inputs.styleId).toBe('Heading1');
    // The style still cascades in: `w:spacing w:before` is Heading 1's, not the paragraph's.
    expect(inputs.spacing.before).toBeGreaterThan(0);
  });

  test('and without one, where only direct formatting exists', () => {
    const inputs = resolveParagraphLayoutInputs(demotedParagraph(), 468, undefined);
    expect(inputs.alignment).toBe('center');
    expect(inputs.indent.left).toBe(36);
    expect(inputs.styleId).toBe('Heading1');
  });

  test('a typed w:pPr is unchanged', () => {
    const body = readRoot(`<w:document xmlns:w="${W}"><w:body>${PARAGRAPH}</w:body></w:document>`)
      .children[0] as OoxmlElement;
    const inputs = resolveParagraphLayoutInputs(
      body.children[0] as OoxmlElement,
      468,
      buildStyleCascadeTable(STYLES)
    );
    expect(inputs.alignment).toBe('center');
    expect(inputs.indent.left).toBe(36);
  });
});
