// Hyperlink runs are ordinary paragraph content: measured, broken, painted, addressable.
//
// The regression these guard is not subtle. While `w:hyperlink` was an opaque child its runs
// never entered the token stream, so section 9 of the comprehensive fixture painted
// "Visit  or ." — a sentence with its two links deleted out of it, and no indication anything
// was missing.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import {
  hyperlinkTargetOf,
  readOoxmlPackage,
  relationshipTargetIn,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { HyperlinkProjector } from '../field-projection.ts';
import type { SemanticLayout, StyleSpanRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const FIXTURE = `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`;
const measurer = createFixedMeasurer(6, 14);

/** The projector the real surface installs, over a package's own relationships. */
function projectorFor(pkg: OoxmlPackage): HyperlinkProjector {
  return (link: OoxmlNode) => {
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
  };
}

function layoutOf(pkg: OoxmlPackage): SemanticLayout {
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  return layoutSemanticDocument(part, 1, { measurer, projectLink: projectorFor(pkg) });
}

/** Every span of the layout, in document order. */
function spansOf(layout: SemanticLayout): StyleSpanRecord[] {
  const spans: StyleSpanRecord[] = [];
  const walk = (blocks: readonly { kind: string }[]): void => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        for (const row of (block as { rows: { cells: { blocks: unknown[] }[] }[] }).rows) {
          for (const cell of row.cells) walk(cell.blocks as { kind: string }[]);
        }
        continue;
      }
      for (const line of (block as unknown as { lines: { spans: StyleSpanRecord[] }[] }).lines) {
        spans.push(...line.spans);
      }
    }
  };
  for (const page of layout.pages) walk(page.fragments);
  return spans;
}

/** The painted text of one paragraph, reassembled from its spans in offset order. */
function paintedTextOf(layout: SemanticLayout, paragraphId: string): string {
  return spansOf(layout)
    .filter((span) => span.range.paragraphId === paragraphId)
    .sort((a, b) => a.range.start - b.range.start)
    .map((span) => span.text)
    .join('');
}

function loadFixture(): OoxmlPackage {
  const result = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!result.ok) throw new Error(`package read failed: ${result.reason}`);
  return result.package;
}

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

/** The paragraph whose painted text contains `needle`. */
function paragraphContaining(layout: SemanticLayout, needle: string): string {
  const ids = new Set(spansOf(layout).map((span) => span.range.paragraphId));
  for (const id of ids) {
    if (paintedTextOf(layout, id).includes(needle)) return id;
  }
  throw new Error(`no painted paragraph contains ${JSON.stringify(needle)}`);
}

describe('hyperlink runs are laid out like sibling runs (comprehensive fixture)', () => {
  const layout = layoutOf(loadFixture());

  test('9.1 paints its whole sentence, not the sentence minus its links', () => {
    const id = paragraphContaining(layout, 'Visit ');
    expect(paintedTextOf(layout, id)).toBe('Visit Example.com or Anthropic’s website.');
  });

  test('9.2 paints its cross-references, en dashes intact', () => {
    const id = paragraphContaining(layout, 'Jump to:');
    expect(paintedTextOf(layout, id)).toBe(
      'Jump to: Section 1 | Section 6 – Nested Tables | Section 12 – Form Elements'
    );
  });

  test('external link spans carry the resolved external target', () => {
    const id = paragraphContaining(layout, 'Visit ');
    const links = spansOf(layout)
      .filter((span) => span.range.paragraphId === id && span.link)
      .map((span) => span.link!);
    expect(
      links.some((link) => link.kind === 'external' && link.href === 'https://example.com')
    ).toBe(true);
    expect(
      links.some((link) => link.kind === 'external' && link.href === 'https://www.anthropic.com')
    ).toBe(true);
  });

  test('internal link spans carry the anchor as a fragment', () => {
    const id = paragraphContaining(layout, 'Jump to:');
    const anchors = new Set(
      spansOf(layout)
        .filter((span) => span.range.paragraphId === id && span.link)
        .map((span) => span.link!.href)
    );
    expect(anchors).toEqual(new Set(['#section1', '#section6', '#section12']));
  });

  test('every link span of one link shares that link’s node identity', () => {
    const id = paragraphContaining(layout, 'Visit ');
    const byHref = new Map<string, Set<string>>();
    for (const span of spansOf(layout)) {
      if (span.range.paragraphId !== id || !span.link?.href) continue;
      const ids = byHref.get(span.link.href) ?? new Set<string>();
      ids.add(span.link.id);
      byHref.set(span.link.href, ids);
    }
    // One `w:hyperlink` element per target, so one id per target however many spans it took.
    for (const ids of byHref.values()) expect(ids.size).toBe(1);
  });

  test('plain runs beside a link carry no link', () => {
    const id = paragraphContaining(layout, 'Visit ');
    const visit = spansOf(layout).find(
      (span) => span.range.paragraphId === id && span.text.startsWith('Visit')
    );
    expect(visit?.link).toBeUndefined();
  });
});

