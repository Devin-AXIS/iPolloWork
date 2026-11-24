import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { openTreeSession, type TreeDocxSession } from '../../binding/tree-session.ts';
import type { CanonicalPrimitiveJournal } from '../package/canonical-primitive-journal.ts';
import { writeOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlElement } from '../package/ooxml-tree.ts';
import { assertPackagesEquivalent } from './canonical-primitive-journal-coverage-support.ts';
import {
  blobsForJournal,
  replayCanonicalPrimitiveJournal,
} from './canonical-primitive-replayer.ts';
import {
  BASE,
  EDITED,
  FIRST_COMMENT,
  para,
  PLAIN,
  RESTRUCTURED,
  run,
  SUGGESTED,
  updateFixture,
  type UpdateFixtureOptions,
} from './package-update-fixture.ts';

function open(bytes: Uint8Array): TreeDocxSession {
  const opened = openTreeSession(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return opened.session;
}

/** Every saved entry as text, keyed by name. */
function saved(pkg: OoxmlPackage): Record<string, string> {
  const files = unzipSync(writeOoxmlPackage(pkg));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

function bodyParagraphs(pkg: OoxmlPackage): OoxmlElement[] {
  const root = pkg.parts.get(pkg.mainDocumentPart)!.root;
  const body = root.children[0] as OoxmlElement;
  return body.children.filter((node): node is OoxmlElement => node.kind === 'paragraph');
}

const CASES: readonly (readonly [string, UpdateFixtureOptions, UpdateFixtureOptions])[] = [
  ['a text edit', BASE, EDITED],
  ['a suggestion and a comment', BASE, SUGGESTED],
  ['a removed paragraph, header, and reply', BASE, RESTRUCTURED],
  ['a first comment that adds parts', PLAIN, FIRST_COMMENT],
  ['comments removed with their parts', FIRST_COMMENT, PLAIN],
];

describe('applyPackageUpdate', () => {
  for (const [name, from, to] of CASES) {
    test(`${name}: content as returned, one undo step, and a journal that replays`, () => {
      const base = updateFixture(from);
      const session = open(base);
      const before = saved(session.currentPackage());
      const expected = saved(open(updateFixture(to)).currentPackage());
      const journals: CanonicalPrimitiveJournal[] = [];
      const port = session.collaborationPort('package-update-test');
      const stop = port.observePrimitiveJournal((journal) => journals.push(journal));

      const result = session.applyPackageUpdate(open(updateFixture(to)).currentPackage());
      port.flushPendingJournals();
      stop();

      expect(result.ok).toBe(true);
      expect(saved(session.currentPackage())).toEqual(expected);
      expect(journals.length).toBe(1);

      let replica = open(base).currentPackage();
      replica = replayCanonicalPrimitiveJournal(
        replica,
        journals[0]!,
        blobsForJournal(session.currentPackage(), journals[0]!)
      );
      assertPackagesEquivalent(replica, session.currentPackage());

      expect(session.canUndo()).toBe(true);
      session.undo();
      expect(saved(session.currentPackage())).toEqual(before);
      session.redo();
      expect(saved(session.currentPackage())).toEqual(expected);
    });
  }

  test('keeps ids and objects of unchanged paragraphs and the id of an edited one', () => {
    const session = open(updateFixture(BASE));
    const before = bodyParagraphs(session.currentPackage());
    session.applyPackageUpdate(open(updateFixture(EDITED)).currentPackage());
    const after = bodyParagraphs(session.currentPackage());
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
    expect(after[0]).not.toBe(before[0]);
    for (let index = 1; index < before.length; index += 1) expect(after[index]).toBe(before[index]);
  });

  test('an identical update records nothing', () => {
    const session = open(updateFixture(BASE));
    const result = session.applyPackageUpdate(open(updateFixture(BASE)).currentPackage());
    expect(result).toEqual({ ok: true, change: null });
    expect(session.canUndo()).toBe(false);
  });

  test('earlier undo steps survive below the update', () => {
    const session = open(updateFixture(BASE));
    const original = saved(session.currentPackage());
    const first = bodyParagraphs(session.currentPackage())[4]!;
    const typed = session.applyTreeOps([
      { op: 'insertText', paragraphId: first.id, offset: 0, text: 'Typed ' },
    ]);
    expect(typed.committed).toBe(true);
    const afterTyping = saved(session.currentPackage());
    const update = updateFixture({
      ...EDITED,
      paragraphs: [
        ...EDITED.paragraphs.slice(0, 4),
        BASE.paragraphs[4]!.replace('Closing', 'Typed Closing'),
      ],
    });
    expect(session.applyPackageUpdate(open(update).currentPackage()).ok).toBe(true);
    session.undo();
    expect(saved(session.currentPackage())).toEqual(afterTyping);
    session.undo();
    expect(saved(session.currentPackage())).toEqual(original);
  });

  test('refuses a different main document part with nothing changed', () => {
    const session = open(updateFixture(BASE));
    const incoming = open(updateFixture(EDITED)).currentPackage();
    const result = session.applyPackageUpdate({ ...incoming, mainDocumentPart: '/word/other.xml' });
    expect(result.ok).toBe(false);
    expect(session.canUndo()).toBe(false);
  });

  describe('a long document lowers to the journal of its edits alone', () => {
    const paragraphs = Array.from({ length: 2000 }, (_, index) =>
      para((index + 1).toString(16).padStart(8, '0').toUpperCase(), run(`Paragraph ${index}.`))
    );
    const edited = paragraphs.slice();
    edited[10] = edited[10]!.replace('Paragraph', 'Edited paragraph');
    edited[1990] = edited[1990]!.replace('Paragraph', 'Edited paragraph');
    edited.splice(1000, 1);
    const withoutIds = (list: readonly string[]) =>
      list.map((markup) => markup.replace(/ w14:paraId="[^"]*" w14:textId="[^"]*"/, ''));

    function effectsOf(from: readonly string[], to: readonly string[]): Map<string, number> {
      const session = open(updateFixture({ paragraphs: from }));
      const kinds = new Map<string, number>();
      const port = session.collaborationPort('package-update-test');
      const stop = port.observePrimitiveJournal((journal) => {
        for (const effect of journal.effects) {
          const name =
            effect.kind === 'setAttribute' ? `setAttribute:${effect.qname.localName}` : effect.kind;
          kinds.set(name, (kinds.get(name) ?? 0) + 1);
        }
      });
      expect(
        session.applyPackageUpdate(open(updateFixture({ paragraphs: to })).currentPackage()).ok
      ).toBe(true);
      stop();
      return kinds;
    }

    test('with kept paragraph ids', () => {
      expect(Object.fromEntries(effectsOf(paragraphs, edited))).toEqual({
        spliceText: 2,
        spliceChildren: 1,
      });
    });

    test('when an open mints paragraph ids by position, text is never rewritten', () => {
      const kinds = effectsOf(withoutIds(paragraphs), withoutIds(edited));
      // Paragraphs after the removed one take new minted ids; their text stays put.
      expect(kinds.get('spliceText')).toBe(2);
      expect(kinds.get('spliceChildren')).toBe(1);
      expect([...kinds.keys()].sort()).toEqual([
        'setAttribute:paraId',
        'setAttribute:textId',
        'spliceChildren',
        'spliceText',
      ]);
    });
  });
});
