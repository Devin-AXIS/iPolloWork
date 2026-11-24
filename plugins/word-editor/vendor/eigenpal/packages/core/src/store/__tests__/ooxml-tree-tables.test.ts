// Typed table vocabulary on the canonical tree (legacy-lane retirement, phase 1a).
//
// Promoting w:tbl/w:tr/w:tc/w:tblGrid/w:tblPr from `generic` to typed kinds must be
// invisible to both D9 oracles: the canonical fingerprint and the serializer read
// localName/attributes/children, never `kind`, so a promoted tree emits the same
// canonical bytes a generic one did. These tests hold that line against the two real
// table fixtures and pin the demotion semantics for malformed shapes.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { semanticDigest, diffSemanticDigests } from '../package/ooxml-digest.ts';
import { readOoxmlPackage, writeOoxmlPackage, withPart } from '../package/ooxml-package.ts';
import { applyTreeOp, paragraphTextOf } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function fixture(name: string): Uint8Array {
  return readFileSync(`${import.meta.dir}/../../../../../e2e/fixtures/${name}`);
}

function loadPackage(name: string) {
  const result = readOoxmlPackage(fixture(name));
  if (!result.ok) throw new Error(`package read failed: ${result.reason}`);
  return result.package;
}

function loadPart(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

function collectByKind(root: OoxmlNode, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === kind) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/** First paragraph found inside a table cell, depth-first. */
function firstCellParagraph(part: OoxmlPart): OoxmlElement {
  for (const cell of collectByKind(part.root, 'tableCell')) {
    for (const child of cell.children) {
      if (child.kind === 'paragraph') return child;
    }
  }
  throw new Error('fixture has no paragraph inside a table cell');
}

describe('typed table vocabulary round-trips through both D9 oracles', () => {
  for (const name of ['with-tables.docx', 'repeated-table-header.docx']) {
    test(`${name}: promotion happened and the part round-trips`, () => {
      const pkg = loadPackage(name);
      const part = pkg.parts.get(pkg.mainDocumentPart)!;

      // Anti-vacuity: promotion actually happened on a real Word document. A silent
      // demotion (bad validKnownKind arm) would keep these all generic and this test —
      // not just layout — must catch that.
      const tables = collectByKind(part.root, 'table');
      expect(tables.length).toBeGreaterThan(0);
      expect(collectByKind(part.root, 'tableRow').length).toBeGreaterThan(0);
      expect(collectByKind(part.root, 'tableCell').length).toBeGreaterThan(0);

      // When a grid is present its children stay generic property leaves carrying
      // twip widths (these fixtures omit w:tblGrid — the synthesized test below
      // covers the typed-grid shape).
      for (const grid of collectByKind(part.root, 'tableGrid')) {
        for (const child of grid.children) expect(child.kind).toBe('generic');
      }

      // Oracle 1: canonical fingerprint survives serialize -> reopen.
      const reopened = loadPart(serializeOoxmlPart(part));
      expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
      // Oracle 2: save/reopen semantic digest is unchanged.
      expect(diffSemanticDigests(semanticDigest([part]), semanticDigest([reopened]))).toEqual([]);
    });

    test(`${name}: the whole package round-trips through writeOoxmlPackage`, () => {
      const pkg = loadPackage(name);
      const reopened = readOoxmlPackage(writeOoxmlPackage(pkg));
      if (!reopened.ok) throw new Error(reopened.reason);
      for (const [partName, before] of pkg.parts) {
        const after = reopened.package.parts.get(partName);
        expect(after).toBeDefined();
        expect(canonicalOoxmlFingerprint(after!)).toBe(canonicalOoxmlFingerprint(before));
      }
    });
  }
});

describe('malformed table shapes stay lossless and round-trip', () => {
  const doc = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const CELL = '<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>';

  test('a w:tbl carrying w:val stays typed and keeps the attribute', () => {
    // A stray w:val means nothing on a table, which still shows.
    const part = loadPart(doc(`<w:tbl w:val="nope"><w:tr>${CELL}</w:tr></w:tbl>`));
    expect(collectByKind(part.root, 'table')).toHaveLength(1);
    expect(collectByKind(part.root, 'tableRow')).toHaveLength(1);
    expect(part.root.kind).toBe('document');
    expect(serializeOoxmlPart(part)).toContain('<w:tbl w:val="nope">');
    const reopened = loadPart(serializeOoxmlPart(part));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('two w:tblPr children merge into one and the table stays typed', () => {
    const part = loadPart(doc(`<w:tbl><w:tblPr/><w:tblPr/><w:tr>${CELL}</w:tr></w:tbl>`));
    expect(collectByKind(part.root, 'table')).toHaveLength(1);
    expect(collectByKind(part.root, 'tableProperties')).toHaveLength(1);
    const reopened = loadPart(serializeOoxmlPart(part));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('a stray w:tr in the body demotes the body itself (existing cascade rule)', () => {
    // Same cascade a stray w:rPr triggers today: a typed-but-misplaced child makes the
    // ancestor fail its arm and fall back to generic. Lossless, never load-bearing.
    const part = loadPart(doc(`<w:p><w:r><w:t>a</w:t></w:r></w:p><w:tr>${CELL}</w:tr>`));
    expect(collectByKind(part.root, 'body')).toHaveLength(0);
    const reopened = loadPart(serializeOoxmlPart(part));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('a nested table inside a cell stays fully typed', () => {
    const part = loadPart(
      doc(`<w:tbl><w:tr><w:tc><w:tbl><w:tr>${CELL}</w:tr></w:tbl><w:p/></w:tc></w:tr></w:tbl>`)
    );
    expect(collectByKind(part.root, 'table')).toHaveLength(2);
    expect(collectByKind(part.root, 'tableCell')).toHaveLength(2);
  });

  test('a w:tblGrid types as tableGrid with generic gridCol children', () => {
    const part = loadPart(
      doc(
        '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
          `<w:tr>${CELL}${CELL}</w:tr></w:tbl>`
      )
    );
    const grids = collectByKind(part.root, 'tableGrid');
    expect(grids).toHaveLength(1);
    const cols = grids[0]!.children;
    expect(cols).toHaveLength(2);
    for (const col of cols) {
      expect(col.kind).toBe('generic');
      if (col.kind !== 'generic') continue;
      expect(col.localName).toBe('gridCol');
      expect(col.attributes.some((a) => a.localName === 'w')).toBe(true);
    }
  });
});

describe('cell paragraphs are editable through the ordinary op layer', () => {
  test('insertText into a with-tables.docx cell commits and preserves siblings', () => {
    const pkg = loadPackage('with-tables.docx');
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const target = firstCellParagraph(part);
    const before = paragraphTextOf(part, target.id);

    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: target.id,
      offset: 0,
      text: 'Z',
    });
    if (!result.ok) throw new Error(`edit rejected: ${result.reason}`);
    expect(paragraphTextOf(result.part, target.id)).toBe(`Z${before}`);

    // The edit survives a full package save/reopen through both oracles.
    const reopened = readOoxmlPackage(writeOoxmlPackage(withPart(pkg, result.part)));
    if (!reopened.ok) throw new Error(reopened.reason);
    const after = reopened.package.parts.get(pkg.mainDocumentPart)!;
    expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(result.part));
    expect(diffSemanticDigests(semanticDigest([result.part]), semanticDigest([after]))).toEqual([]);
    // Structural ids are stable across save/reopen, so the same id reads the edited text.
    expect(paragraphTextOf(after, target.id)).toBe(`Z${before}`);
  });

  test('joining paragraphs across two cells is refused as not-adjacent-siblings', () => {
    const part = loadPart(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tr>` +
        '<w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc>' +
        '</w:tr></w:tbl></w:body></w:document>'
    );
    const cells = collectByKind(part.root, 'tableCell');
    expect(cells).toHaveLength(2);
    const first = cells[0]!.children.find((c) => c.kind === 'paragraph')!;
    const second = cells[1]!.children.find((c) => c.kind === 'paragraph')!;
    const result = applyTreeOp(part, {
      op: 'joinParagraphs',
      firstId: first.id,
      secondId: second.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-adjacent-siblings');
  });
});
