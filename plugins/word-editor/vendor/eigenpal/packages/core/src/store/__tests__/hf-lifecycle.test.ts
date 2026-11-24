// Header/footer package lifecycle: create/delete/link/unlink/options + package undo.
//
// Pins atomic package mutations (part + rel + content-type + sectPr), GC of orphans,
// shared-reference preservation, first-section link refusal, inherited metadata, and
// save/reopen fingerprint/digest after structural package changes.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { canonicalOoxmlFingerprint } from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import {
  applyHeaderFooterLifecycleOp,
  type HeaderFooterLifecycleOp,
} from '../package/hf-lifecycle.ts';
import {
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
} from '../package/hf-references.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import type { TreeModelChange } from '../store/tree-store.ts';
import { openTreeSession } from '../../binding/tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly body?: string;
  readonly references?: string;
  readonly secondSectPr?: string;
  readonly rels?: string;
  readonly headerParts?: Record<string, string>;
  /** Extra zip entries under their package paths (e.g. header rels, media bytes). */
  readonly extraEntries?: Record<string, Uint8Array>;
  readonly overrides?: string;
  readonly defaults?: string;
  readonly settings?: string;
}): Uint8Array {
  const body =
    options.body ??
    (options.secondSectPr !== undefined
      ? `<w:p><w:pPr><w:sectPr>${options.references ?? ''}</w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        `<w:sectPr>${options.secondSectPr}</w:sectPr>`
      : '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        `<w:sectPr>${options.references ?? ''}</w:sectPr>`);
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        (options.defaults ?? '') +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.overrides ?? '') +
        (options.settings
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (options.rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${options.rels}</Relationships>`
    );
  }
  for (const [name, xml] of Object.entries(options.headerParts ?? {})) {
    entries[name] = strToU8(xml);
  }
  for (const [name, bytes] of Object.entries(options.extraEntries ?? {})) {
    entries[name] = bytes;
  }
  if (options.settings) entries['word/settings.xml'] = strToU8(options.settings);
  return zipSync(entries);
}

const HEADER_XML = (text: string): string =>
  `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`;
const HEADER_OVERRIDE =
  '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>';

function load(bytes: Uint8Array) {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function openStore(bytes: Uint8Array) {
  const pkg = load(bytes);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main);
}

const blankDoc = (): Uint8Array => build({});

const inheritedDoc = (): Uint8Array =>
  build({
    references: '<w:headerReference w:type="default" r:id="rId7"/>',
    secondSectPr: '',
    rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
    headerParts: { 'word/header1.xml': HEADER_XML('SHARED') },
    overrides: HEADER_OVERRIDE,
  });

const sharedDoc = (): Uint8Array =>
  build({
    references: '<w:headerReference w:type="default" r:id="rId7"/>',
    secondSectPr: '<w:headerReference w:type="default" r:id="rId7"/>',
    rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
    headerParts: { 'word/header1.xml': HEADER_XML('SHARED') },
    overrides: HEADER_OVERRIDE,
  });

describe('inherited-vs-declared resolution metadata', () => {
  test('declared slot reports inherited:false with rId', () => {
    const pkg = load(inheritedDoc());
    const resolution = resolveHeaderFooterResolutionBySection(pkg);
    expect(resolution).toHaveLength(2);
    const first = resolution[0]!.headers.get('default')!;
    expect(first.inherited).toBe(false);
    expect(first.rId).toBe('rId7');
    expect(first.partName).toBe('/word/header1.xml');
  });

  test('later section without a ref reports inherited:true', () => {
    const pkg = load(inheritedDoc());
    const resolution = resolveHeaderFooterResolutionBySection(pkg);
    const second = resolution[1]!.headers.get('default')!;
    expect(second.inherited).toBe(true);
    expect(second.rId).toBe('rId7');
    expect(second.partName).toBe('/word/header1.xml');
  });

  test('first section with no refs is blank, not inherited from a later section', () => {
    const pkg = load(
      build({
        references: '',
        secondSectPr: '<w:headerReference w:type="default" r:id="rId7"/>',
        rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
        headerParts: { 'word/header1.xml': HEADER_XML('LATER') },
        overrides: HEADER_OVERRIDE,
      })
    );
    const resolution = resolveHeaderFooterResolutionBySection(pkg);
    expect(resolution[0]!.headers.size).toBe(0);
    expect(resolution[1]!.headers.get('default')!.inherited).toBe(false);
    // Merged maps stay coherent.
    const parts = resolveHeaderFooterPartsBySection(pkg);
    expect(parts[0]!.headers.size).toBe(0);
    expect(parts[1]!.headers.get('default')!.name).toBe('/word/header1.xml');
  });
});

