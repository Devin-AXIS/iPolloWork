// Clipboard fragment extract + insert: the rich-clipboard-fidelity store lane.
//
// The north-star oracle lives here: extract the fixed rich fixture's full body, land it in a
// blank document sharing the sample's docDefaults, and compare normalized block
// signatures. Normalization strips `w:sectPr`, revision-save noise and comment markers,
// and maps every remapped identifier namespace (numbering, notes, bookmarks, rels,
// `wp:docPr`, SDT ids) by order of first appearance, so fresh target ids compare equal.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { writeOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import {
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { sha256FontBytes } from '../package/sha256.ts';
import {
  extractFragmentPackage,
  type FragmentCoverage,
} from '../store/clipboard-fragment-extract.ts';
import { carriesRevisionId } from '../store/tree-op-revision-ids.ts';
import { normalizedBodySignatures, referencedNoteSignatures } from './clipboard-fragment-oracle.ts';
import { paragraphLength } from '../store/tree-op-segments.ts';
import { attributeValueOf } from '../store/tree-op-nodes.ts';
import {
  RICH_CLIPBOARD_FIXTURE,
  bodyOf,
  buildPackage,
  fullBodyCoverage,
  isElement,
  lastParagraphOf,
  loadPackage,
  openStore,
  paragraphIdsUnder,
} from './clipboard-fragment-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const SAMPLE = RICH_CLIPBOARD_FIXTURE;

const samplePackage = (): OoxmlPackage => loadPackage(new Uint8Array(readFileSync(SAMPLE)));

function isEmptyParagraph(node: OoxmlNode): boolean {
  if (node.kind !== 'paragraph') return false;
  return node.children.every((child) => child.kind === 'paragraphProperties');
}

// ---------------------------------------------------------------------------
// Synthetic package builders
// ---------------------------------------------------------------------------

