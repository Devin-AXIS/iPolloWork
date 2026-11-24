// Suggesting mode records formatting as `w:rPrChange` / `w:pPrChange` (fixes #495).
//
// Content had a tracked form and formatting did not: typing wrapped in `w:ins`, deleting
// wrapped in `w:del`, and a Bold press rewrote the run's `w:rPr` outright. Reject had nothing
// to reject, the review pane showed nothing, and — once formatting learned to reach tracked
// text (#493) — a suggester's Bold press silently rewrote another author's pending insertion.
//
// These tests pin the write half. `resolveRevisions` already owned the read half: accept
// drops the record, reject restores what it holds.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { revisionItemsOf } from '../../store/store/review-reads.ts';
import { planRevisionBatch } from '../../store/store/revision-batch.ts';
import { serializeOoxmlPart } from '../../store/index.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { resolveRevisionMarkup } from '../../contracts/revision-markup.ts';

const AUTHOR = 'Bea';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The fixture plus a `settings.xml` asking for formatting changes NOT to be recorded. */
function withoutFormatTracking(body: string): Uint8Array {
  const entries = unzipSync(docx(body));
  entries['word/settings.xml'] = strToU8(
    `<w:settings xmlns:w="${W}"><w:doNotTrackFormatting/></w:settings>`
  );
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.settings+xml"/></Types>'
    )
  );
  entries['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId30" Type="${R}/settings" Target="settings.xml"/></Relationships>`
  );
  return zipSync(entries);
}

function withSuggesting(
  body: string,
  run: (surface: PaginatedSurface) => void,
  author: string = AUTHOR
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    editingMode: 'suggest',
    author,
    revisionDisplayMode: 'all-markup',
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

function select(surface: PaginatedSurface, start: number, end: number): void {
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: start },
    head: { paragraphId: id, offset: end },
  });
}

