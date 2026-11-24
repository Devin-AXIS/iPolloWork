// `setNoteProperties` writes where note properties resolve from: every section's `w:sectPr` for a
// document-scope write, and settings.xml for the document-wide endnote position.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  serializeOoxmlPart,
  writeOoxmlPackage,
  type OoxmlPackage,
  type TreeDocOp,
} from '../package/index.ts';
import { collectSectionPropertyNodes } from '../package/hf-references.ts';
import {
  authoredDocumentEndnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../package/note-properties.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function open(body: string, settings: string): TreePackageStore {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return new TreePackageStore(
    loaded.package,
    loaded.package.parts.get(loaded.package.mainDocumentPart)!
  );
}

function apply(
  store: TreePackageStore,
  op: Omit<Extract<TreeDocOp, { op: 'setNoteProperties' }>, 'op'>
) {
  const result = store.applyLifecycleOp({ op: 'setNoteProperties', ...op });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}

function sectPrs(pkg: OoxmlPackage) {
  return collectSectionPropertyNodes(pkg.parts.get(pkg.mainDocumentPart)!.root);
}

const settingsXml = (pkg: OoxmlPackage) => serializeOoxmlPart(settingsPartOf(pkg)!);

const TWO_SECTIONS =
  '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>' +
  '<w:p><w:r><w:t>Last</w:t></w:r></w:p>';

describe('a document-scope note properties write', () => {
  test('gives an implicit final section a sectPr holding only the note properties', () => {
    const store = open(TWO_SECTIONS, '');
    expect(sectPrs(store.currentPackage())[1]).toBeNull();
    apply(store, { scope: 'document', footnote: { numFmt: 'upperRoman' } });
    const nodes = sectPrs(store.currentPackage());
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(resolveFootnoteProperties(authoredFootnotePropertiesFromSectPr(node)).numFmt).toBe(
        'upperRoman'
      );
    }
    expect(nodes[1]!.children.map((child) => (child as { localName: string }).localName)).toEqual([
      'footnotePr',
    ]);
  });

  test('keeps the separator references settings.xml lists inside its note properties', () => {
    const store = open(
      TWO_SECTIONS,
      '<w:footnotePr><w:numFmt w:val="chicago"/><w:footnote w:id="-1"/><w:footnote w:id="0"/>' +
        '</w:footnotePr>'
    );
    apply(store, { scope: 'document', footnote: { numFmt: 'decimal' } });
    expect(settingsXml(store.currentPackage())).toContain(
      '<w:footnotePr><w:numFmt w:val="decimal"/><w:footnote w:id="-1"/><w:footnote w:id="0"/>' +
        '</w:footnotePr>'
    );
  });

  test('undoes the sections and settings.xml together', () => {
    const store = open(TWO_SECTIONS, '<w:compat/>');
    const before = store.currentPackage();
    apply(store, { scope: 'document', endnote: { numFmt: 'decimal', position: 'sectEnd' } });
    store.undo();
    const undone = store.currentPackage();
    expect(settingsXml(undone)).toBe(settingsXml(before));
    expect(sectPrs(undone)[1]).toBeNull();
    expect(authoredEndnotePropertiesFromSectPr(sectPrs(undone)[0])).toBeUndefined();
    store.redo();
    expect(
      resolveEndnoteProperties(
        authoredEndnotePropertiesFromSectPr(sectPrs(store.currentPackage())[1]),
        authoredDocumentEndnoteProperties(settingsPartOf(store.currentPackage()))
      )
    ).toEqual({ pos: 'sectEnd', numFmt: 'decimal', numStart: 1, numRestart: 'continuous' });
  });
});

