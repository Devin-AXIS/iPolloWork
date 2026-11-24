// Note scan-boundary trust fixes: independent cascade budgets, resilient notes-part
// resolution, body-only insertNote, and honest diagnose truncation signaling.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync } from 'fflate';
import {
  applyNoteLifecycleOp,
  canonicalOoxmlFingerprint,
  cascadeDeletedNoteReferences,
  collectNoteReferences,
  collectPackageNoteReferences,
  createNoteReferenceScanBudget,
  diagnoseNoteReferences,
  findNoteById,
  MAX_NOTE_REFERENCE_PARTS,
  readOoxmlPackage,
  readOoxmlPart,
  resolveNotesPart,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/index.ts';
import { budgetedNoteScanMemoStats } from '../package/note-references.ts';
import { segmentsOf } from '../store/tree-op-segments.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly body?: string;
  readonly footnotes?: string;
  readonly endnotes?: string;
  readonly settings?: string;
  readonly rels?: string;
  readonly overrides?: string;
}): Uint8Array {
  const hasFn = options.footnotes !== undefined;
  const hasEn = options.endnotes !== undefined;
  const rels =
    options.rels ??
    [
      hasFn ? `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` : '',
      hasEn ? `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` : '',
      options.settings
        ? `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>`
        : '',
    ].join('');
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (hasFn
          ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          : '') +
        (hasEn
          ? '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>'
          : '') +
        (options.settings
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        (options.body ?? '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/>') +
        (options.body?.includes('sectPr') ? '' : '<w:sectPr/>') +
        '</w:body></w:document>'
    ),
  };
  if (rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    );
  }
  if (hasFn) {
    entries['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W}">${options.footnotes}</w:footnotes>`
    );
  }
  if (hasEn) {
    entries['word/endnotes.xml'] = strToU8(
      `<w:endnotes xmlns:w="${W}">${options.endnotes}</w:endnotes>`
    );
  }
  if (options.settings) entries['word/settings.xml'] = strToU8(options.settings);
  return zipSync(entries);
}