function findAll(node: OoxmlNode, localName: string): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (current: OoxmlNode): void => {
    if (current.kind === 'textValue') return;
    if (current.localName === localName) found.push(current);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return found;
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** The property names a change wrapper recorded, in order. */
function recorded(wrapper: OoxmlNode): string[] {
  if (wrapper.kind === 'textValue') return [];
  const inner = wrapper.children.find(
    (child) =>
      child.kind !== 'textValue' && (child.localName === 'rPr' || child.localName === 'pPr')
  );
  if (!inner || inner.kind === 'textValue') return [];
  return inner.children.flatMap((child) => (child.kind === 'textValue' ? [] : [child.localName]));
}

function rPrChanges(surface: PaginatedSurface): OoxmlNode[] {
  return findAll(surface.session.part().root, 'rPrChange');
}

/** Only the records on RUNS — the paragraph mark writes one of its own beside them. */
function runRPrChanges(surface: PaginatedSurface): OoxmlNode[] {
  return findAll(surface.session.part().root, 'r').flatMap((run) => findAll(run, 'rPrChange'));
}

/** Resolve one revision through the surface's own gated path, as a reviewer would. */
function resolve(surface: PaginatedSurface, action: 'accept' | 'reject', node: OoxmlNode): void {
  const id = attributeOf(node, 'id')!;
  const author = attributeOf(node, 'author')!;
  const date = attributeOf(node, 'date');
  // The whole triple: `sameRevision` compares the date too, so an address that drops it
  // matches nothing.
  const revision = date === undefined ? { id, author } : { id, author, date };
  const result = surface.applyAutomationOps(() => [
    action === 'accept'
      ? { op: 'acceptRevision' as const, revision }
      : { op: 'rejectRevision' as const, revision },
  ]);
  if (result.rejected) throw new Error(String(result.reason));
}

/** Resolve every DISTINCT format record address once — one press writes one address. */
function resolveAll(surface: PaginatedSurface, action: 'accept' | 'reject'): void {
  const seen = new Set<string>();
  for (const change of [
    ...rPrChanges(surface),
    ...findAll(surface.session.part().root, 'pPrChange'),
  ]) {
    const key = `${attributeOf(change, 'id')}\u0000${attributeOf(change, 'author')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolve(surface, action, change);
  }
}

const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('tracked format changes in suggesting mode', () => {
  test('bold over plain text records the run properties it replaced', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      // One on the run, one on the paragraph MARK: a whole-paragraph format writes both.
      expect(rPrChanges(surface)).toHaveLength(2);
      const onRun = runRPrChanges(surface)[0]!;
      expect(attributeOf(onRun, 'author')).toBe(AUTHOR);
      expect(attributeOf(onRun, 'id')).toBeDefined();
      // The run had nothing authored, so the record is an empty `w:rPr` — which is what
      // Reject must restore it to.
      expect(recorded(onRun)).toEqual([]);
      expect(surface.formatting().bold).toBe(true);
    });
  });

  test('the record holds the ORIGINAL bag, not the run as it looked a press ago', () => {
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.toggleRunProperty('b');
        select(surface, 0, 5);
        surface.toggleRunProperty('i');
        const onRun = runRPrChanges(surface);
        // Two presses, ONE record — `CT_RPr` admits a single `w:rPrChange` — and it still
        // holds the state before the first press. Recording the intermediate state would
        // make Reject restore a document nobody ever saw.
        expect(onRun).toHaveLength(1);
        expect(recorded(onRun[0]!)).toEqual(['color']);
      }
    );
  });

  test('a write that lands back on the original drops the record', () => {
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.setRunProperty('color', { val: '00FF00' });
        expect(runRPrChanges(surface)).toHaveLength(1);
        select(surface, 0, 5);
        surface.setRunProperty('color', { val: 'FF0000' });
        // Back at the original: a card offering to revert a change that no longer exists is
        // worse than no card, because accepting and rejecting it produce the same document.
        expect(runRPrChanges(surface)).toHaveLength(0);
      }
    );
  });

  test('formatting inside the author OWN insertion writes no record', () => {
    // The whole run is already this author's proposal: rejecting the insertion takes the
    // words and the formatting together, so a second card would decide nothing.
    const ins = `<w:ins w:id="9" w:author="${AUTHOR}" w:date="2026-01-01T00:00:00Z">${textRun('mine')}</w:ins>`;
    withSuggesting(`<w:p>${ins}</w:p>`, (surface) => {
      select(surface, 0, 4);
      surface.toggleRunProperty('b');
      expect(runRPrChanges(surface)).toHaveLength(0);
      expect(surface.formatting().bold).toBe(true);
    });
  });

  test('formatting inside ANOTHER author insertion records the change', () => {
    // The sting the #494 review found: the press now applies, so without a record it
    // permanently rewrote a foreign pending insertion with nothing to accept or reject.
    const ins = `<w:ins w:id="9" w:author="Ada" w:date="2026-01-01T00:00:00Z">${textRun('theirs')}</w:ins>`;
    withSuggesting(`<w:p>${ins}</w:p>`, (surface) => {
      select(surface, 0, 6);
      surface.toggleRunProperty('b');
      const onRun = runRPrChanges(surface);
      expect(onRun).toHaveLength(1);
      expect(attributeOf(onRun[0]!, 'author')).toBe(AUTHOR);
      // Ada's insertion is untouched — her card still stands beside the new one.
      expect(findAll(surface.session.part().root, 'ins')).toHaveLength(1);
    });
  });

  test('rejecting the format change restores the properties it recorded', () => {
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.toggleRunProperty('b');
        resolveAll(surface, 'reject');
        expect(rPrChanges(surface)).toHaveLength(0);
        select(surface, 0, 5);
        expect(surface.formatting().bold).toBe(false);
        expect(surface.formatting().color).toBe('FF0000');
      }
    );
  });

  test('accepting the format change keeps the new properties and drops the record', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      resolveAll(surface, 'accept');
      expect(rPrChanges(surface)).toHaveLength(0);
      select(surface, 0, 5);
      expect(surface.formatting().bold).toBe(true);
    });
  });

  test('the change reaches the review queue as a `format` revision', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      const items = revisionItemsOf(surface.session.part());
      const formats = items.filter((item) => item.revisionKind === 'format');
      expect(formats.length).toBeGreaterThan(0);
      expect(formats[0]!.author).toBe(AUTHOR);
    });
  });

  test('a paragraph property change writes w:pPrChange over CT_PPrBase', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.setParagraphProperty('jc', { val: 'center' });
      const changes = findAll(surface.session.part().root, 'pPrChange');
      expect(changes).toHaveLength(1);
      expect(attributeOf(changes[0]!, 'author')).toBe(AUTHOR);
      // `CT_PPrChange` records a `CT_PPrBase`, which cannot hold `w:rPr` or `w:sectPr` — so
      // the mark and any section break stay on the container and out of the record.
      expect(recorded(changes[0]!)).not.toContain('rPr');
      expect(recorded(changes[0]!)).not.toContain('sectPr');
    });
  });

  test('rejecting a format change leaves a pending paragraph-mark decision standing', () => {
    // The mark's own `w:ins` lives in the same `w:pPr/w:rPr` the format record sits in, and
    // it is somebody's pending decision about the BREAK. Restoring the container from the
    // record alone deleted it, so rejecting a formatting suggestion silently answered an
    // unrelated one.
    const marked =
      '<w:p><w:pPr><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(marked, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      const onMark = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'rPrChange')
      );
      expect(onMark).toHaveLength(1);
      // The record does NOT carry Ada's mark insertion.
      expect(recorded(onMark[0]!)).not.toContain('ins');
      resolveAll(surface, 'reject');
      // Ada's decision is still there to answer.
      const marks = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'ins')
      );
      expect(marks).toHaveLength(1);
      expect(attributeOf(marks[0]!, 'author')).toBe('Ada');
    });
  });

  test('rejecting a Word-written mark record does not double the mark revision', () => {
    // `CT_ParaRPrOriginal` admits `w:ins`, so a record another producer wrote legitimately
    // carries one. Keeping the live mark AND the recorded copy emits two `w:ins` in a
    // container whose schema allows one — a `w:pPr` Word reports as unreadable.
    const doubled =
      '<w:p><w:pPr><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '<w:b/>' +
      '<w:rPrChange w:id="5" w:author="Cy" w:date="2026-01-02T00:00:00Z"><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:rPrChange>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(doubled, (surface) => {
      const change = findAll(surface.session.part().root, 'rPrChange')[0]!;
      resolve(surface, 'reject', change);
      const markProperties = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'rPr')
      )[0]!;
      const names = (markProperties as { children: OoxmlNode[] }).children.map((child) =>
        child.kind === 'textValue' ? '' : child.localName
      );
      expect(names.filter((name) => name === 'ins')).toHaveLength(1);
      expect(names).not.toContain('b');
    });
  });

  test('rejecting everything leaves no revision behind, format record or mark', () => {
    // The restore branch lifts the container's LIVE mark revisions out and puts them back.
    // Taking them verbatim skipped the plan, so a Reject All that was answering the mark too
    // reported success with that decision still standing — an empty pane over a file that
    // still held a tracked change.
    const merged =
      '<w:p><w:pPr><w:rPr>' +
      '<w:del w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p><w:p>' +
      textRun('second') +
      '</w:p>';
    withSuggesting(merged, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      expect(rPrChanges(surface).length).toBeGreaterThan(0);
      const result = surface.applyAutomationOps(() => [{ op: 'rejectAllRevisions' as const }]);
      expect(result.rejected).toBe(false);
      expect(rPrChanges(surface)).toHaveLength(0);
      expect(revisionItemsOf(surface.session.part())).toEqual([]);
    });
  });

  test('a write landing on another author record leaves their record standing', () => {
    // Dropping it would resolve their pending decision from a formatting press: silently,
    // with nothing recorded, and nothing for the review pane to show. A standing decision can
    // be reconciled; a dropped one cannot.
    //
    // `CT_ParaRPrOriginal` admits `EG_ParaRPrTrackChanges`, so the record Cy wrote carries
    // Ada's `w:ins` — and the comparison narrows both sides the same way, or a write landing
    // exactly on the recorded original could never be recognised as one.
    const foreign =
      '<w:p><w:pPr><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '<w:color w:val="FF0000"/>' +
      '<w:rPrChange w:id="5" w:author="Cy" w:date="2026-01-02T00:00:00Z"><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '<w:color w:val="00FF00"/>' +
      '</w:rPr></w:rPrChange>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(foreign, (surface) => {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 5 },
      });
      // Exactly Cy's recorded original.
      surface.setRunProperty('color', { val: '00FF00' });
      const onMark = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'rPrChange')
      );
      expect(onMark).toHaveLength(1);
      // Cy's, untouched — not re-attributed and not replaced.
      expect(attributeOf(onMark[0]!, 'author')).toBe('Cy');
      expect(attributeOf(onMark[0]!, 'id')).toBe('5');
    });
  });

  test('a write landing on this author own record drops it', () => {
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.setRunProperty('color', { val: '00FF00' });
        expect(runRPrChanges(surface)).toHaveLength(1);
        select(surface, 0, 5);
        surface.setRunProperty('color', { val: 'FF0000' });
        expect(runRPrChanges(surface)).toHaveLength(0);
      }
    );
  });

  test('Accept All survives a record another producer wrote revisions into', () => {
    // A change record's contents are a COPY, not a decision. `CT_ParaRPrOriginal` admits
    // `EG_ParaRPrTrackChanges`, so a Word-written record holds a `w:ins` — and classifying
    // that copy as a site of its own read it as a misplaced mark, which refuses the WHOLE
    // decision: Accept All and Reject All failed for every revision in the document.
    const foreign =
      '<w:p><w:pPr><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '<w:b/>' +
      '<w:rPrChange w:id="5" w:author="Cy" w:date="2026-01-02T00:00:00Z"><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:rPrChange>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p><w:p>' +
      textRun('second') +
      '</w:p>';
    withSuggesting(foreign, (surface) => {
      // The copy inside the record is not a card of its own; Ada's mark and Cy's format are.
      expect(revisionItemsOf(surface.session.part())).toHaveLength(2);
      const result = surface.applyAutomationOps(() => [{ op: 'acceptAllRevisions' as const }]);
      expect(result.rejected).toBe(false);
      expect(revisionItemsOf(surface.session.part())).toEqual([]);
    });
  });

  test('a mark this author proposed adding takes no record of its own', () => {
    // Rejecting that `w:ins` runs the paragraph into the next one and takes the mark's
    // properties with it, so a record of what they used to be decides nothing.
    const marked =
      '<w:p><w:pPr><w:rPr>' +
      `<w:ins w:id="4" w:author="${AUTHOR}" w:date="2026-01-01T00:00:00Z"/>` +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(marked, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      const onMark = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'rPrChange')
      );
      expect(onMark).toHaveLength(0);
      // The RUN still records: its words are not this author's.
      expect(runRPrChanges(surface)).toHaveLength(1);
    });
  });

  test('one press is one card, however many runs it covers', () => {
    // Cards group on the element name plus the address, so a fresh id per record turned a
    // Bold over three runs into four decisions the reviewer had to answer one at a time. A
    // revision spanning many elements that share an id is the shape this engine is built
    // around, and it is what Word writes.
    const runs = [
      textRun('one ', '<w:rPr><w:color w:val="FF0000"/></w:rPr>'),
      textRun('two ', '<w:rPr><w:color w:val="00FF00"/></w:rPr>'),
      textRun('three', '<w:rPr><w:color w:val="0000FF"/></w:rPr>'),
    ].join('');
    withSuggesting(`<w:p>${runs}</w:p>`, (surface) => {
      select(surface, 0, 'one two three'.length);
      surface.toggleRunProperty('b');
      const ids = rPrChanges(surface).map((change) => attributeOf(change, 'id'));
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(1);
      const cards = revisionItemsOf(surface.session.part()).filter(
        (item) => item.revisionKind === 'format'
      );
      expect(cards).toHaveLength(1);
      // Each record still holds its OWN run's colour, not the first run's.
      expect(runRPrChanges(surface).map((change) => recorded(change))).toEqual([
        ['color'],
        ['color'],
        ['color'],
      ]);
    });
  });

  test('a run record and a paragraph record are two cards with two addresses', () => {
    // Both wrappers are `format` revisions, so two cards built from ONE address carry the same
    // key: one is unreachable in the rail, both match the active item, and React sees two
    // children under one key. Worse, a resolve op names no element, so answering the run's
    // card silently answered a paragraph-property change the reviewer never saw.
    const styled =
      '<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr></w:pPr>' +
      textRun('hello', '<w:rPr><w:i/></w:rPr>') +
      '</w:p>';
    withSuggesting(styled, (surface) => {
      select(surface, 0, 5);
      surface.clearFormatting();
      const cards = revisionItemsOf(surface.session.part()).filter(
        (item) => item.revisionKind === 'format'
      );
      expect(cards).toHaveLength(2);
      expect(new Set(cards.map((card) => card.id)).size).toBe(2);
      // Answering one leaves the other standing.
      const runCard = rPrChanges(surface)[0]!;
      resolve(surface, 'accept', runCard);
      expect(findAll(surface.session.part().root, 'pPrChange')).toHaveLength(1);
    });
  });

  test('two wrappers keep two addresses even when the first op records nothing', () => {
    // The shared id is taken LAZILY. An op that records nothing — a run inside this author's
    // own `w:ins` — still opens its wrapper's group, and minting from the part as it looked
    // THEN handed the other wrapper's id straight back: two cards, one address, and rejecting
    // either resolved both.
    const own = `<w:ins w:id="9" w:author="${AUTHOR}" w:date="2026-01-01T00:00:00Z">`;
    const body =
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      own +
      // Authored, so the eraser DOES emit an op for it — and inside this author's own `w:ins`,
      // so that op records nothing. Both halves are what opens the group without minting.
      textRun('mine', '<w:rPr><w:i/></w:rPr>') +
      '</w:ins></w:p><w:p>' +
      textRun('theirs', '<w:rPr><w:color w:val="FF0000"/></w:rPr>') +
      '</w:p>';
    withSuggesting(body, (surface) => {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[1]!, offset: 6 },
      });
      surface.clearFormatting();
      const runIds = rPrChanges(surface).map((change) => attributeOf(change, 'id'));
      const paragraphIds = findAll(surface.session.part().root, 'pPrChange').map((change) =>
        attributeOf(change, 'id')
      );
      expect(runIds.length).toBeGreaterThan(0);
      expect(paragraphIds.length).toBeGreaterThan(0);
      // The two wrapper kinds never share an address.
      for (const runId of runIds) expect(paragraphIds).not.toContain(runId);
      const cards = revisionItemsOf(surface.session.part()).filter(
        (item) => item.revisionKind === 'format'
      );
      expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    });
  });

  test('bulk planning preserves and reports a record with no author on the wrapper', () => {
    // `CT_TrackChange` requires `@w:author` and other generators omit it anyway, so an
    // unaddressed record must remain visible; its historical children are not live decisions.
    const authorless =
      '<w:p><w:pPr><w:rPr><w:b/>' +
      '<w:rPrChange w:id="7" w:date="2026-01-02T00:00:00Z"><w:rPr>' +
      '<w:ins w:id="8" w:author="Ann" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:rPrChange>' +
      '</w:rPr></w:pPr>' +
      '<w:ins w:id="9" w:author="Ann" w:date="2026-01-01T00:00:00Z">' +
      textRun('added') +
      '</w:ins></w:p>';
    withSuggesting(authorless, (surface) => {
      const before = serializeOoxmlPart(surface.session.part());
      const atomic = surface.applyAutomationOps(() => [{ op: 'acceptAllRevisions' as const }]);
      expect(atomic.rejected).toBe(true);
      expect(serializeOoxmlPart(surface.session.part())).toBe(before);
      const plan = planRevisionBatch(surface.session.part(), 'accept');
      expect(plan.result.resolved).toHaveLength(1);
      expect(plan.result.skipped).toMatchObject([{ reason: 'unsupported-revision' }]);
      const result = surface.applyAutomationOps(() => [...plan.ops]);
      expect(result.rejected).toBe(false);
      expect(revisionItemsOf(surface.session.part())).toMatchObject([
        { revisionKind: 'format', readOnly: true },
      ]);
      // The historical insertion is not surfaced as another pending change.
      expect(
        findAll(surface.session.part().root, 'rPrChange').flatMap((w) => findAll(w, 'ins'))
      ).toHaveLength(1);
    });
  });

  test('a second press is a second card, not a merge into the first', () => {
    withSuggesting(`<w:p>${textRun('hello')}${textRun(' there')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      select(surface, 5, 11);
      surface.toggleRunProperty('i');
      const cards = revisionItemsOf(surface.session.part()).filter(
        (item) => item.revisionKind === 'format'
      );
      expect(cards).toHaveLength(2);
    });
  });

  test('a paragraph whose mark this author proposed takes no w:pPrChange', () => {
    // The paragraph-level twin of the run rule: rejecting that `w:ins` runs the paragraph into
    // the next one and takes its properties with it.
    const marked =
      '<w:p><w:pPr><w:rPr>' +
      `<w:ins w:id="4" w:author="${AUTHOR}" w:date="2026-01-01T00:00:00Z"/>` +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(marked, (surface) => {
      select(surface, 0, 5);
      surface.setParagraphProperty('jc', { val: 'center' });
      expect(findAll(surface.session.part().root, 'pPrChange')).toHaveLength(0);
    });
  });

  test('the paragraph mark container keeps its typed kind, so its revisions still paint', () => {
    // Layout finds a mark's revisions and its format record by `kind === 'runProperties'`, with
    // no name fallback. Minting a generic replacement made one Bold press hide somebody's
    // struck pilcrow and change bar — and hide the record the same press had just written.
    const marked =
      '<w:p><w:pPr><w:rPr>' +
      '<w:del w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p><w:p>' +
      textRun('second') +
      '</w:p>';
    withSuggesting(marked, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      const pPr = findAll(surface.session.part().root, 'pPr')[0]!;
      const container = findAll(pPr, 'rPr')[0]!;
      expect(container.kind).toBe('runProperties');
      const fragment = surface.layout().pages[0]!.fragments[0]!;
      expect(fragment.kind).toBe('paragraph');
      if (fragment.kind !== 'paragraph') return;
      expect(fragment.markRevisions.map((entry) => entry.author)).toContain('Ada');
      expect(fragment.markFormatRevision?.author).toBe(AUTHOR);
    });
  });

  test('text typed inside a recorded run does not inherit the record', () => {
    // Those characters were never in the state the record describes. Inheriting it put them
    // under somebody's pending decision: reject the format card and the words just typed came
    // back in a colour nobody had given them, their own insertion card still unanswered.
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.setRunProperty('color', { val: '0000FF' });
        expect(runRPrChanges(surface)).toHaveLength(1);
        const id = surface.session.paragraphIds()[0]!;
        surface.setSelection({
          anchor: { paragraphId: id, offset: 2 },
          head: { paragraphId: id, offset: 2 },
        });
        surface.type('XX');
        const insertedRuns = findAll(surface.session.part().root, 'ins').flatMap((wrapper) =>
          findAll(wrapper, 'r')
        );
        expect(insertedRuns).toHaveLength(1);
        expect(findAll(insertedRuns[0]!, 'rPrChange')).toHaveLength(0);
        // The FACE still comes across — only the pending record does not.
        expect(findAll(insertedRuns[0]!, 'color')).toHaveLength(1);
      }
    );
  });

  test('w:doNotTrackFormatting applies the formatting bare and still tracks the text', () => {
    // §17.15.1.50 is a producer instruction: a document may ask for its formatting changes to
    // land without a `w:rPrChange` while its text edits stay tracked.
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(
      container,
      withoutFormatTracking(`<w:p>${textRun('hello')}</w:p>`),
      {
        editingMode: 'suggest',
        author: AUTHOR,
        revisionDisplayMode: 'all-markup',
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const surface = opened.surface;
      expect(surface.session.trackingSettings().doNotTrackFormatting).toBe(true);
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      // The format applied, with nothing to accept or reject.
      expect(surface.formatting().bold).toBe(true);
      expect(rPrChanges(surface)).toHaveLength(0);
      expect(findAll(surface.session.part().root, 'pPrChange')).toHaveLength(0);
      // A TEXT edit in the same document is still a proposal.
      select(surface, 5, 5);
      surface.type('!');
      expect(findAll(surface.session.part().root, 'ins')).toHaveLength(1);
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });

  test('viewer formatting preferences change tracking without changing text tracking', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      surface.setRevisionMarkup(resolveRevisionMarkup({ trackFormatting: false }));
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      surface.setParagraphProperty('jc', { val: 'center' });
      expect(surface.formatting().bold).toBe(true);
      expect(rPrChanges(surface)).toHaveLength(0);
      expect(findAll(surface.session.part().root, 'pPrChange')).toHaveLength(0);
      select(surface, 5, 5);
      surface.type('!');
      expect(findAll(surface.session.part().root, 'ins')).toHaveLength(1);
      surface.setRevisionMarkup(resolveRevisionMarkup({ trackFormatting: true }));
      select(surface, 0, 5);
      surface.toggleRunProperty('i');
      expect(rPrChanges(surface)).toHaveLength(1);
      surface.setParagraphProperty('jc', { val: 'right' });
      expect(findAll(surface.session.part().root, 'pPrChange')).toHaveLength(1);
    });
  });

  test('editing mode writes the properties with no record at all', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(`<w:p>${textRun('hello')}</w:p>`));
    if (!opened.ok) throw new Error(opened.reason);
    try {
      select(opened.surface, 0, 5);
      opened.surface.toggleRunProperty('b');
      expect(rPrChanges(opened.surface)).toHaveLength(0);
      expect(opened.surface.formatting().bold).toBe(true);
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });
});