describe('createHeaderFooter', () => {
  test('allocates part, override, relationship, and sectPr reference', () => {
    const store = openStore(blankDoc());
    const changes: TreeModelChange[] = [];
    store.subscribe((c) => changes.push(c));

    const result = store.applyLifecycleOp({
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.change?.impact).toBe('global');
    expect(changes).toHaveLength(1);

    const pkg = store.currentPackage();
    expect(pkg.parts.has('/word/header1.xml')).toBe(true);
    expect(pkg.contentTypes.overrides.get('/word/header1.xml')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
    );
    const rels = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
    const headerRel = rels.find((rel) => rel.type.endsWith('/header'));
    expect(headerRel?.rawTarget).toBe('header1.xml');
    expect(headerRel?.rawTarget.includes('..')).toBe(false);

    const resolution = resolveHeaderFooterResolutionBySection(pkg);
    const slot = resolution[0]!.headers.get('default')!;
    expect(slot.inherited).toBe(false);
    expect(slot.rId).toBe(headerRel!.id);
  });

  test.each(['default', 'first', 'even'] as const)('creates %s variant', (variant) => {
    const store = openStore(blankDoc());
    const result = store.applyLifecycleOp({
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'footer',
      variant,
    });
    expect(result.ok).toBe(true);
    const slot = resolveHeaderFooterResolutionBySection(store.currentPackage())[0]!.footers.get(
      variant
    );
    expect(slot?.inherited).toBe(false);
  });

  test('refuses when the slot is already occupied', () => {
    const store = openStore(inheritedDoc());
    const beforeRev = store.packageRevision;
    const beforeParts = store.currentPackage().parts.size;
    const result = store.applyLifecycleOp({
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalidArgs');
    expect(store.packageRevision).toBe(beforeRev);
    expect(store.currentPackage().parts.size).toBe(beforeParts);
  });
});

describe('deleteHeaderFooter and GC', () => {
  test('deletes orphan part, relationship, and content-type override', () => {
    const store = openStore(inheritedDoc());
    const result = store.applyLifecycleOp({
      op: 'deleteHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(result.ok).toBe(true);
    const pkg = store.currentPackage();
    expect(pkg.parts.has('/word/header1.xml')).toBe(false);
    expect(pkg.contentTypes.overrides.has('/word/header1.xml')).toBe(false);
    const rels = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
    expect(rels.some((rel) => rel.id === 'rId7')).toBe(false);
    expect(resolveHeaderFooterResolutionBySection(pkg)[0]!.headers.size).toBe(0);
  });

  test('shared reference is preserved when another section still points at it', () => {
    const store = openStore(sharedDoc());
    const result = store.applyLifecycleOp({
      op: 'deleteHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(result.ok).toBe(true);
    const pkg = store.currentPackage();
    expect(pkg.parts.has('/word/header1.xml')).toBe(true);
    expect(pkg.contentTypes.overrides.has('/word/header1.xml')).toBe(true);
    const resolution = resolveHeaderFooterResolutionBySection(pkg);
    expect(resolution[0]!.headers.has('default')).toBe(false);
    expect(resolution[1]!.headers.get('default')!.inherited).toBe(false);
  });
});

describe('linkToPrevious / unlinkFromPrevious', () => {
  test('link on first section is refused with invalidArgs and no ModelChange', () => {
    const store = openStore(inheritedDoc());
    const changes: TreeModelChange[] = [];
    store.subscribe((c) => changes.push(c));
    const beforeRev = store.packageRevision;
    const result = store.applyLifecycleOp({
      op: 'linkToPrevious',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalidArgs');
    expect(changes).toHaveLength(0);
    expect(store.packageRevision).toBe(beforeRev);
  });

  test('unlink clones inherited content into an independent part', () => {
    const store = openStore(inheritedDoc());
    const result = store.applyLifecycleOp({
      op: 'unlinkFromPrevious',
      sectionIndex: 1,
      kind: 'header',
      variant: 'default',
    });
    expect(result.ok).toBe(true);
    const pkg = store.currentPackage();
    const resolution = resolveHeaderFooterResolutionBySection(pkg);
    const first = resolution[0]!.headers.get('default')!;
    const second = resolution[1]!.headers.get('default')!;
    expect(first.inherited).toBe(false);
    expect(second.inherited).toBe(false);
    expect(second.partName).not.toBe(first.partName);
    expect(pkg.parts.has(second.partName)).toBe(true);
    expect(pkg.contentTypes.overrides.has(second.partName.toLowerCase())).toBe(true);
  });

  test('link removes declared ref and GCs orphan', () => {
    const store = openStore(inheritedDoc());
    store.applyLifecycleOp({
      op: 'unlinkFromPrevious',
      sectionIndex: 1,
      kind: 'header',
      variant: 'default',
    });
    const clonedName = resolveHeaderFooterResolutionBySection(
      store.currentPackage()
    )[1]!.headers.get('default')!.partName;
    const linked = store.applyLifecycleOp({
      op: 'linkToPrevious',
      sectionIndex: 1,
      kind: 'header',
      variant: 'default',
    });
    expect(linked.ok).toBe(true);
    const pkg = store.currentPackage();
    expect(pkg.parts.has(clonedName)).toBe(false);
    expect(resolveHeaderFooterResolutionBySection(pkg)[1]!.headers.get('default')!.inherited).toBe(
      true
    );
  });

  test('unlink clones owned hyperlink and media relationships; save/reopen and GC hold', () => {
    const HYPERLINK = `${R}/hyperlink`;
    const IMAGE = `${R}/image`;
    // Story content only needs resolvable rIds; image rendering is out of scope.
    const headerWithRels =
      `<w:hdr xmlns:w="${W}" xmlns:r="${R}">` +
      '<w:p><w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>' +
      '<w:p><w:r><w:t>embed-rId2</w:t></w:r></w:p>' +
      '</w:hdr>';
    const store = openStore(
      build({
        references: '<w:headerReference w:type="default" r:id="rId7"/>',
        secondSectPr: '',
        rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
        headerParts: { 'word/header1.xml': headerWithRels },
        overrides: HEADER_OVERRIDE,
        defaults: '<Default Extension="png" ContentType="image/png"/>',
        extraEntries: {
          'word/_rels/header1.xml.rels': strToU8(
            `<Relationships xmlns="${REL}">` +
              `<Relationship Id="rId1" Type="${HYPERLINK}" Target="https://example.com/hf" TargetMode="External"/>` +
              `<Relationship Id="rId2" Type="${IMAGE}" Target="media/image1.png"/>` +
              '</Relationships>'
          ),
          // Bytes present so internal image target stays package-valid; rendering not claimed.
          'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        },
      })
    );

    const unlinked = store.applyLifecycleOp({
      op: 'unlinkFromPrevious',
      sectionIndex: 1,
      kind: 'header',
      variant: 'default',
    });
    expect(unlinked.ok).toBe(true);
    const live = store.currentPackage();
    const cloneName =
      resolveHeaderFooterResolutionBySection(live)[1]!.headers.get('default')!.partName;
    expect(cloneName).not.toBe('/word/header1.xml');

    const sourceRels = live.relationships.get('/word/header1.xml') ?? [];
    const cloneRels = live.relationships.get(cloneName) ?? [];
    expect(
      cloneRels.map((r) => ({ id: r.id, type: r.type, target: r.rawTarget, mode: r.targetMode }))
    ).toEqual(
      sourceRels.map((r) => ({ id: r.id, type: r.type, target: r.rawTarget, mode: r.targetMode }))
    );
    expect(cloneRels.map((r) => r.order)).toEqual(sourceRels.map((r) => r.order));

    const cloneExternal = live.externalTargets.filter((e) => e.ownerPart === cloneName);
    expect(
      cloneExternal.some((e) => e.id === 'rId1' && e.rawTarget === 'https://example.com/hf')
    ).toBe(true);
    const cloneRelsPart = `/word/_rels/${cloneName.slice('/word/'.length)}.rels`;
    expect(live.parts.has(cloneRelsPart)).toBe(true);

    const reopened = load(writeOoxmlPackage(live));
    const reopenedCloneRels = reopened.relationships.get(cloneName) ?? [];
    expect(
      reopenedCloneRels.map((r) => ({ id: r.id, target: r.rawTarget, mode: r.targetMode }))
    ).toEqual(cloneRels.map((r) => ({ id: r.id, target: r.rawTarget, mode: r.targetMode })));
    expect(
      reopened.externalTargets.some(
        (e) =>
          e.ownerPart === cloneName && e.id === 'rId1' && e.rawTarget === 'https://example.com/hf'
      )
    ).toBe(true);

    // Relinking GCs the clone part, its owned relationship map entry, and its .rels part.
    // Shell parking only remembers replacePackageShell-minted hyperlinks — lifecycle-cloned
    // owned rels travel in package history snapshots and must not resurrect after GC.
    expect(
      store.applyLifecycleOp({
        op: 'linkToPrevious',
        sectionIndex: 1,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    const afterGc = store.currentPackage();
    expect(afterGc.parts.has(cloneName)).toBe(false);
    expect(afterGc.parts.has(cloneRelsPart)).toBe(false);
    expect(afterGc.relationships.has(cloneName)).toBe(false);
    expect(afterGc.externalTargets.some((e) => e.ownerPart === cloneName)).toBe(false);
  });
});

describe('createHeaderFooter with titlePage / evenAndOddHeaders', () => {
  test('create+titlePage is one undo/redo unit', () => {
    const store = openStore(blankDoc());
    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'first',
        titlePage: true,
      }).ok
    ).toBe(true);
    const after = resolveHeaderFooterResolutionBySection(store.currentPackage())[0]!;
    expect(after.headers.get('first')?.inherited).toBe(false);
    expect(after.titlePage).toBe(true);

    store.undo();
    const undone = resolveHeaderFooterResolutionBySection(store.currentPackage())[0]!;
    expect(undone.headers.has('first')).toBe(false);
    expect(undone.titlePage).toBe(false);

    store.redo();
    const redone = resolveHeaderFooterResolutionBySection(store.currentPackage())[0]!;
    expect(redone.headers.get('first')?.inherited).toBe(false);
    expect(redone.titlePage).toBe(true);
  });

  test('create+evenAndOddHeaders is one undo unit', () => {
    const store = openStore(blankDoc());
    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'footer',
        variant: 'even',
        evenAndOddHeaders: true,
      }).ok
    ).toBe(true);
    expect(
      resolveHeaderFooterResolutionBySection(store.currentPackage())[0]!.evenAndOddHeaders
    ).toBe(true);
    store.undo();
    expect(
      resolveHeaderFooterResolutionBySection(store.currentPackage())[0]!.evenAndOddHeaders
    ).toBe(false);
  });
});

describe('setSectionFurnitureOptions', () => {
  test('writes titlePg and header/footer distances on the section', () => {
    const store = openStore(blankDoc());
    const result = store.applyLifecycleOp({
      op: 'setSectionFurnitureOptions',
      sectionIndex: 0,
      titlePage: true,
      headerDistanceTwips: 720,
      footerDistanceTwips: 720,
    });
    expect(result.ok).toBe(true);
    const section = resolveHeaderFooterPartsBySection(store.currentPackage())[0]!;
    expect(section.titlePage).toBe(true);
  });

  test('writes evenAndOddHeaders document-wide in settings', () => {
    const store = openStore(blankDoc());
    const result = store.applyLifecycleOp({
      op: 'setSectionFurnitureOptions',
      evenAndOddHeaders: true,
    });
    expect(result.ok).toBe(true);
    const pkg = store.currentPackage();
    expect(pkg.parts.has('/word/settings.xml')).toBe(true);
    expect(resolveHeaderFooterPartsBySection(pkg)[0]!.evenAndOddHeaders).toBe(true);
  });

  test('hostile distances and empty options are refused', () => {
    const store = openStore(blankDoc());
    const beforeRev = store.packageRevision;
    expect(store.applyLifecycleOp({ op: 'setSectionFurnitureOptions' }).ok).toBe(false);
    expect(
      store.applyLifecycleOp({
        op: 'setSectionFurnitureOptions',
        sectionIndex: 0,
        headerDistanceTwips: 999_999,
      }).ok
    ).toBe(false);
    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 99,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(false);
    expect(store.packageRevision).toBe(beforeRev);
  });
});

describe('package undo/redo and round-trip', () => {
  test('undo/redo restores the entire package atomically', () => {
    const store = openStore(blankDoc());
    store.applyLifecycleOp({
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(store.currentPackage().parts.has('/word/header1.xml')).toBe(true);
    store.undo();
    expect(store.currentPackage().parts.has('/word/header1.xml')).toBe(false);
    store.redo();
    expect(store.currentPackage().parts.has('/word/header1.xml')).toBe(true);
  });

  test('save/reopen preserves structural package changes; fingerprints hold', () => {
    const store = openStore(blankDoc());
    store.applyLifecycleOp({
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    store.applyLifecycleOp({
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'footer',
      variant: 'default',
    });
    const live = store.currentPackage();
    const headerFp = canonicalOoxmlFingerprint(live.parts.get('/word/header1.xml')!);
    const footerFp = canonicalOoxmlFingerprint(live.parts.get('/word/footer1.xml')!);
    const beforeDigest = semanticDigest([
      live.parts.get('/word/header1.xml')!,
      live.parts.get('/word/footer1.xml')!,
    ]);

    const reopened = load(writeOoxmlPackage(live));
    expect(canonicalOoxmlFingerprint(reopened.parts.get('/word/header1.xml')!)).toBe(headerFp);
    expect(canonicalOoxmlFingerprint(reopened.parts.get('/word/footer1.xml')!)).toBe(footerFp);
    expect(
      diffSemanticDigests(
        beforeDigest,
        semanticDigest([
          reopened.parts.get('/word/header1.xml')!,
          reopened.parts.get('/word/footer1.xml')!,
        ])
      )
    ).toEqual([]);
    expect(
      resolveHeaderFooterResolutionBySection(reopened)[0]!.headers.get('default')
    ).toBeTruthy();
  });

  test('single-part applyTreeOp refuses lifecycle ops', () => {
    const pkg = load(blankDoc());
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const result = applyTreeOp(main, {
      op: 'createHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalidArgs');
  });

  test('TreeDocxSession routes a lifecycle op and exposes resolution metadata', () => {
    const opened = openTreeSession(blankDoc());
    if (!opened.ok) throw new Error(opened.reason);
    const session = opened.session;
    const applied = session.applyTreeOps([
      { op: 'createHeaderFooter', sectionIndex: 0, kind: 'header', variant: 'default' },
    ]);
    expect(applied.committed).toBe(true);
    const resolution = session.headerFooterResolutionBySection();
    expect(resolution[0]!.headers.get('default')!.inherited).toBe(false);
  });
});

describe('pure applyHeaderFooterLifecycleOp rollback', () => {
  test('rejected op returns the same package reference', () => {
    const pkg = load(blankDoc());
    const op: HeaderFooterLifecycleOp = {
      op: 'linkToPrevious',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    };
    const result = applyHeaderFooterLifecycleOp(pkg, op);
    expect(result.ok).toBe(false);
  });
});