function load(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function firstParagraphId(pkg: OoxmlPackage): string {
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  const body = main.root.children.find((child) => child.kind === 'body')!;
  const p = body.children.find((child) => child.kind === 'paragraph')!;
  return p.id;
}

const seededNotes =
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="3"><w:p><w:r><w:t>three</w:t></w:r></w:p></w:footnote>`;

describe('cascadeDeletedNoteReferences independent budgets', () => {
  function measureVisited(pkg: OoxmlPackage): number {
    const budget = createNoteReferenceScanBudget(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    collectPackageNoteReferences(pkg, { budget, maxHits: Number.POSITIVE_INFINITY });
    expect(budget.truncated).toBe(false);
    return budget.visited;
  }

  test('each snapshot under cap but combined above shared cap succeeds', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const before = load(build({ body, footnotes: seededNotes }));
    // after: reference removed, body still present (cascade should delete the body).
    const afterBody = `<w:p><w:r><w:t>AZ</w:t></w:r></w:p>`;
    const after = load(build({ body: afterBody, footnotes: seededNotes }));

    const visitsBefore = measureVisited(before);
    const visitsAfter = measureVisited(after);
    // Cap that fits each snapshot alone but would fail if both charged one counter.
    const perSnapshotCap = Math.max(visitsBefore, visitsAfter);
    expect(visitsBefore + visitsAfter).toBeGreaterThan(perSnapshotCap);

    const sharedWouldFail = createNoteReferenceScanBudget(perSnapshotCap);
    collectPackageNoteReferences(before, {
      budget: sharedWouldFail,
      maxHits: Number.POSITIVE_INFINITY,
    });
    collectPackageNoteReferences(after, {
      budget: sharedWouldFail,
      maxHits: Number.POSITIVE_INFINITY,
    });
    expect(sharedWouldFail.truncated).toBe(true);

    const cascaded = cascadeDeletedNoteReferences(before, after, {
      beforeBudget: createNoteReferenceScanBudget(perSnapshotCap),
      afterBudget: createNoteReferenceScanBudget(perSnapshotCap),
    });
    expect(cascaded).not.toBeNull();
    expect(findNoteById(resolveNotesPart(cascaded!, 'footnote')!.root, 1)).toBeUndefined();
  });

  test('before snapshot over cap fails closed with after unchanged', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const before = load(build({ body, footnotes: seededNotes }));
    const after = load(
      build({ body: `<w:p><w:r><w:t>x</w:t></w:r></w:p>`, footnotes: seededNotes })
    );
    const afterFp = canonicalOoxmlFingerprint(resolveNotesPart(after, 'footnote')!);
    const cascaded = cascadeDeletedNoteReferences(before, after, {
      beforeBudget: createNoteReferenceScanBudget(1),
      afterBudget: createNoteReferenceScanBudget(20_000),
    });
    expect(cascaded).toBeNull();
    expect(canonicalOoxmlFingerprint(resolveNotesPart(after, 'footnote')!)).toBe(afterFp);
    expect(findNoteById(resolveNotesPart(after, 'footnote')!.root, 1)).toBeDefined();
  });

  test('after snapshot over cap fails closed with after unchanged', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const before = load(build({ body, footnotes: seededNotes }));
    const after = load(
      build({ body: `<w:p><w:r><w:t>x</w:t></w:r></w:p>`, footnotes: seededNotes })
    );
    const afterFp = canonicalOoxmlFingerprint(resolveNotesPart(after, 'footnote')!);
    const cascaded = cascadeDeletedNoteReferences(before, after, {
      beforeBudget: createNoteReferenceScanBudget(20_000),
      afterBudget: createNoteReferenceScanBudget(1),
    });
    expect(cascaded).toBeNull();
    expect(canonicalOoxmlFingerprint(resolveNotesPart(after, 'footnote')!)).toBe(afterFp);
  });
});

describe('resolveNotesPart continues past unusable matches', () => {
  test('External decoy then Internal resolves the Internal part', () => {
    const pkg = load(
      build({
        footnotes: seededNotes,
        rels:
          `<Relationship Id="rIdBad" Type="${R}/footnotes" Target="https://evil.example/fn.xml" TargetMode="External"/>` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>`,
      })
    );
    const notes = resolveNotesPart(pkg, 'footnote');
    expect(notes).not.toBeNull();
    expect(notes!.name).toBe('/word/footnotes.xml');
    expect(findNoteById(notes!.root, 1)).toBeDefined();
  });

  test('missing-target then good Internal resolves the good part', () => {
    const pkg = load(
      build({
        footnotes: seededNotes,
        rels:
          `<Relationship Id="rIdMissing" Type="${R}/footnotes" Target="missing-footnotes.xml"/>` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>`,
      })
    );
    expect(resolveNotesPart(pkg, 'footnote')?.name).toBe('/word/footnotes.xml');
  });

  test('only External / bad targets remain null', () => {
    const pkg = load(
      build({
        footnotes: seededNotes,
        rels:
          `<Relationship Id="rIdBad" Type="${R}/footnotes" Target="https://evil.example/fn.xml" TargetMode="External"/>` +
          `<Relationship Id="rIdMissing" Type="${R}/footnotes" Target="nope.xml"/>`,
      })
    );
    // footnotes.xml bytes exist but no usable Internal relationship points at them.
    expect(resolveNotesPart(pkg, 'footnote')).toBeNull();
  });
});

describe('insertNote body-only story gate', () => {
  test('refuses header paragraph with package unchanged', () => {
    const withHeader = build({
      body:
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        `<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>`,
      rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    });
    const unzipped = unzipSync(withHeader);
    unzipped['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>hdr</w:t></w:r></w:p></w:hdr>`
    );
    const pkg = load(zipSync(unzipped));
    const header = pkg.parts.get('/word/header1.xml')!;
    const headerPara = header.root.children.find((child) => child.kind === 'paragraph')!;
    const beforeMain = canonicalOoxmlFingerprint(pkg.parts.get(pkg.mainDocumentPart)!);
    const beforeHeader = canonicalOoxmlFingerprint(header);

    const refused = applyNoteLifecycleOp(pkg, {
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId: headerPara.id,
      offset: 0,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected refusal');
    expect(refused.detail).toBe('story-not-body');
    expect(resolveNotesPart(pkg, 'footnote')).toBeNull();
    expect(canonicalOoxmlFingerprint(pkg.parts.get(pkg.mainDocumentPart)!)).toBe(beforeMain);
    expect(canonicalOoxmlFingerprint(pkg.parts.get('/word/header1.xml')!)).toBe(beforeHeader);
  });

  test('refuses note-body paragraph with package unchanged', () => {
    const pkg = load(build({ footnotes: seededNotes }));
    const notes = resolveNotesPart(pkg, 'footnote')!;
    const note = findNoteById(notes.root, 1)!;
    const notePara = note.children.find((child) => child.kind === 'paragraph')!;
    const beforeNotes = canonicalOoxmlFingerprint(notes);
    const beforeMain = canonicalOoxmlFingerprint(pkg.parts.get(pkg.mainDocumentPart)!);

    const refused = applyNoteLifecycleOp(pkg, {
      op: 'insertNote',
      noteKind: 'endnote',
      paragraphId: notePara.id,
      offset: 0,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected refusal');
    expect(refused.detail).toBe('story-not-body');
    expect(resolveNotesPart(pkg, 'endnote')).toBeNull();
    expect(canonicalOoxmlFingerprint(resolveNotesPart(pkg, 'footnote')!)).toBe(beforeNotes);
    expect(canonicalOoxmlFingerprint(pkg.parts.get(pkg.mainDocumentPart)!)).toBe(beforeMain);
  });

  test('body paragraph insertion still succeeds', () => {
    const pkg = load(build({}));
    const paragraphId = firstParagraphId(pkg);
    const result = applyNoteLifecycleOp(pkg, {
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.noteId).toBe(1);
    expect(resolveNotesPart(result.package, 'footnote')).not.toBeNull();
  });

  test('deleteNote still removes references that live in a header', () => {
    const withHeader = build({
      body: '<w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr/>',
      footnotes: seededNotes,
      rels:
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    });
    const unzipped = unzipSync(withHeader);
    unzipped['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:hdr>`
    );
    const pkg = load(zipSync(unzipped));
    const result = applyNoteLifecycleOp(pkg, {
      op: 'deleteNote',
      noteKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(findNoteById(resolveNotesPart(result.package, 'footnote')!.root, 1)).toBeUndefined();
    expect(collectNoteReferences(result.package.parts.get('/word/header1.xml')!)).toHaveLength(0);
  });
});

describe('diagnoseNoteReferences truncation signal', () => {
  function padPart(name: string): OoxmlPart {
    const read = readOoxmlPart(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>pad</w:t></w:r></w:p></w:hdr>`,
      {
        name,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      }
    );
    if (!read.ok) throw new Error(read.reason);
    return read.part;
  }

  function prependPaddingParts(pkg: OoxmlPackage, count: number): OoxmlPackage {
    const parts = new Map<string, OoxmlPart>();
    for (let i = 0; i < count; i += 1) {
      const name = `/word/_pad${i}.xml`;
      parts.set(name, padPart(name));
    }
    for (const [name, part] of pkg.parts) parts.set(name, part);
    return { ...pkg, parts };
  }

  test('signals truncation when part budget stops before a dangling body ref', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="99"/></w:r></w:p>`;
    const base = load(build({ body }));
    const padded = prependPaddingParts(base, MAX_NOTE_REFERENCE_PARTS);
    // diagnose uses the production part cap, so MAX_NOTE_REFERENCE_PARTS padding parts
    // alone exhaust it before document.xml.
    const diagnostics = diagnoseNoteReferences(padded);
    expect(diagnostics.some((d) => d.code === 'note-reference-scan-truncated')).toBe(true);
    expect(diagnostics.every((d) => d.code !== 'dangling-note-reference' || d.noteId !== 99)).toBe(
      true
    );
  });

  test('reports ordinary dangling refs and does not mutate the package', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="99"/></w:r></w:p>`;
    const pkg = load(build({ body }));
    const beforeFp = canonicalOoxmlFingerprint(pkg.parts.get(pkg.mainDocumentPart)!);
    const diagnostics = diagnoseNoteReferences(pkg);
    expect(diagnostics.some((d) => d.code === 'dangling-note-reference' && d.noteId === 99)).toBe(
      true
    );
    expect(diagnostics.some((d) => d.code === 'note-reference-scan-truncated')).toBe(false);
    expect(canonicalOoxmlFingerprint(pkg.parts.get(pkg.mainDocumentPart)!)).toBe(beforeFp);
  });

  test('still reports pre-truncation dangling hits when early parts contain them', () => {
    const body = `<w:p><w:r><w:t>late</w:t></w:r></w:p>`;
    const base = load(build({ body }));
    const early = readOoxmlPart(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:footnoteReference w:id="77"/></w:r></w:p></w:hdr>`,
      {
        name: '/word/_early.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      }
    );
    if (!early.ok) throw new Error(early.reason);
    const parts = new Map<string, OoxmlPart>();
    parts.set('/word/_early.xml', early.part);
    for (let i = 0; i < MAX_NOTE_REFERENCE_PARTS; i += 1) {
      const name = `/word/_pad${i}.xml`;
      parts.set(name, padPart(name));
    }
    for (const [name, part] of base.parts) parts.set(name, part);
    const padded = { ...base, parts };
    const diagnostics = diagnoseNoteReferences(padded);
    expect(diagnostics.some((d) => d.code === 'dangling-note-reference' && d.noteId === 77)).toBe(
      true
    );
    expect(diagnostics.some((d) => d.code === 'note-reference-scan-truncated')).toBe(true);
  });
});

function loadDocumentPart(bodyInner: string): OoxmlPart {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}<w:sectPr/></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

describe('budget-free scans share the budgeted walk', () => {
  function refParagraph(id: number): string {
    return `<w:p><w:r><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
  }

  test('finite maxHits without a budget returns the document-order prefix', () => {
    const part = loadDocumentPart(refParagraph(1) + refParagraph(2) + refParagraph(3));
    const all = collectNoteReferences(part);
    expect(all.map((hit) => hit.noteId)).toEqual([1, 2, 3]);
    const clipped = collectNoteReferences(structuredClone(part), { maxHits: 2 });
    expect(JSON.stringify(clipped)).toBe(JSON.stringify(all.slice(0, 2)));
  });

  test('an unchanged part answers warm budget-free scans by identity', () => {
    const part = loadDocumentPart(refParagraph(1) + refParagraph(2));
    collectNoteReferences(part); // cold walk memoizes the root
    const warm = collectNoteReferences(part);
    expect(warm.map((hit) => hit.noteId)).toEqual([1, 2]);
    expect(collectNoteReferences(part)).toBe(warm);
    expect(Object.isFrozen(warm)).toBe(true);
    // A clip below the cached hit count serves a warm slice with the same prefix.
    const clippedWarm = collectNoteReferences(part, { maxHits: 1 });
    expect(JSON.stringify(clippedWarm)).toBe(JSON.stringify(warm.slice(0, 1)));
  });

  test('depth past 64 prunes budget-free scans but fails budgeted scans closed', () => {
    // A >64-deep generic chain between two shallow references. Budget-free (layout)
    // scans prune the deep subtree and keep the trailing reference; budgeted (mutation)
    // scans mark the shared budget truncated and stop, so callers refuse atomically.
    const deepChain = '<w:x>'.repeat(70) + '</w:x>'.repeat(70);
    const part = loadDocumentPart(refParagraph(1) + deepChain + refParagraph(2));

    // A truncated budgeted scan first must not poison the later budget-free walk.
    const preBudget = createNoteReferenceScanBudget(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    collectNoteReferences(part, { budget: preBudget, maxHits: Number.POSITIVE_INFINITY });
    expect(preBudget.truncated).toBe(true);

    const budgetFree = collectNoteReferences(part);
    expect(budgetFree.map((hit) => hit.noteId)).toEqual([1, 2]);

    // The pruned scan warmed the memos on this exact part; the budgeted walk over the
    // SAME nodes must still fail closed — no entry may stand in for the pruned region.
    const budget = createNoteReferenceScanBudget(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    const budgeted = collectNoteReferences(part, { budget, maxHits: Number.POSITIVE_INFINITY });
    expect(budget.truncated).toBe(true);
    expect(budgeted.map((hit) => hit.noteId)).toEqual([1]);

    const coldBudget = createNoteReferenceScanBudget(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    const coldBudgeted = collectNoteReferences(structuredClone(part), {
      budget: coldBudget,
      maxHits: Number.POSITIVE_INFINITY,
    });
    expect(JSON.stringify(budgeted)).toBe(JSON.stringify(coldBudgeted));
    expect(budget.visited).toBe(coldBudget.visited);

    // Warm budget-free scans agree with the cold pruned walk.
    expect(JSON.stringify(collectNoteReferences(part))).toBe(
      JSON.stringify(collectNoteReferences(structuredClone(part)))
    );
  });

  test('a paragraph re-parented deeper still serves its memo with budgeted parity', () => {
    const flat = loadDocumentPart(refParagraph(1) + refParagraph(2));
    collectNoteReferences(flat); // memoize the paragraph entries at their flat depth
    const flatBody = flat.root.children.find((child) => child.kind === 'body')!;
    const shared = flatBody.children.filter((child) => child.kind === 'paragraph');
    expect(shared).toHaveLength(2);

    // Rebuild a second part holding the SAME paragraph node objects six generic
    // wrapper levels deeper. Spreads keep realistic node shapes; the memo keys on
    // object identity, and paragraph answers must be depth-invariant.
    const shell = loadDocumentPart('<w:x>'.repeat(6) + '</w:x>'.repeat(6));
    const shellBody = shell.root.children.find((child) => child.kind === 'body')!;
    const chain: OoxmlNode[] = [];
    let cursor = shellBody.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'x'
    );
    while (cursor && cursor.kind !== 'textValue') {
      chain.push(cursor);
      cursor = cursor.children.find(
        (child) => child.kind !== 'textValue' && child.localName === 'x'
      );
    }
    expect(chain).toHaveLength(6);
    let rebuilt = { ...chain[5]!, children: shared } as OoxmlNode;
    for (let level = 4; level >= 0; level -= 1) {
      rebuilt = { ...chain[level]!, children: [rebuilt] } as OoxmlNode;
    }
    const deepBody = {
      ...shellBody,
      children: shellBody.children.map((child) => (child === chain[0] ? rebuilt : child)),
    } as typeof shellBody;
    const deepRoot = {
      ...shell.root,
      children: shell.root.children.map((child) => (child === shellBody ? deepBody : child)),
    } as typeof shell.root;
    const deepPart: OoxmlPart = { ...shell, root: deepRoot };

    const reusesBefore = budgetedNoteScanMemoStats.reuses;
    const warmBudget = createNoteReferenceScanBudget(1_000_000);
    const warmHits = collectNoteReferences(deepPart, {
      budget: warmBudget,
      maxHits: Number.POSITIVE_INFINITY,
    });
    const coldBudget = createNoteReferenceScanBudget(1_000_000);
    const coldHits = collectNoteReferences(structuredClone(deepPart), {
      budget: coldBudget,
      maxHits: Number.POSITIVE_INFINITY,
    });
    expect(warmHits.map((hit) => hit.noteId)).toEqual([1, 2]);
    expect(JSON.stringify(warmHits)).toBe(JSON.stringify(coldHits));
    expect(warmBudget.visited).toBe(coldBudget.visited);
    expect(warmBudget.truncated).toBe(false);
    expect(coldBudget.truncated).toBe(false);
    // Anti-vacuity: both flat-depth paragraph entries served at the deeper depth.
    expect(budgetedNoteScanMemoStats.reuses - reusesBefore).toBeGreaterThanOrEqual(2);
  });
});

describe('collectNoteReferences atomOffset matches segmentsOf', () => {
  function findParagraph(node: OoxmlNode): OoxmlParagraphNode | null {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const found = findParagraph(child);
      if (found) return found;
    }
    return null;
  }

  function loadParagraph(bodyInner: string): {
    readonly part: OoxmlPart;
    readonly paragraph: OoxmlParagraphNode;
  } {
    const part = loadDocumentPart(bodyInner);
    const paragraph = findParagraph(part.root);
    if (!paragraph) throw new Error('missing paragraph');
    return { part, paragraph };
  }

  function assertHitsMatchSegments(part: OoxmlPart, paragraph: OoxmlParagraphNode): void {
    const hits = collectNoteReferences(part);
    const segments = segmentsOf(paragraph);
    for (const hit of hits) {
      expect(hit.paragraphId).toBe(paragraph.id);
      const segment = segments.find((entry) => entry.node.id === hit.nodeId);
      expect(segment).toBeDefined();
      expect(segment!.start).toBe(hit.atomOffset);
      expect(segment!.node.kind).toBe('noteReference');
    }
  }

  test('run-inner SDT generic wrapper does not create a false addressable hit', () => {
    const { part, paragraph } = loadParagraph(
      `<w:p><w:r><w:t>A</w:t>` +
        `<w:sdt><w:sdtContent><w:footnoteReference w:id="1"/></w:sdtContent></w:sdt>` +
        `<w:t>Z</w:t></w:r></w:p>`
    );
    const hits = collectNoteReferences(part);
    expect(hits).toHaveLength(0);
    expect(segmentsOf(paragraph).some((segment) => segment.node.kind === 'noteReference')).toBe(
      false
    );
    expect(segmentsOf(paragraph).reduce((max, segment) => Math.max(max, segment.end), 0)).toBe(2);
    assertHitsMatchSegments(part, paragraph);
  });

  test('demoted/malformed reference before a typed ref does not shift the valid offset', () => {
    const { part, paragraph } = loadParagraph(
      `<w:p><w:r><w:t>A</w:t><w:footnoteReference/><w:t>Z</w:t>` +
        `<w:footnoteReference w:id="2"/></w:r></w:p>`
    );
    const hits = collectNoteReferences(part);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.noteId).toBe(2);
    expect(hits[0]!.atomOffset).toBe(2);
    const noteSegment = segmentsOf(paragraph).find(
      (segment) => segment.node.kind === 'noteReference'
    );
    expect(noteSegment?.start).toBe(2);
    assertHitsMatchSegments(part, paragraph);
  });

  test('hyperlink typed note ref remains at the correct offset', () => {
    const { part, paragraph } = loadParagraph(
      `<w:p><w:r><w:t>A</w:t></w:r>` +
        `<w:hyperlink w:anchor="here"><w:r><w:footnoteReference w:id="1"/></w:r></w:hyperlink>` +
        `<w:r><w:t>Z</w:t></w:r></w:p>`
    );
    const hits = collectNoteReferences(part);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.atomOffset).toBe(1);
    assertHitsMatchSegments(part, paragraph);
  });

  test('every collected hit nodeId/start matches a segmentsOf segment', () => {
    const { part, paragraph } = loadParagraph(
      `<w:p><w:r><w:t>Hi</w:t><w:footnoteReference w:id="1"/><w:t>!</w:t></w:r>` +
        `<w:hyperlink w:anchor="x"><w:r><w:endnoteReference w:id="3"/></w:r></w:hyperlink></w:p>`
    );
    const hits = collectNoteReferences(part);
    expect(hits.map((hit) => [hit.noteKind, hit.noteId, hit.atomOffset])).toEqual([
      ['footnote', 1, 2],
      ['endnote', 3, 4],
    ]);
    assertHitsMatchSegments(part, paragraph);
  });

  test('deleteNote / convertNote still operate on typed body and hyperlink refs', () => {
    const body =
      `<w:p><w:r><w:t>A</w:t></w:r>` +
      `<w:hyperlink w:anchor="here"><w:r><w:footnoteReference w:id="1"/></w:r></w:hyperlink>` +
      `<w:r><w:t>Z</w:t><w:footnoteReference w:id="3"/></w:r></w:p>`;
    const pkg = load(
      build({
        body,
        footnotes: seededNotes,
        endnotes:
          `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>`,
      })
    );
    const converted = applyNoteLifecycleOp(pkg, {
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(converted.ok).toBe(true);
    if (!converted.ok) throw new Error(converted.reason);
    const afterConvert = collectNoteReferences(
      converted.package.parts.get(converted.package.mainDocumentPart)!
    );
    expect(afterConvert.some((hit) => hit.noteKind === 'endnote' && hit.atomOffset === 1)).toBe(
      true
    );

    const deleted = applyNoteLifecycleOp(converted.package, {
      op: 'deleteNote',
      noteKind: 'footnote',
      noteId: 3,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error(deleted.reason);
    expect(findNoteById(resolveNotesPart(deleted.package, 'footnote')!.root, 3)).toBeUndefined();
    const remaining = collectNoteReferences(
      deleted.package.parts.get(deleted.package.mainDocumentPart)!
    );
    expect(remaining.every((hit) => hit.noteId !== 3)).toBe(true);
  });
});
