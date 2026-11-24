// The painted hyperlink DOM contract.
//
// The anchor is furniture: it adds link SEMANTICS (href, title, focus, announcement) and it
// is never authoritative for anything. Every assertion here is either "the anchor carries the
// semantics" or "the spans inside it kept the selection contract they always had".

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  hyperlinkTargetOf,
  readOoxmlPackage,
  relationshipTargetIn,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  type HyperlinkFieldSpec,
} from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function packageOf(body: string, rels = ''): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  };
  const loaded = readOoxmlPackage(zipSync(entries));
  if (!loaded.ok) throw new Error(`load failed: ${loaded.reason}`);
  return loaded.package;
}

/**
 * A content-keyed field-link projector, like the surface registry: two fields naming the same
 * target share one id, which is exactly the shape that used to coalesce two field anchors.
 */
function projectFieldLink(spec: HyperlinkFieldSpec) {
  if (spec.target === null) return null;
  return { id: `field:${spec.target}`, kind: 'external' as const, href: spec.target };
}

function paint(body: string, rels = '', withFieldLinks = false): HTMLElement {
  const pkg = packageOf(body, rels);
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const layout = layoutSemanticDocument(part, 3, {
    measurer: createFixedMeasurer(6, 14),
    ...(withFieldLinks ? { projectFieldLink } : {}),
    projectLink: (link: OoxmlNode) => {
      if (link.kind === 'textValue') return null;
      const target = hyperlinkTargetOf(link, (id) =>
        relationshipTargetIn(pkg, pkg.mainDocumentPart, id)
      );
      return {
        id: link.id,
        kind: target.kind,
        href: target.href,
        ...(target.anchor !== undefined ? { anchor: target.anchor } : {}),
        ...(target.tooltip !== undefined ? { tooltip: target.tooltip } : {}),
      };
    },
  });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { ariaHidden: false });
  return container;
}

const EXTERNAL_REL = `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/>`;