/** A blank single-paragraph document whose styles part mirrors the sample's defaults. */
function blankTargetSharingDefaults(sample: OoxmlPackage): OoxmlPackage {
  const stylesPart = sample.parts.get('/word/styles.xml');
  if (!stylesPart || !isElement(stylesPart.root)) throw new Error('sample has no styles');
  const kept = stylesPart.root.children.filter((child) => {
    if (!isElement(child)) return false;
    if (child.localName === 'docDefaults') return true;
    if (child.localName !== 'style') return false;
    const flag = attributeValueOf(child, 'default');
    return flag === '1' || flag === 'true';
  });
  const stylesXml = serializeOoxmlPart({
    id: '/word/styles.xml',
    name: '/word/styles.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
    root: { ...stylesPart.root, children: kept } as OoxmlElement,
  } as OoxmlPart);
  return buildPackage('<w:p/>', { 'word/styles.xml': stylesXml });
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

describe('clipboard fragment extract', () => {
  test('select-all extraction of the sample body: closure travels, exclusions do not', () => {
    const pkg = samplePackage();
    const result = extractFragmentPackage(pkg, fullBodyCoverage(pkg));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blockCount).toBeGreaterThan(0);
    expect(result.mediaBytes).toBeGreaterThan(0);
    expect(result.lastMarkCovered).toBe(true);

    const fragment = loadPackage(result.bytes);
    expect(fragment.parts.has('/word/document.xml')).toBe(true);
    expect(fragment.parts.has('/word/styles.xml')).toBe(true);
    expect(fragment.parts.has('/word/numbering.xml')).toBe(true);
    expect(fragment.parts.has('/word/footnotes.xml')).toBe(true);
    expect(fragment.parts.has('/word/endnotes.xml')).toBe(true);

    for (const name of [...fragment.parts.keys(), ...fragment.partBytes.keys()]) {
      expect(name.includes('header')).toBe(false);
      expect(name.includes('footer')).toBe(false);
      expect(name.includes('comments')).toBe(false);
      expect(name.includes('settings')).toBe(false);
      expect(name.includes('theme')).toBe(false);
    }

    const documentXml = serializeOoxmlPart(fragment.parts.get('/word/document.xml')!);
    expect(documentXml.includes('sectPr')).toBe(false);
    expect(documentXml.includes('commentRangeStart')).toBe(false);
    expect(documentXml.includes('commentReference')).toBe(false);

    // Closure covers note-body styles: the styles part carries the footnote-lane styles
    // even though no BODY run references them.
    const stylesXml = serializeOoxmlPart(fragment.parts.get('/word/styles.xml')!);
    expect(stylesXml.includes('FootnoteReference')).toBe(true);
    expect(stylesXml.includes('docDefaults')).toBe(true);

    // Media travels byte-identical under its original names.
    let mediaCount = 0;
    for (const [name, bytes] of fragment.partBytes) {
      if (!name.includes('/media/')) continue;
      mediaCount += 1;
      const canonical = name.startsWith('/') ? name : `/${name}`;
      const source =
        pkg.partBytes.get(canonical) ?? pkg.partBytes.get(canonical.replace(/^\//, ''));
      expect(source).toBeDefined();
      expect(sha256FontBytes(bytes)).toBe(sha256FontBytes(source!));
    }
    expect(mediaCount).toBeGreaterThan(0);
  });

  test('the in-memory fragment package writes without duplicate OPC names', () => {
    const pkg = samplePackage();
    const result = extractFragmentPackage(pkg, fullBodyCoverage(pkg));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reopened = loadPackage(writeOoxmlPackage(result.package));
    expect(reopened.parts.has('/word/document.xml')).toBe(true);
  });

  test('partial edge paragraphs trim to the range and the mark bit stays honest', () => {
    const pkg = buildPackage(
      '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:p><w:r><w:t>Second here</w:t></w:r></w:p>'
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const ids = paragraphIdsUnder(bodyOf(part));
    const coverage: FragmentCoverage = {
      partName: part.name,
      paragraphIds: ids,
      startOffset: 6,
      endOffset: 6,
      coveredParagraphIds: [],
      fullyCoveredBlockIds: [],
      lastMarkCovered: false,
    };
    const result = extractFragmentPackage(pkg, coverage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lastMarkCovered).toBe(false);
    const fragment = loadPackage(result.bytes);
    const documentXml = serializeOoxmlPart(fragment.parts.get('/word/document.xml')!);
    expect(documentXml.includes('world')).toBe(true);
    expect(documentXml.includes('Hello')).toBe(false);
    expect(documentXml.includes('Second')).toBe(true);
    expect(documentXml.includes('here')).toBe(false);
  });

  test('a range that cuts a complex field carries the cached result only', () => {
    const pkg = buildPackage(
      '<w:p>' +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText>PAGE</w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/><w:t>7</w:t></w:r>' +
        '</w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>B</w:t></w:r></w:p>'
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const ids = paragraphIdsUnder(bodyOf(part));
    const first = lastParagraphOf(part, ids[0]!);
    const coverage: FragmentCoverage = {
      partName: part.name,
      paragraphIds: [ids[0]!],
      startOffset: 0,
      endOffset: paragraphLength(first as never),
      coveredParagraphIds: [ids[0]!],
      fullyCoveredBlockIds: [],
      lastMarkCovered: true,
    };
    const result = extractFragmentPackage(pkg, coverage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const documentXml = serializeOoxmlPart(
      loadPackage(result.bytes).parts.get('/word/document.xml')!
    );
    expect(documentXml.includes('fldChar')).toBe(false);
    expect(documentXml.includes('instrText')).toBe(false);
    expect(documentXml.includes('PAGE')).toBe(false);
    expect(documentXml.includes('>7<')).toBe(true);
    expect(documentXml.includes('>A<')).toBe(true);
  });

  test('row-aligned partial coverage restarts a vertical merge', () => {
    const cell = (content: string, tcPr = ''): string =>
      `<w:tc>${tcPr}<w:p>${content}</w:p></w:tc>`;
    const pkg = buildPackage(
      '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
        `<w:tr>${cell('<w:r><w:t>top</w:t></w:r>', '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>')}</w:tr>` +
        `<w:tr>${cell('<w:r><w:t>bottom</w:t></w:r>', '<w:tcPr><w:vMerge/></w:tcPr>')}</w:tr>` +
        '</w:tbl><w:p/>'
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const ids = paragraphIdsUnder(bodyOf(part));
    // Cover only the second row's paragraph plus the trailing body paragraph.
    const covered = [ids[1]!];
    const coverage: FragmentCoverage = {
      partName: part.name,
      paragraphIds: [ids[1]!, ids[2]!],
      startOffset: 0,
      endOffset: 0,
      coveredParagraphIds: covered,
      fullyCoveredBlockIds: [],
      lastMarkCovered: false,
    };
    const result = extractFragmentPackage(pkg, coverage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const documentXml = serializeOoxmlPart(
      loadPackage(result.bytes).parts.get('/word/document.xml')!
    );
    expect(documentXml.includes('bottom')).toBe(true);
    expect(documentXml.includes('top')).toBe(false);
    expect(documentXml).toContain('w:vMerge w:val="restart"');
  });
});

// ---------------------------------------------------------------------------
// North star: extract → merge → insertFragment
// ---------------------------------------------------------------------------

describe('clipboard fragment round trip', () => {
  test('the sample body pastes into a blank document verbatim under the oracle', () => {
    const sample = samplePackage();
    const extracted = extractFragmentPackage(sample, fullBodyCoverage(sample));
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const target = blankTargetSharingDefaults(sample);
    const store = openStore(target);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;

    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: hostId,
        offset: 0,
        fragmentBytes: extracted.bytes,
        lastMarkCovered: extracted.lastMarkCovered,
      }
    );
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    expect(pasted.blockCount).toBeGreaterThan(0);

    const after = store.currentPackage();
    const source = normalizedBodySignatures(sample, sample.mainDocumentPart);
    let landed = normalizedBodySignatures(after, after.mainDocumentPart);

    // The host's own empty paragraph survives at the end (Word's Ctrl+A paste shape).
    const targetPart = after.parts.get(after.mainDocumentPart)!;
    const blocks = bodyOf(targetPart).children.filter(
      (child) =>
        child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'contentControl'
    );
    expect(isEmptyParagraph(blocks[blocks.length - 1]!)).toBe(true);
    landed = landed.slice(0, -1);

    expect(landed.length).toBe(source.length);
    let mismatches = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (landed[index] !== source[index]) mismatches += 1;
    }
    expect(mismatches).toBe(0);

    // Note stories transferred: the pasted body's references resolve, IN ORDER, to note
    // bodies whose normalized signatures match the source's - not merely to parts that
    // exist.
    for (const kind of ['footnote', 'endnote'] as const) {
      const sourceNotes = referencedNoteSignatures(sample, sample.mainDocumentPart, kind);
      const landedNotes = referencedNoteSignatures(after, after.mainDocumentPart, kind);
      expect(sourceNotes.length).toBeGreaterThan(0);
      expect(landedNotes).toEqual(sourceNotes);
      expect(landedNotes.includes('missing')).toBe(false);
    }
  });

  test('a pasted format record takes a fresh @w:id, so one card cannot cover both copies', () => {
    // The id remap matched the four content wrappers by their typed KIND. `w:rPrChange` and
    // `w:pPrChange` are generic, so a pasted format record kept the id of the one it was
    // copied from: the review pane showed ONE card covering the original text and the copy,
    // and rejecting it reverted formatting in a place nobody had proposed anything.
    const recorded =
      '<w:p><w:r><w:rPr><w:b/>' +
      '<w:rPrChange w:id="3" w:author="Ada" w:date="2026-01-01T00:00:00Z">' +
      '<w:rPr/></w:rPrChange>' +
      '</w:rPr><w:t>hello</w:t></w:r></w:p>';
    const source = buildPackage(recorded);
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const store = openStore(source);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(source.mainDocumentPart)!)
    )[0]!;
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: hostId,
        offset: 5,
        fragmentBytes: extracted.bytes,
        lastMarkCovered: extracted.lastMarkCovered,
      }
    );
    expect(pasted.ok).toBe(true);

    const after = store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!;
    const ids: string[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'rPrChange') ids.push(attributeValueOf(node, 'id') ?? '');
      for (const child of node.children) walk(child);
    };
    walk(after.root);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('undo after a fragment paste reverts imported resources with the tree', () => {
    const sample = samplePackage();
    const extracted = extractFragmentPackage(sample, fullBodyCoverage(sample));
    if (!extracted.ok) throw new Error('extract failed');

    const target = blankTargetSharingDefaults(sample);
    const store = openStore(target);
    const beforeParts = [...store.currentPackage().partBytes.keys()].sort();
    const beforeBody = normalizedBodySignatures(
      store.currentPackage(),
      store.currentPackage().mainDocumentPart
    );
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;

    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: hostId,
        offset: 0,
        fragmentBytes: extracted.bytes,
        lastMarkCovered: true,
      }
    );
    expect(pasted.ok).toBe(true);

    const mid = store.currentPackage();
    expect([...mid.partBytes.keys()].some((name) => name.includes('/media/'))).toBe(true);
    expect(mid.parts.has('/word/footnotes.xml')).toBe(true);

    expect(store.undo()).not.toBeNull();
    const reverted = store.currentPackage();
    expect([...reverted.partBytes.keys()].sort()).toEqual(beforeParts);
    expect(reverted.parts.has('/word/footnotes.xml')).toBe(false);
    expect(normalizedBodySignatures(reverted, reverted.mainDocumentPart)).toEqual(beforeBody);
  });

  test('a target with different defaults gets the source look materialized', () => {
    // Synthetic source: Arial 12pt docDefaults, one unstyled run. NOTHING in either
    // document carries Arial explicitly, so the assertion below can only be satisfied by
    // materialization itself.
    const sourceStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '</w:styles>';
    const source = buildPackage('<w:p><w:r><w:t>materialize me</w:t></w:r></w:p>', {
      'word/styles.xml': sourceStyles,
    });
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    if (!extracted.ok) throw new Error('extract failed');

    const targetStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '</w:styles>';
    const target = buildPackage('<w:p/>', { 'word/styles.xml': targetStyles });
    const store = openStore(target);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;

    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 0, fragmentBytes: extracted.bytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(true);

    const documentXml = serializeOoxmlPart(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    expect(documentXml).toContain('materialize me');
    expect(documentXml).toContain('w:ascii="Arial"');
    expect(documentXml).toContain('<w:sz w:val="24"/>');
    // The imported default style must not become the TARGET's default.
    const stylesOut = serializeOoxmlPart(store.currentPackage().parts.get('/word/styles.xml')!);
    const defaultFlags = stylesOut.match(/w:default="1"/g) ?? [];
    expect(defaultFlags.length).toBe(1);
  });

  test('materialization never stamps over a value the travelling style chain defines', () => {
    // Source: docDefaults sz=20, Heading1 sz=32, a Heading1 paragraph with an unstyled
    // run. Target: a DIFFERENT Heading1 (forcing a Heading1Pasted remap) and other
    // defaults. The run resolves its size from the TRAVELLING style, so no default may
    // stamp — a stamped sz=20 would silently shrink the heading (round-2 HIGH).
    const sourceStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
      '</w:styles>';
    const source = buildPackage(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>HEAD</w:t></w:r></w:p>',
      { 'word/styles.xml': sourceStyles }
    );
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    if (!extracted.ok) throw new Error('extract failed');

    const targetStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:rPr><w:sz w:val="40"/></w:rPr></w:style>' +
      '</w:styles>';
    const target = buildPackage('<w:p/>', { 'word/styles.xml': targetStyles });
    const store = openStore(target);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 0, fragmentBytes: extracted.bytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(true);

    const documentXml = serializeOoxmlPart(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    expect(documentXml).toContain('w:val="Heading1Pasted"');
    // The heading run keeps resolving through its style: no stamped docDefault size.
    expect(documentXml.includes('<w:sz w:val="20"/>')).toBe(false);
  });

  test('an unstyled paragraph keeps the source default-style paragraph look', () => {
    // Source Normal centres paragraphs; target Normal right-aligns them. The source
    // default style does not travel with an unstyled paragraph, so its `w:jc` must stamp
    // as direct formatting (round-2 MEDIUM).
    const sourceStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:pPr><w:jc w:val="center"/></w:pPr></w:style>' +
      '</w:styles>';
    const source = buildPackage('<w:p><w:r><w:t>centred</w:t></w:r></w:p>', {
      'word/styles.xml': sourceStyles,
    });
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    if (!extracted.ok) throw new Error('extract failed');

    const targetStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:pPr><w:jc w:val="right"/></w:pPr></w:style>' +
      '</w:styles>';
    const target = buildPackage('<w:p/>', { 'word/styles.xml': targetStyles });
    const store = openStore(target);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 0, fragmentBytes: extracted.bytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(true);

    const documentXml = serializeOoxmlPart(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    expect(documentXml).toContain('centred');
    expect(documentXml).toContain('<w:jc w:val="center"/>');
  });

  test('a rich paste over a selection replaces it', () => {
    const fragment = buildPackage('<w:p><w:r><w:t>XX</w:t></w:r></w:p>');
    const fragmentBytes = zipSync(Object.fromEntries(fragment.partBytes));

    const target = buildPackage('<w:p><w:r><w:t>HelloWorld</w:t></w:r></w:p>');
    const store = openStore(target);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;

    // The surface's deleteSelectionPlan for selecting "World": one deleteText op.
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: hostId,
        offset: 5,
        fragmentBytes,
        lastMarkCovered: false,
        priorOps: [{ op: 'deleteText', paragraphId: hostId, start: 5, end: 10 }],
      }
    );
    expect(pasted.ok).toBe(true);
    // The splice may keep separate runs; the TEXT is what must read "HelloXX". Read it
    // from the tree's text values rather than de-tagging serialized XML with a regex.
    const part = store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!;
    let text = '';
    const collect = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') {
        text += node.value;
        return;
      }
      for (const child of node.children) collect(child);
    };
    collect(part.root);
    expect(text).toContain('HelloXX');
    expect(text.includes('World')).toBe(false);
  });

  test('footnote and endnote id namespaces stay separate across repeated pastes', () => {
    // Source: a footnote AND an endnote deliberately sharing id "2".
    const entries: Record<string, Uint8Array> = {
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId2" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rId3" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          '<w:r><w:t>text</w:t></w:r>' +
          '<w:r><w:footnoteReference w:id="2"/></w:r>' +
          '<w:r><w:endnoteReference w:id="2"/></w:r>' +
          '</w:p></w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:id="2"><w:p><w:r><w:t>FOOT-BODY</w:t></w:r></w:p></w:footnote>' +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
          '<w:endnote w:id="2"><w:p><w:r><w:t>END-BODY</w:t></w:r></w:p></w:endnote>' +
          '</w:endnotes>'
      ),
    };
    const source = loadPackage(zipSync(entries));
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    if (!extracted.ok) throw new Error('extract failed');

    const target = buildPackage('<w:p/>');
    const store = openStore(target);
    const hostOf = (): string =>
      paragraphIdsUnder(bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)).slice(
        -1
      )[0]!;

    for (const round of [1, 2]) {
      const pasted = store.applyFragmentPaste(
        { kind: 'body' },
        {
          paragraphId: hostOf(),
          offset: 0,
          fragmentBytes: extracted.bytes,
          lastMarkCovered: true,
        }
      );
      expect(pasted.ok).toBe(true);
      const after = store.currentPackage();
      // Every footnote reference in the body must resolve to FOOT-BODY, every endnote
      // reference to END-BODY - whatever round of pasting minted the ids.
      const footSigs = referencedNoteSignatures(after, after.mainDocumentPart, 'footnote');
      const endSigs = referencedNoteSignatures(after, after.mainDocumentPart, 'endnote');
      expect(footSigs.length).toBe(round);
      expect(endSigs.length).toBe(round);
      for (const signature of footSigs) expect(signature).toContain('FOOT-BODY');
      for (const signature of endSigs) expect(signature).toContain('END-BODY');
    }
  });

  test('conflicting style definitions import under a fresh id and derived name', () => {
    const fragmentStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
      '<w:rPr><w:i/></w:rPr></w:style>' +
      '</w:styles>';
    const fragmentPkg = buildPackage(
      '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>quoted</w:t></w:r></w:p>',
      { 'word/styles.xml': fragmentStyles }
    );
    // Re-zip the synthetic fragment as bytes for the paste lane.
    const fragmentBytes = (() => {
      const entries = new Map<string, Uint8Array>();
      for (const [name, bytes] of fragmentPkg.partBytes) entries.set(name, bytes);
      return zipSync(Object.fromEntries(entries));
    })();

    const targetStyles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
      '<w:rPr><w:b/></w:rPr></w:style>' +
      '</w:styles>';
    const target = buildPackage('<w:p/>', { 'word/styles.xml': targetStyles });
    const store = openStore(target);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;

    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 0, fragmentBytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(true);

    const after = store.currentPackage();
    const stylesOut = serializeOoxmlPart(after.parts.get('/word/styles.xml')!);
    expect(stylesOut).toContain('w:styleId="QuotePasted"');
    expect(stylesOut).toContain('Quote (pasted)');
    const documentXml = serializeOoxmlPart(after.parts.get(after.mainDocumentPart)!);
    expect(documentXml).toContain('w:val="QuotePasted"');
    // The target's own Quote definition is untouched.
    expect(stylesOut).toContain('<w:b/>');
  });

  test('mid-paragraph paste assigns paragraph marks like Word', () => {
    const fragment = buildPackage(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>ONE</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>TWO</w:t></w:r></w:p>'
    );
    const fragmentBytes = zipSync(Object.fromEntries(fragment.partBytes));

    const target = buildPackage(
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>headtail</w:t></w:r></w:p>'
    );
    const store = openStore(target);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;

    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 4, fragmentBytes, lastMarkCovered: false }
    );
    expect(pasted.ok).toBe(true);

    const part = store.currentPackage().parts.get(target.mainDocumentPart)!;
    const paragraphs = bodyOf(part).children.filter((child) => child.kind === 'paragraph');
    expect(paragraphs.length).toBe(2);
    const [leading, trailing] = paragraphs as [OoxmlElement, OoxmlElement];
    const textOf = (paragraph: OoxmlElement): string => {
      let text = '';
      const walk = (node: OoxmlNode): void => {
        if (node.kind === 'textValue') {
          text += node.value;
          return;
        }
        for (const child of node.children) walk(child);
      };
      walk(paragraph);
      return text;
    };
    // Leading merged paragraph: host head + fragment first content, fragment's mark.
    expect(textOf(leading)).toBe('headONE');
    expect(serializeOoxmlPart({ ...part, root: leading } as unknown as OoxmlPart)).toContain(
      'w:val="center"'
    );
    // Trailing merged paragraph: fragment last content + host tail, HOST's mark.
    expect(textOf(trailing)).toBe('TWOtail');
    expect(serializeOoxmlPart({ ...part, root: trailing } as unknown as OoxmlPart)).toContain(
      'w:val="right"'
    );
  });

  test('a table copied alone pastes alone, without a paragraph after it', () => {
    // The fragment body ends with the table, so its read adds a story-end paragraph. A fragment
    // is a run of blocks, not a story, so the paste drops that paragraph again.
    const table =
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const fragmentBytes = zipSync(Object.fromEntries(buildPackage(table).partBytes));
    const target = buildPackage('<w:p><w:r><w:t>hostAB</w:t></w:r></w:p>');
    const store = openStore(target);
    const body = () => bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!);
    const paragraphId = paragraphIdsUnder(body())[0]!;
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId, offset: 4, fragmentBytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(true);
    const blocks = body().children.filter((child) => child.kind !== 'generic');
    expect(blocks.map((child) => child.kind)).toEqual(['paragraph', 'table', 'paragraph']);
  });

  test.each(['drawingml', 'vml'])(
    'fragment %s media with a spoofed content type is dropped, not copied',
    (kind) => {
      // The fragment's own [Content_Types].xml claims image/png for bytes that are not a
      // PNG. The signature sniff is authoritative: the relationship drops, the drawing
      // degrades away, and no spoofed bytes land in the target package.
      const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
      const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
      const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
      const entries: Record<string, Uint8Array> = {
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="png" ContentType="image/png"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${R}/image" Target="media/image1.png"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
            '<w:body><w:p><w:r><w:t>keepme</w:t></w:r>' +
            '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
            '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name=""/>' +
            '<wp:cNvGraphicFramePr/>' +
            `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
            '<pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
            '<pic:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
            '</pic:pic></a:graphicData></a:graphic>' +
            '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
        ),
        'word/media/image1.png': strToU8('this is not a png at all, just text bytes'),
      };
      if (kind === 'vml') {
        const xml = new TextDecoder().decode(entries['word/document.xml']);
        entries['word/document.xml'] = strToU8(
          xml.replace(
            /<w:drawing>[\s\S]*?<\/w:drawing>/,
            '<w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape type="#_x0000_t75" style="width:72pt;height:72pt"><v:imagedata r:id="rId7"/></v:shape></w:pict>'
          )
        );
        const pkg = loadPackage(zipSync(entries));
        const extracted = extractFragmentPackage(pkg, fullBodyCoverage(pkg), { omitMedia: true });
        expect(extracted.ok).toBe(true);
        if (extracted.ok) {
          const stripped = loadPackage(extracted.bytes);
          expect(serializeOoxmlPart(stripped.parts.get(stripped.mainDocumentPart)!)).not.toContain(
            'w:pict'
          );
        }
      }
      const fragmentBytes = zipSync(entries);

      const target = buildPackage('<w:p/>');
      const store = openStore(target);
      const hostId = paragraphIdsUnder(
        bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
      )[0]!;
      const pasted = store.applyFragmentPaste(
        { kind: 'body' },
        { paragraphId: hostId, offset: 0, fragmentBytes, lastMarkCovered: true }
      );
      expect(pasted.ok).toBe(true);

      const after = store.currentPackage();
      // The text landed; the spoofed drawing and its bytes did not.
      const documentXml = serializeOoxmlPart(after.parts.get(after.mainDocumentPart)!);
      expect(documentXml).toContain('keepme');
      expect(documentXml.includes('w:drawing')).toBe(false);
      expect(documentXml.includes('w:pict')).toBe(false);
      expect([...after.partBytes.keys()].some((name) => name.includes('/media/'))).toBe(false);
    }
  );

  test('a fragment past the insert budget is refused before the merge runs', () => {
    // 50_001 body paragraphs: over MAX_FRAGMENT_INSERT_BLOCKS. The early budget walk
    // refuses it; the router then degrades instead of paying a full merge first.
    const paragraphs = Array.from({ length: 50_001 }, () => '<w:p/>').join('');
    const fragmentBytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${paragraphs}</w:body></w:document>`
      ),
    });

    const target = buildPackage('<w:p><w:r><w:t>untouched</w:t></w:r></w:p>');
    const store = openStore(target);
    const before = serializeOoxmlPart(store.currentPackage().parts.get(target.mainDocumentPart)!);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 0, fragmentBytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(false);
    // Which pre-merge gate fires first is an implementation detail: the bounded package
    // reader's own caps or the insert-budget walk. Either way the merge never ran.
    if (!pasted.ok) {
      expect(['fragment-over-budget', 'fragment-read:too-large']).toContain(pasted.detail ?? '');
    }
    expect(serializeOoxmlPart(store.currentPackage().parts.get(target.mainDocumentPart)!)).toBe(
      before
    );
  });

  test('an invalid fragment refuses atomically', () => {
    const target = buildPackage('<w:p><w:r><w:t>keep</w:t></w:r></w:p>');
    const store = openStore(target);
    const before = serializeOoxmlPart(store.currentPackage().parts.get(target.mainDocumentPart)!);
    const hostId = paragraphIdsUnder(
      bodyOf(store.currentPackage().parts.get(target.mainDocumentPart)!)
    )[0]!;

    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: hostId,
        offset: 0,
        fragmentBytes: strToU8('not a zip'),
        lastMarkCovered: false,
      }
    );
    expect(pasted.ok).toBe(false);
    expect(serializeOoxmlPart(store.currentPackage().parts.get(target.mainDocumentPart)!)).toBe(
      before
    );
  });
});
