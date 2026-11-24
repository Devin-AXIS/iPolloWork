// A warm footnote pass publishes the pages a fresh pass does (issue #1761).
//
// The reserve of a page and its body decide each other, and more than one reserve can agree
// with its own body. These seeded documents mix keep-with-next, widow control, space after
// and notes of one to six lines on a small page, then take typed edits one at a time. After
// each edit, a pass over the retained session must publish exactly the pages that a pass with
// no session publishes over the same tree. That holds after a pass that a newer edit cut
// short, and after an edit to a separator that a file numbers like an ordinary note.
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { TreeDocumentStore } from '../../store/index.ts';
import type { OoxmlElement, OoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument, layoutSemanticDocumentSteps } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const EXACT = '<w:spacing w:line="240" w:lineRule="exact"';
const INDENTS = ['', '', '<w:ind w:left="720"/>', '<w:ind w:left="720" w:hanging="360"/>'];

function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

interface DocumentShape {
  /** The least number of paragraphs; up to 39 more follow. */
  readonly minCount?: number;
  /** The ids of the separator and the continuation separator. */
  readonly separatorIds?: readonly [number, number];
  /**
   * A section break every 15 paragraphs. Every second section starts on an odd page, so
   * some breaks add a blank sheet, and sets two columns.
   */
  readonly sections?: boolean;
  /**
   * The share of paragraphs that a two-column table follows. Its rows may repeat as a header
   * or refuse to split, and its cells cite notes.
   */
  readonly tables?: number;
}

const PAGE =
  '<w:pgSz w:w="4000" w:h="6000"/>' +
  '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0"/>';

function documentBytes(next: () => number, shape: DocumentShape = {}): Uint8Array {
  const count = (shape.minCount ?? 20) + Math.floor(next() * 40);
  const [separatorId, continuationId] = shape.separatorIds ?? [-1, 0];
  const notes: number[] = [];
  const body: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const words = 1 + Math.floor(next() * 30);
    const indent = INDENTS[Math.floor(next() * INDENTS.length)]!;
    const keepNext = next() < 0.2 ? '<w:keepNext/>' : '';
    const widow = next() < 0.5 ? 1 : 0;
    const after = [0, 0, 6, 10][Math.floor(next() * 4)]! * 20;
    let cite = '';
    if (next() < 0.25) {
      notes.push(1 + Math.floor(next() * 6));
      const id = notes.length + Math.max(0, continuationId);
      cite = `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
    }
    const text = Array.from({ length: words }, (_, k) => `w${i}x${k}`).join(' ');
    if (shape.tables && next() < shape.tables) {
      const rows = 2 + Math.floor(next() * 8);
      const header = next() < 0.5 ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
      let markup = '';
      for (let r = 0; r < rows; r += 1) {
        const cantSplit = next() < 0.3 ? '<w:trPr><w:cantSplit/></w:trPr>' : '';
        let cells = '';
        for (let c = 0; c < 2; c += 1) {
          let cellCite = '';
          if (next() < 0.3) {
            notes.push(1 + Math.floor(next() * 6));
            const id = notes.length + Math.max(0, continuationId);
            cellCite = `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;
          }
          const length = 1 + Math.floor(next() * 40);
          const cellText = Array.from({ length }, (_, k) => `c${i}r${r}k${k}`).join(' ');
          cells +=
            '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
            `<w:p><w:pPr>${EXACT} w:after="0"/></w:pPr>` +
            `<w:r><w:t xml:space="preserve">${cellText}</w:t></w:r>${cellCite}</w:p></w:tc>`;
        }
        markup += `<w:tr>${r === 0 ? header : cantSplit}${cells}</w:tr>`;
      }
      body.push(
        '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
          `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${markup}</w:tbl>`
      );
    }
    let section = '';
    if (shape.sections && i > 0 && i % 15 === 0) {
      const odd = (i / 15) % 2 === 1;
      const columns = odd ? '<w:cols w:num="2" w:space="200"/>' : '';
      section = `<w:sectPr><w:type w:val="${odd ? 'oddPage' : 'nextPage'}"/>${PAGE}${columns}</w:sectPr>`;
    }
    body.push(
      `<w:p><w:pPr>${keepNext}<w:widowControl w:val="${widow}"/>${EXACT} w:after="${after}"/>` +
        `${indent}${section}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r>${cite}</w:p>`
    );
  }
  const note = (lines: number, k: number) =>
    `<w:footnote w:id="${k + 1 + Math.max(0, continuationId)}"><w:p><w:pPr><w:widowControl/>${EXACT} w:after="0"/></w:pPr>` +
    `<w:r><w:t>${'n'.repeat(Math.max(1, lines * 40 - 5))}</w:t></w:r></w:p></w:footnote>`;
  const separator = (type: string, id: number) =>
    `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr>${EXACT} w:after="0"/></w:pPr>` +
    `<w:r><w:${type}/></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}` +
        `<w:sectPr>${PAGE}</w:sectPr></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${separator('separator', separatorId)}` +
        `${separator('continuationSeparator', continuationId)}${notes.map(note).join('')}` +
        '</w:footnotes>'
    ),
  });
}

