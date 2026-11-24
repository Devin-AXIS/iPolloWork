// A section takes its result from the previous round of the same reserve walk only when
// every input it was laid out from is equal: the walk, its blocks, its flow state, and the
// reserves on its pages and on the page after them.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import {
  rememberSectionRound,
  replayedSectionRound,
  sectionRoundInputs,
  type SectionRoundInputs,
} from '../note-round-section-replay.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function blocksOf(count: number): OoxmlElement[] {
  const body = Array.from({ length: count }, (_, i) => `<w:p><w:r><w:t>${i}</w:t></w:r></w:p>`);
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body.join('')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const documentBody = read.part.root.children[0] as OoxmlElement;
  return documentBody.children as OoxmlElement[];
}

const blocks = blocksOf(4);
const round = {};
const result = { pages: ['page 3', 'page 4'] };
const base: Omit<SectionRoundInputs, 'session'> = {
  round,
  blocks,
  entry: 'entry',
  pageIndexStart: 3,
  reserves: new Map([
    [3, 20],
    [4, 50],
  ]),
};

function remembered() {
  const session = createLayoutSession();
  rememberSectionRound({ ...base, session }, result);
  return session;
}

describe('note round section replay', () => {
  test('equal inputs take the previous result and read as a pass that kept every page', () => {
    const session = remembered();
    session.stats = { placed: 7, total: 4, reusedPages: 0, fullPasses: 1 };
    const replayed = replayedSectionRound({
      ...base,
      session,
      blocks: [...blocks],
      // Reserves on other pages, and zero entries, are not read by this section.
      reserves: new Map([
        [1, 90],
        [3, 20],
        [4, 50],
        [5, 0],
        [6, 90],
      ]),
    });
    expect(replayed).toBe(result);
    expect(session.stats).toEqual({ placed: 0, total: 4, reusedPages: 2, fullPasses: 1 });
  });

  test('any changed input lays the section out again', () => {
    const changed: Partial<SectionRoundInputs>[] = [
      { round: {} },
      { entry: 'other' },
      { pageIndexStart: 4 },
      { blocks: blocks.slice(0, 3) },
      { blocks: [...blocks.slice(0, 3), blocksOf(1)[0]!] },
      // A reserve on one of its pages, and on the page after its last one.
      { reserves: new Map([[3, 20]]) },
      {
        reserves: new Map([
          [3, 20],
          [4, 50],
          [5, 10],
        ]),
      },
    ];
    for (const change of changed) {
      const session = remembered();
      expect(replayedSectionRound({ ...base, ...change, session })).toBeUndefined();
    }
  });

  test('only rounds of a walk that sweeps no cache and takes no seed keep results', () => {
    const session = createLayoutSession();
    const section = { blocks, entry: ['entry', 1, true], pageIndexStart: 0 };
    const options = { noteRoundContext: round };
    const inputs = sectionRoundInputs(options, false, false, session, section);
    expect(inputs?.round).toBe(round);
    expect(inputs?.session).toBe(session);
    // The entry values are framed, so no two lists alias one key.
    const other = sectionRoundInputs(options, false, false, session, {
      ...section,
      entry: ['entry1', true],
    });
    expect(other?.entry).not.toBe(inputs?.entry);
    expect(sectionRoundInputs({}, false, false, session, section)).toBeUndefined();
    expect(sectionRoundInputs(options, new Set(), false, session, section)).toBeUndefined();
    expect(sectionRoundInputs(options, false, true, session, section)).toBeUndefined();
    expect(sectionRoundInputs(options, false, false, undefined, section)).toBeUndefined();
    expect(
      sectionRoundInputs(
        { ...options, pageBottomReservesFromPreviousPass: true },
        false,
        false,
        session,
        section
      )
    ).toBeUndefined();
    expect(
      sectionRoundInputs(
        { ...options, pageBottomReservesFollowFlow: true },
        false,
        false,
        session,
        section
      )
    ).toBeUndefined();
  });
});