describe('painted hyperlink anchors', () => {
  test('an external link paints an anchor carrying the sanitized target', () => {
    const container = paint(
      '<w:p><w:r><w:t xml:space="preserve">Visit </w:t></w:r>' +
        '<w:hyperlink r:id="rId9" w:tooltip="Our site"><w:r><w:t>Example</w:t></w:r></w:hyperlink>' +
        '</w:p>',
      EXTERNAL_REL
    );
    const anchor = container.querySelector('a.docx-hyperlink')!;
    expect((anchor as HTMLElement).style.cursor).toBe('pointer');
    expect(anchor.getAttribute('href')).toBe('https://example.com');
    expect(anchor.getAttribute('title')).toBe('Our site');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  test('an internal link paints a fragment href and no rel', () => {
    const container = paint(
      '<w:p><w:hyperlink w:anchor="section12"><w:r><w:t>Section 12</w:t></w:r></w:hyperlink></w:p>'
    );
    const anchor = container.querySelector('a.docx-hyperlink')!;
    expect((anchor as HTMLElement).style.cursor).toBe('pointer');
    expect(anchor.getAttribute('href')).toBe('#section12');
    expect(anchor.getAttribute('rel')).toBeNull();
  });

  test('a refused scheme paints the link with NO href and out of the tab order', () => {
    const container = paint(
      '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Click</w:t></w:r></w:hyperlink></w:p>',
      `<Relationship Id="rId9" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`
    );
    const anchor = container.querySelector('a.docx-hyperlink')!;
    expect((anchor as HTMLElement).style.cursor).toBe('default');
    expect(anchor.hasAttribute('href')).toBe(false);
    expect(anchor.getAttribute('tabindex')).toBe('-1');
    // The words are still on the page — an inert link is not a deleted one.
    expect(anchor.textContent).toBe('Click');
  });

  test('a LIVE link is out of the tab order too — the pages layer owns focus', () => {
    // The regression: Chrome focuses an anchor on mousedown, the surface's pointer path
    // focuses the pages layer back, and re-focusing a document-tall contenteditable scrolls
    // the viewport to its top. Clicking a link on page 10 threw the reader back to page 1.
    const container = paint(
      '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Example</w:t></w:r></w:hyperlink></w:p>',
      EXTERNAL_REL
    );
    const anchor = container.querySelector('a.docx-hyperlink')!;
    expect(anchor.getAttribute('tabindex')).toBe('-1');
    // ...and it is still a real link for the clipboard, print, and assistive tech.
    expect(anchor.getAttribute('href')).toBe('https://example.com');
  });

  test('run spans inside an anchor keep the selection contract', () => {
    const container = paint(
      '<w:p><w:hyperlink w:anchor="top"><w:r><w:t>Linked</w:t></w:r></w:hyperlink></w:p>'
    );
    const span = container.querySelector('a.docx-hyperlink [data-paragraph-id][data-start]');
    expect(span).not.toBeNull();
    expect((span as HTMLElement).dataset.start).toBe('0');
    expect((span as HTMLElement).dataset.end).toBe('6');
    expect((span as HTMLElement).dataset.paragraphId).toBeTruthy();
  });

  test('the anchor itself is not a selection target', () => {
    const container = paint(
      '<w:p><w:hyperlink w:anchor="top"><w:r><w:t>Linked</w:t></w:r></w:hyperlink></w:p>'
    );
    const anchor = container.querySelector('a.docx-hyperlink') as HTMLElement;
    // No source range of its own: `dom-selection` resolves through the spans inside.
    expect(anchor.dataset.start).toBeUndefined();
    expect(anchor.dataset.end).toBeUndefined();
    // But it names the link it paints, so a click can identify it without geometry.
    expect(anchor.dataset.docxLink).toBeTruthy();
    expect(anchor.dataset.docxLinkKind).toBe('internal');
  });

  test('one link across several formatting runs paints ONE anchor', () => {
    const container = paint(
      '<w:p><w:hyperlink w:anchor="top">' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> and plain</w:t></w:r>' +
        '</w:hyperlink></w:p>'
    );
    const anchors = container.querySelectorAll('a.docx-hyperlink');
    expect(anchors.length).toBe(1);
    expect(anchors[0]!.textContent).toBe('Bold and plain');
  });

  test('two links in one paragraph paint two anchors, and plain text stays outside both', () => {
    const container = paint(
      '<w:p><w:r><w:t xml:space="preserve">a </w:t></w:r>' +
        '<w:hyperlink w:anchor="one"><w:r><w:t>first</w:t></w:r></w:hyperlink>' +
        '<w:r><w:t xml:space="preserve"> b </w:t></w:r>' +
        '<w:hyperlink w:anchor="two"><w:r><w:t>second</w:t></w:r></w:hyperlink>' +
        '</w:p>'
    );
    const anchors = [...container.querySelectorAll('a.docx-hyperlink')];
    expect(anchors.map((a) => a.textContent)).toEqual(['first', 'second']);
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['#one', '#two']);
    // The plain run is a direct child of the line, not swallowed by either anchor.
    const line = container.querySelector('.docx-line')!;
    const plain = [...line.children].filter((child) => child.tagName !== 'A');
    expect(plain.some((child) => child.textContent === 'a ')).toBe(true);
  });

  test('no file-derived string is ever parsed as markup', () => {
    const container = paint(
      '<w:p><w:hyperlink r:id="rId9" w:tooltip="&lt;img src=x onerror=alert(1)&gt;">' +
        '<w:r><w:t>&lt;script&gt;</w:t></w:r></w:hyperlink></w:p>',
      EXTERNAL_REL
    );
    // The tooltip lands as an ATTRIBUTE VALUE and the text as a text node — neither becomes
    // an element, which is what `setAttribute` + `textContent` guarantee.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const anchor = container.querySelector('a.docx-hyperlink')!;
    expect(anchor.getAttribute('title')).toBe('<img src=x onerror=alert(1)>');
    expect(anchor.textContent).toBe('<script>');
  });
});

/** A complete complex field around one instruction, with an optional cached result. */
function complexField(instr: string, result = ''): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    result +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  );
}