const measurer = createFixedMeasurer(5, 12);

function layoutOptions(footnotesPart: OoxmlPart | null, mode: number, session?: LayoutSession) {
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  return {
    measurer,
    notes: {
      footnotesPart,
      endnotesPart: null,
      // Enough entries for every section a document here has.
      footnotePropsBySection: Array.from({ length: 10 }, () => footnoteProps),
      endnotePropsBySection: Array.from({ length: 10 }, () => endnoteProps),
      documentFootnoteProps: footnoteProps,
      documentEndnoteProps: endnoteProps,
      measurer,
      producer: 'footnote-warm-equals-fresh',
    },
    ...(session ? { session } : {}),
    producer: 'footnote-warm-equals-fresh',
    compatibilityMode: mode,
  };
}

function lay(
  part: OoxmlPart,
  footnotesPart: OoxmlPart | null,
  mode: number,
  revision: number,
  session?: LayoutSession
): SemanticLayout {
  return layoutSemanticDocument(part, revision, layoutOptions(footnotesPart, mode, session));
}

/** Every paragraph id under `root`, in document order. */
function allParagraphIds(root: OoxmlElement): string[] {
  return root.children.flatMap((child) =>
    child.kind === 'textValue'
      ? []
      : child.localName === 'p'
        ? [child.id]
        : allParagraphIds(child as OoxmlElement)
  );
}

function paragraphIds(part: OoxmlPart): string[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  );
  return (body?.children ?? []).flatMap((child) =>
    child.kind !== 'textValue' && child.localName === 'p' ? [child.id] : []
  );
}