describe('link targets cross the trust boundary exactly once', () => {
  test('a javascript: target loads INERT — painted, addressable, unactivatable', () => {
    const pkg = packageOf(
      '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Click me</w:t></w:r></w:hyperlink></w:p>',
      `<Relationship Id="rId9" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`
    );
    const layout = layoutOf(pkg);
    const id = paragraphContaining(layout, 'Click me');
    // The TEXT survives: a refused scheme is not a reason to lose the words.
    expect(paintedTextOf(layout, id)).toBe('Click me');
    const link = spansOf(layout).find((span) => span.range.paragraphId === id)?.link;
    expect(link?.kind).toBe('external');
    // ...and there is nothing to follow.
    expect(link?.href).toBeNull();
  });

  test('a scheme smuggled past a naive check is refused too', () => {
    const pkg = packageOf(
      '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Sneaky</w:t></w:r></w:hyperlink></w:p>',
      `<Relationship Id="rId9" Type="${R}/hyperlink" Target="java&#9;script:alert(1)" TargetMode="External"/>`
    );
    const layout = layoutOf(pkg);
    const id = paragraphContaining(layout, 'Sneaky');
    expect(spansOf(layout).find((span) => span.range.paragraphId === id)?.link?.href).toBeNull();
  });

  test('a RELATIVE target is inert — it would resolve against the host application', () => {
    // `sanitizeHref` is a SCHEME allowlist and admits relative URLs on purpose; that is the
    // right rule for a value a host authored and the wrong one for a value a `.docx` did.
    // A target with no scheme resolves against whatever origin the editor is embedded in,
    // so a link reading "Company policy" becomes an authenticated same-origin request to
    // the host app. The package's own absolute-URI verdict is what refuses it.
    for (const target of ['/admin/api/delete-account', '//evil.example/x', 'evil.html']) {
      const pkg = packageOf(
        '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Company policy</w:t></w:r></w:hyperlink></w:p>',
        `<Relationship Id="rId9" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/>`
      );
      const layout = layoutOf(pkg);
      const id = paragraphContaining(layout, 'Company policy');
      // The text is still there — an inert link is not a deleted one.
      expect(paintedTextOf(layout, id)).toBe('Company policy');
      const link = spansOf(layout).find((span) => span.range.paragraphId === id)?.link;
      expect(link?.href, target).toBeNull();
      // ...and the authored value is retained, so the save is still lossless.
      expect(link?.kind).toBe('external');
    }
  });

  test('an absolute allowlisted target is still admitted', () => {
    const pkg = packageOf(
      '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Fine</w:t></w:r></w:hyperlink></w:p>',
      `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com/a?b=1" TargetMode="External"/>`
    );
    const layout = layoutOf(pkg);
    const id = paragraphContaining(layout, 'Fine');
    expect(spansOf(layout).find((span) => span.range.paragraphId === id)?.link?.href).toBe(
      'https://example.com/a?b=1'
    );
  });

  test('a dangling relationship demotes to plain runs without losing the text', () => {
    const pkg = packageOf(
      '<w:p><w:hyperlink r:id="rIdMissing"><w:r><w:t>Orphan</w:t></w:r></w:hyperlink></w:p>'
    );
    const layout = layoutOf(pkg);
    const id = paragraphContaining(layout, 'Orphan');
    expect(paintedTextOf(layout, id)).toBe('Orphan');
    const link = spansOf(layout).find((span) => span.range.paragraphId === id)?.link;
    expect(link?.kind).toBe('unresolved');
    expect(link?.href).toBeNull();
  });

  test('non-run content inside a link keeps its position and the runs still paint', () => {
    const pkg = packageOf(
      '<w:p><w:hyperlink w:anchor="top">' +
        '<w:r><w:t>before</w:t></w:r><w:drawing/><w:r><w:t>after</w:t></w:r>' +
        '</w:hyperlink></w:p>'
    );
    const layout = layoutOf(pkg);
    const id = paragraphContaining(layout, 'before');
    expect(paintedTextOf(layout, id)).toBe('beforeafter');
  });
});

describe('bookmarks occupy no space', () => {
  test('a heading carrying a bookmark measures like one without', () => {
    const withBookmark = layoutOf(
      packageOf(
        '<w:p><w:bookmarkStart w:id="1" w:name="here"/><w:r><w:t>Heading</w:t></w:r>' +
          '<w:bookmarkEnd w:id="1"/></w:p>'
      )
    );
    const plain = layoutOf(packageOf('<w:p><w:r><w:t>Heading</w:t></w:r></w:p>'));
    const boxOf = (layout: SemanticLayout) =>
      (layout.pages[0]!.fragments[0] as unknown as { lines: { box: unknown }[] }).lines[0]!.box;
    expect(boxOf(withBookmark)).toEqual(boxOf(plain));
    // And the bookmark contributes no offsets, so the text starts at 0.
    const id = paragraphContaining(withBookmark, 'Heading');
    const first = spansOf(withBookmark).find((span) => span.range.paragraphId === id);
    expect(first?.range.start).toBe(0);
  });
});

describe('a part with no relationship resolver still paints its link text', () => {
  test('layout without projectLink loses the target, never the words', () => {
    const pkg = packageOf(
      '<w:p><w:hyperlink w:anchor="top"><w:r><w:t>Somewhere</w:t></w:r></w:hyperlink></w:p>'
    );
    const part: OoxmlPart = pkg.parts.get(pkg.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, { measurer });
    const id = paragraphContaining(layout, 'Somewhere');
    expect(paintedTextOf(layout, id)).toBe('Somewhere');
    expect(spansOf(layout).find((span) => span.range.paragraphId === id)?.link).toBeUndefined();
  });
});