describe('each HYPERLINK field is its own anchor', () => {
  test('two adjacent fields with an identical target paint TWO anchors', () => {
    // Content-keyed ids make both fields share one link id; before the fix the anchor loop
    // coalesced them into a single <a> a screen reader announced once.
    const container = paint(
      '<w:p>' +
        complexField(' HYPERLINK "https://example.com" ', '<w:r><w:t>A</w:t></w:r>') +
        complexField(' HYPERLINK "https://example.com" ', '<w:r><w:t>B</w:t></w:r>') +
        '</w:p>',
      '',
      true
    );
    const anchors = [...container.querySelectorAll('a[data-docx-link]')];
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.textContent)).toEqual(['A', 'B']);
  });

  test('a field followed by a typed link with the same target paints two anchors', () => {
    const container = paint(
      '<w:p>' +
        complexField(' HYPERLINK "https://example.com" ', '<w:r><w:t>A</w:t></w:r>') +
        '<w:hyperlink r:id="rId9"><w:r><w:t>B</w:t></w:r></w:hyperlink>' +
        '</w:p>',
      EXTERNAL_REL,
      true
    );
    const anchors = [...container.querySelectorAll('a[data-docx-link]')];
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.textContent)).toEqual(['A', 'B']);
  });

  test('a single typed link across two formatting runs is still ONE anchor', () => {
    // The field split must not disturb ordinary run coalescing.
    const container = paint(
      '<w:p><w:hyperlink w:anchor="top">' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> and plain</w:t></w:r>' +
        '</w:hyperlink></w:p>',
      '',
      true
    );
    expect(container.querySelectorAll('a[data-docx-link]')).toHaveLength(1);
  });

  test('a justify gap never stretches a link over the following plain text', () => {
    // The stretch lives inside the span's box AND its anchor. A link's last span absorbing
    // the gap would widen the <a> hit target across blank slack, so a click there would
    // follow the link. That boundary keeps the margin; gaps INSIDE the link still stretch.
    const words = Array.from({ length: 16 }, (_, index) => `w${index}`).join(' ');
    const body =
      '<w:p><w:pPr><w:jc w:val="both"/></w:pPr>' +
      '<w:hyperlink r:id="rId9"><w:r><w:t xml:space="preserve">link text </w:t></w:r></w:hyperlink>' +
      `<w:r><w:t xml:space="preserve">${words}</w:t></w:r>` +
      '</w:p>';
    const pkg = packageOf(body, EXTERNAL_REL);
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 3, {
      measurer: createFixedMeasurer(6, 14),
      geometry: { width: 220, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
      projectLink: (link: OoxmlNode) => {
        if (link.kind === 'textValue') return null;
        const target = hyperlinkTargetOf(link, (id) =>
          relationshipTargetIn(pkg, pkg.mainDocumentPart, id)
        );
        return { id: link.id, kind: target.kind, href: target.href };
      },
    });
    const fragment = layout.pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected paragraph');
    const line = fragment.lines[0]!;
    const gapAfter = (index: number): number => {
      const span = line.spans[index]!;
      const next = line.spans[index + 1]!;
      return next.box.x - (span.box.x + span.box.width);
    };
    // "link " → "text ": both in the anchor, with justify slack between them.
    expect(line.spans[0]!.link).toBeDefined();
    expect(line.spans[1]!.link).toBeDefined();
    expect(gapAfter(0)).toBeGreaterThan(0.25);
    // "text " → first plain word: the anchor boundary, also with slack.
    expect(line.spans[2]!.link).toBeUndefined();
    expect(gapAfter(1)).toBeGreaterThan(0.25);
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1, ariaHidden: false });
    const painted = [
      ...container
        .querySelector<HTMLElement>('.docx-line')!
        .querySelectorAll<HTMLElement>('.layout-run'),
    ];
    // Inside the anchor: the gap stretches, so the band and the hit target stay one piece.
    expect(Number.parseFloat(painted[0]!.style.wordSpacing)).toBeCloseTo(gapAfter(0), 5);
    // At the boundary: no stretch on the link's last span — the gap is the margin again.
    expect(painted[1]!.style.wordSpacing).toBe('');
    expect(Number.parseFloat(painted[2]!.style.marginLeft)).toBeCloseTo(gapAfter(1), 5);
    // And the anchor's own text still ends at the link text; the slack is outside it.
    expect(container.querySelector('a.docx-hyperlink')!.textContent).toBe('link text ');
  });
});