describe('a warm footnote pass matches a fresh one after each edit', () => {
  const ALL_SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
  const variants: readonly {
    readonly label: string;
    readonly shape: DocumentShape;
    readonly modes: readonly number[];
    readonly seeds: readonly number[];
  }[] = [
    { label: 'one section', shape: {}, modes: [15, 14], seeds: ALL_SEEDS },
    {
      label: 'odd-page sections and columns',
      shape: { minCount: 60, sections: true },
      modes: [15, 14],
      seeds: ALL_SEEDS,
    },
    // These seeds make an edit remove or add a blank parity sheet: the pages after it start
    // where earlier pages did, one page off, so the previous decisions do not apply.
    {
      label: 'a blank parity sheet that an edit removes',
      shape: { minCount: 60, sections: true },
      modes: [14],
      seeds: [13, 68],
    },
    {
      label: 'a blank parity sheet that an edit removes',
      shape: { minCount: 60, sections: true },
      modes: [15],
      seeds: [83],
    },
    // Tall table documents are slow to lay out fresh; this seed splits a row so that two
    // pages open inside one row.
    {
      label: 'tables with split rows',
      shape: { minCount: 60, tables: 0.2 },
      modes: [15],
      seeds: [12],
    },
  ];
  for (const { label, shape, modes, seeds } of variants)
    for (const mode of modes) {
      test(`${label}, compatibility mode ${mode}`, () => {
        const mismatches: string[] = [];
        for (const seed of seeds) {
          const next = random(seed * 7919 + mode);
          const loaded = readOoxmlPackage(documentBytes(next, shape));
          if (!loaded.ok) throw new Error(loaded.reason);
          const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
          const footnotesPart = resolveNotesPart(loaded.package, 'footnote');
          const store = new TreeDocumentStore(part);
          const session = createLayoutSession();
          lay(store.part, footnotesPart, mode, 1, session);
          for (let step = 0; step < 10; step += 1) {
            const ids = paragraphIds(store.part);
            const paragraphId = ids[Math.floor(next() * ids.length)]!;
            const text = next() < 0.5 ? 'abc ' : 'a thirty-eight character phrase here. ';
            const result = store.transact((tx) =>
              tx.apply({ op: 'insertText', paragraphId, offset: 0, text })
            );
            expect(result.ok).toBe(true);
            const warm = lay(store.part, footnotesPart, mode, step + 2, session);
            const fresh = lay(store.part, footnotesPart, mode, step + 2);
            if (JSON.stringify(warm.pages) !== JSON.stringify(fresh.pages)) {
              mismatches.push(`seed ${seed} step ${step}`);
              break;
            }
          }
        }
        expect(mismatches).toEqual([]);
      }, 60000);
    }

  test('after a pass that a newer edit cut short', () => {
    const mismatches: string[] = [];
    for (const mode of [15, 14]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const next = random(seed * 7919 + mode + 13);
        const loaded = readOoxmlPackage(documentBytes(next, { minCount: 60 }));
        if (!loaded.ok) throw new Error(loaded.reason);
        const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
        const footnotesPart = resolveNotesPart(loaded.package, 'footnote');
        const store = new TreeDocumentStore(part);
        const session = createLayoutSession();
        lay(store.part, footnotesPart, mode, 1, session);
        const phrase = 'a thirty-eight character phrase here. ';
        const first = paragraphIds(store.part)[0]!;
        store.transact((tx) =>
          tx.apply({ op: 'insertText', paragraphId: first, offset: 0, text: phrase + phrase })
        );
        // Cut the pass short after 60 progress reports, as a host does for a newer edit.
        const steps = layoutSemanticDocumentSteps(
          store.part,
          2,
          layoutOptions(footnotesPart, mode, session) as never
        );
        let reports = 0;
        for (let step = steps.next(); !step.done; step = steps.next()) {
          if (step.value?.wrapUp && (reports += 1) === 60) step.value.wrapUp();
        }
        const ids = paragraphIds(store.part);
        const last = ids[ids.length - 2]!;
        store.transact((tx) =>
          tx.apply({ op: 'insertText', paragraphId: last, offset: 0, text: 'abc ' })
        );
        const fresh = JSON.stringify(lay(store.part, footnotesPart, mode, 3).pages);
        if (JSON.stringify(lay(store.part, footnotesPart, mode, 3, session).pages) !== fresh) {
          mismatches.push(`mode ${mode} seed ${seed}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 60000);

  test('after an open in growing prefixes', () => {
    const mismatches: string[] = [];
    for (const [shape, modes] of [
      [{ minCount: 60 }, [15, 14]],
      [{ minCount: 60, sections: true }, [15, 14]],
      [{ minCount: 60, tables: 0.2 }, [15]],
    ] as const) {
      for (const mode of modes) {
        for (let seed = 1; seed <= 6; seed += 1) {
          const next = random(seed * 7919 + mode + 29);
          const loaded = readOoxmlPackage(documentBytes(next, shape));
          if (!loaded.ok) throw new Error(loaded.reason);
          const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
          const footnotesPart = resolveNotesPart(loaded.package, 'footnote');
          const session = createLayoutSession();
          // A host lays out the first blocks, then more each pass, then the whole body.
          let revision = 1;
          for (let limit = 8; limit < 100; limit += 3 + (limit >> 2)) {
            layoutSemanticDocument(part, revision, {
              ...layoutOptions(footnotesPart, mode, session),
              bodyBlockLimit: limit,
            });
            revision += 1;
          }
          const warm = lay(part, footnotesPart, mode, revision, session);
          const fresh = lay(part, footnotesPart, mode, revision);
          if (JSON.stringify(warm.pages) !== JSON.stringify(fresh.pages)) {
            mismatches.push(`${JSON.stringify(shape)} mode ${mode} seed ${seed}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 120000);

  test('an open in growing prefixes keeps the pages each prefix decided', () => {
    // Each prefix pass resumes the walk of the pass before it, so the whole open does about
    // the work of one fresh pass. Counted in progress reports, which follow placed blocks.
    const reports = (steps: ReturnType<typeof layoutSemanticDocumentSteps>): number => {
      let count = 0;
      for (let step = steps.next(); !step.done; step = steps.next()) count += 1;
      return count;
    };
    const next = random(4242);
    const loaded = readOoxmlPackage(documentBytes(next, { minCount: 400 }));
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const footnotesPart = resolveNotesPart(loaded.package, 'footnote');
    const fresh = reports(layoutSemanticDocumentSteps(part, 1, layoutOptions(footnotesPart, 15)));
    const session = createLayoutSession();
    let progressive = 0;
    let revision = 1;
    for (let limit = 16, growth = 16; limit < 400; growth *= 2, limit += growth) {
      progressive += reports(
        layoutSemanticDocumentSteps(part, revision, {
          ...layoutOptions(footnotesPart, 15, session),
          bodyBlockLimit: limit,
        })
      );
      revision += 1;
    }
    progressive += reports(
      layoutSemanticDocumentSteps(part, revision, layoutOptions(footnotesPart, 15, session))
    );
    expect(progressive).toBeLessThan(fresh * 1.5);
  }, 60000);

  test('an edit that moves every later page reuses the rounds of a sectioned document', () => {
    // One long section and a short last one, with a note every few pages. An edit at the top
    // moves every later page, so the walk decides each note page again. Its rounds cut inside
    // the long section and the last round reaches the short one: they share one set of section
    // sessions, so the last round resumes instead of laying out every page again.
    const reports = (steps: ReturnType<typeof layoutSemanticDocumentSteps>): number => {
      let count = 0;
      for (let step = steps.next(); !step.done; step = steps.next()) count += 1;
      return count;
    };
    const paragraph = (i: number, cite: string, section = '') =>
      `<w:p><w:pPr>${EXACT} w:after="0"/>${section}</w:pPr>` +
      `<w:r><w:t xml:space="preserve">paragraph ${i} with words that fill a line here</w:t></w:r>${cite}</w:p>`;
    const count = 600;
    let notes = 0;
    const body = Array.from({ length: count }, (_, i) => {
      const cite = i % 60 === 30 ? `<w:r><w:footnoteReference w:id="${(notes += 1)}"/></w:r>` : '';
      return paragraph(i, cite, i === count - 6 ? `<w:sectPr>${PAGE}</w:sectPr>` : '');
    }).join('');
    const note = (k: number) =>
      `<w:footnote w:id="${k + 1}"><w:p><w:pPr>${EXACT} w:after="0"/></w:pPr>` +
      `<w:r><w:t>${'n'.repeat(60)}</w:t></w:r></w:p></w:footnote>`;
    const separator = (type: string, id: number) =>
      `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr>${EXACT} w:after="0"/></w:pPr>` +
      `<w:r><w:${type}/></w:r></w:p></w:footnote>`;
    const loaded = readOoxmlPackage(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
            '</Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
            `<w:sectPr>${PAGE}</w:sectPr></w:body></w:document>`
        ),
        'word/footnotes.xml': strToU8(
          `<w:footnotes xmlns:w="${W}">${separator('separator', -1)}` +
            `${separator('continuationSeparator', 0)}` +
            `${Array.from({ length: notes }, (_, k) => note(k)).join('')}</w:footnotes>`
        ),
      })
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const footnotesPart = resolveNotesPart(loaded.package, 'footnote');
    const store = new TreeDocumentStore(part);
    const session = createLayoutSession();
    lay(store.part, footnotesPart, 15, 1, session);
    const first = paragraphIds(store.part)[1]!;
    const result = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId: first, offset: 0, text: 'a phrase. '.repeat(8) })
    );
    expect(result.ok).toBe(true);
    const warm = reports(
      layoutSemanticDocumentSteps(store.part, 2, layoutOptions(footnotesPart, 15, session))
    );
    const fresh = reports(
      layoutSemanticDocumentSteps(store.part, 2, layoutOptions(footnotesPart, 15))
    );
    expect(JSON.stringify(lay(store.part, footnotesPart, 15, 3, session).pages)).toBe(
      JSON.stringify(lay(store.part, footnotesPart, 15, 3).pages)
    );
    // Without the shared section sessions the last round lays out every page again.
    expect(warm).toBeLessThan(fresh * 1.1);
  }, 60000);

  test('after an edit to a continuation separator with a positive id', () => {
    const mismatches: string[] = [];
    for (const mode of [15, 14]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const next = random(seed * 7919 + mode + 13);
        const loaded = readOoxmlPackage(documentBytes(next, { separatorIds: [0, 1] }));
        if (!loaded.ok) throw new Error(loaded.reason);
        const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
        const notes = new TreeDocumentStore(resolveNotesPart(loaded.package, 'footnote')!);
        const store = new TreeDocumentStore(part);
        const session = createLayoutSession();
        lay(store.part, notes.part, mode, 1, session);
        // The second paragraph of the notes part is the continuation separator's.
        const paragraphId = allParagraphIds(notes.part.root)[1]!;
        const result = notes.transact((tx) =>
          tx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'x'.repeat(200) })
        );
        expect(result.ok).toBe(true);
        const fresh = JSON.stringify(lay(store.part, notes.part, mode, 2).pages);
        if (JSON.stringify(lay(store.part, notes.part, mode, 2, session).pages) !== fresh) {
          mismatches.push(`mode ${mode} seed ${seed}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 60000);
});