describe('a section-scope endnote position write', () => {
  test('reaches settings.xml, keeping its other endnote properties', () => {
    const store = open(
      TWO_SECTIONS,
      '<w:endnotePr><w:numFmt w:val="upperLetter"/><w:endnote w:id="-1"/></w:endnotePr><w:compat/>'
    );
    apply(store, { scope: 'section', sectionIndex: 0, endnote: { position: 'sectEnd' } });
    expect(settingsXml(store.currentPackage())).toContain(
      '<w:endnotePr><w:pos w:val="sectEnd"/><w:numFmt w:val="upperLetter"/>' +
        '<w:endnote w:id="-1"/></w:endnotePr><w:compat/>'
    );
    // The endnote position is document-wide, so the other section moves with it.
    const settings = authoredDocumentEndnoteProperties(settingsPartOf(store.currentPackage()));
    expect(resolveEndnoteProperties(undefined, settings).pos).toBe('sectEnd');
  });

  test('without a position leaves settings.xml alone', () => {
    const store = open(TWO_SECTIONS, '<w:endnotePr><w:pos w:val="docEnd"/></w:endnotePr>');
    const before = settingsXml(store.currentPackage());
    apply(store, { scope: 'section', sectionIndex: 0, endnote: { numFmt: 'decimal' } });
    expect(settingsXml(store.currentPackage())).toBe(before);
  });
});

// Two peers that each add the element a section lacked leave two copies in shared state.
// Every reader uses the first copy and the first occurrence of each field in it; the next write
// and every save drop the rest, so what the document shows does not change.
describe('repeated note properties', () => {
  // The first copy repeats numFmt; the second adds numStart and a restart no reader sees.
  const REPEATED =
    '<w:p><w:pPr><w:sectPr>' +
    '<w:footnotePr><w:numFmt w:val="lowerRoman"/><w:numFmt w:val="upperRoman"/></w:footnotePr>' +
    '<w:footnotePr><w:numStart w:val="5"/><w:numRestart w:val="eachSect"/></w:footnotePr>' +
    '<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>' +
    '<w:p><w:r><w:t>Last</w:t></w:r></w:p><w:sectPr/>';
  const SETTINGS =
    '<w:endnotePr><w:numFmt w:val="decimal"/></w:endnotePr>' +
    '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>';
  const mainXml = (pkg: OoxmlPackage) => serializeOoxmlPart(pkg.parts.get(pkg.mainDocumentPart)!);
  const resolved = (pkg: OoxmlPackage) => {
    const settings = authoredDocumentEndnoteProperties(settingsPartOf(pkg));
    return sectPrs(pkg).map((sectPr) => ({
      footnote: resolveFootnoteProperties(authoredFootnotePropertiesFromSectPr(sectPr)),
      endnote: resolveEndnoteProperties(authoredEndnotePropertiesFromSectPr(sectPr), settings),
    }));
  };
  const savedAndReopened = (store: TreePackageStore) => {
    const reread = readOoxmlPackage(writeOoxmlPackage(store.currentPackage()));
    if (!reread.ok) throw new Error(reread.reason);
    return reread.package;
  };

  test('a source file saved unedited reads the same and keeps only the first copies', () => {
    const store = open(REPEATED, SETTINGS);
    const before = resolved(store.currentPackage());
    expect(before[0]!.footnote).toEqual({
      pos: 'pageBottom',
      numFmt: 'lowerRoman',
      numStart: 1,
      numRestart: 'continuous',
    });
    expect(before[0]!.endnote.pos).toBe('docEnd');
    const liveXml = mainXml(store.currentPackage());
    const saved = savedAndReopened(store);
    expect(resolved(saved)).toEqual(before);
    expect(mainXml(saved)).toContain(
      '<w:sectPr><w:footnotePr><w:numFmt w:val="lowerRoman"/></w:footnotePr><w:pgSz'
    );
    expect(settingsXml(saved)).toContain(
      '<w:endnotePr><w:numFmt w:val="decimal"/></w:endnotePr></w:settings>'
    );
    // Save rewrites only the file; the document state is as it was.
    expect(mainXml(store.currentPackage())).toBe(liveXml);
  });

  test('the next write keeps the first copy whole and merges into it', () => {
    const store = open(REPEATED, '');
    apply(store, { scope: 'document', footnote: { numRestart: 'eachSect' } });
    expect(mainXml(store.currentPackage())).toContain(
      '<w:sectPr><w:footnotePr><w:numFmt w:val="lowerRoman"/>' +
        '<w:numRestart w:val="eachSect"/></w:footnotePr><w:pgSz'
    );
    expect(resolved(store.currentPackage())[0]!.footnote.numStart).toBe(1);
  });
});
