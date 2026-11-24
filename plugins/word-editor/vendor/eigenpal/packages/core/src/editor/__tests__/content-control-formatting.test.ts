// Typed inline `w:sdt` traversal in formatting and hyperlink surface helpers.
//
// Until the canonical read types every `w:sdt`, these tests retype generic `sdt` /
// `sdtContent` nodes the way `ooxml-tree.ts` will — the walks under test assume
// `contentControl` and `contentControlContent`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  authoredRunPropertiesAt,
  hasAuthoredRunProperties,
  runPropertyEdits,
} from '../surface-formatting.ts';
import { hyperlinksInParagraph } from '../surface-hyperlinks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PARAGRAPH = '/word/document.xml#0.0.0';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return typeInlineControls(result.part);
}

/** Retype generic `w:sdt` / `w:sdtContent` to the typed control kinds this lane expects. */
function typeInlineControls(part: OoxmlPart): OoxmlPart {
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const children = node.children.map(visit);
    if (node.kind === 'generic' && node.localName === 'sdt') {
      return { ...node, kind: 'contentControl', children } as OoxmlNode;
    }
    if (node.kind === 'generic' && node.localName === 'sdtContent') {
      return { ...node, kind: 'contentControlContent', children } as OoxmlNode;
    }
    return { ...node, children };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

const RED = { localName: 'color', attributes: { val: 'FF0000' } } as const;

const ranges = (part: OoxmlPart, start: number, end: number): string[] =>
  runPropertyEdits(part, PARAGRAPH, start, end, RED).map((edit) => `${edit.start}..${edit.end}`);

const noopResolve = () => null;

describe('formatting through typed inline content controls', () => {
  /** `Name: ` + control around `Ada` + `!` — offsets 0..6, 6..9, 9..10. */
  const CONTROLLED = load(
    '<w:p>' +
      '<w:r><w:t xml:space="preserve">Name: </w:t></w:r>' +
      '<w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:t>Ada</w:t></w:r></w:sdtContent></w:sdt>' +
      '<w:r><w:t>!</w:t></w:r>' +
      '</w:p>'
  );

  test('the whole paragraph plans one edit per run, controls included, with no gap', () => {
    expect(ranges(CONTROLLED, 0, 10)).toEqual(['0..6', '6..9', '9..10']);
  });

  test('selecting only the control text plans an edit over exactly that range', () => {
    expect(ranges(CONTROLLED, 6, 9)).toEqual(['6..9']);
  });

  test('the run after a control is addressed at its real offsets', () => {
    expect(ranges(CONTROLLED, 9, 10)).toEqual(['9..10']);
  });

  test('hasAuthoredRunProperties walks inside a control', () => {
    const boldInside = load(
      '<w:p>' +
        '<w:sdt><w:sdtContent>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>' +
        '</w:sdtContent></w:sdt>' +
        '</w:p>'
    );
    expect(hasAuthoredRunProperties(boldInside, PARAGRAPH, 0, 4)).toBe(true);
  });

  test('authoredRunPropertiesAt reads the run inside a control', () => {
    const italicInside = load(
      '<w:p>' +
        '<w:sdt><w:sdtContent>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>in</w:t></w:r>' +
        '</w:sdtContent></w:sdt>' +
        '</w:p>'
    );
    const props = authoredRunPropertiesAt(italicInside, PARAGRAPH, 1);
    expect(props.map((property) => property.localName).sort()).toEqual(['i']);
  });

  test('nested controls contribute runs in document order', () => {
    const nested = load(
      '<w:p>' +
        '<w:sdt><w:sdtContent>' +
        '<w:r><w:t>o</w:t></w:r>' +
        '<w:sdt><w:sdtContent><w:r><w:t>in</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>r</w:t></w:r>' +
        '</w:sdtContent></w:sdt>' +
        '</w:p>'
    );
    expect(ranges(nested, 0, 4)).toEqual(['0..1', '1..3', '3..4']);
  });
});

describe('hyperlinks composed with typed inline content controls', () => {
  test('a link inside a control reports correct offsets', () => {
    const linkInControl = load(
      '<w:p>' +
        '<w:r><w:t xml:space="preserve">See </w:t></w:r>' +
        '<w:sdt><w:sdtContent>' +
        '<w:hyperlink w:anchor="x"><w:r><w:t>here</w:t></w:r></w:hyperlink>' +
        '</w:sdtContent></w:sdt>' +
        '<w:r><w:t>.</w:t></w:r>' +
        '</w:p>'
    );
    const links = hyperlinksInParagraph(linkInControl, PARAGRAPH, noopResolve);
    expect(links).toHaveLength(1);
    expect(links[0]!.start).toBe(4);
    expect(links[0]!.end).toBe(8);
    expect(links[0]!.text).toBe('here');
  });

  test('a link around a DEMOTED control reports its text, not just its span', () => {
    // `w:sdtPr` after `w:sdtContent` is misordered, so the reader preserves the control as a
    // generic node. The offset walk still counts its text, so a walk that stops at the
    // wrapper reports the right span with an empty label — a blank hyperlink editor.
    const demoted = load(
      '<w:p>' +
        '<w:hyperlink w:anchor="x"><w:sdt>' +
        '<w:sdtContent><w:r><w:t>here</w:t></w:r></w:sdtContent><w:sdtPr/>' +
        '</w:sdt></w:hyperlink>' +
        '</w:p>'
    );
    const links = hyperlinksInParagraph(demoted, PARAGRAPH, noopResolve);
    expect(links).toHaveLength(1);
    expect(links[0]!.start).toBe(0);
    expect(links[0]!.end).toBe(4);
    expect(links[0]!.text).toBe('here');
  });

  test('a control around link text still formats the link run', () => {
    const linkInControl = load(
      '<w:p>' +
        '<w:sdt><w:sdtContent>' +
        '<w:hyperlink w:anchor="x"><w:r><w:rPr><w:i/></w:rPr><w:t>link</w:t></w:r></w:hyperlink>' +
        '</w:sdtContent></w:sdt>' +
        '</w:p>'
    );
    const names = runPropertyEdits(linkInControl, PARAGRAPH, 0, 4, RED).map((edit) =>
      edit.properties
        .map((property) => property.localName)
        .sort()
        .join('+')
    );
    expect(names).toEqual(['color+i']);
  });

  test('a control wrapping plain text then a link keeps offsets for both', () => {
    const mixed = load(
      '<w:p>' +
        '<w:sdt><w:sdtContent>' +
        '<w:r><w:t xml:space="preserve">Go </w:t></w:r>' +
        '<w:hyperlink w:anchor="y"><w:r><w:t>now</w:t></w:r></w:hyperlink>' +
        '</w:sdtContent></w:sdt>' +
        '</w:p>'
    );
    const links = hyperlinksInParagraph(mixed, PARAGRAPH, noopResolve);
    expect(ranges(mixed, 0, 6)).toEqual(['0..3', '3..6']);
    expect(links).toHaveLength(1);
    expect(links[0]!.start).toBe(3);
    expect(links[0]!.end).toBe(6);
    expect(links[0]!.text).toBe('now');
  });
});
