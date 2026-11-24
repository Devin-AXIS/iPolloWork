// Which list definitions a paste imports, and the ids it gives them.

import { describe, expect, test } from 'bun:test';
import { actorStripe, runWithTransactionActor } from '../package/actor-scoped-ids.ts';
import { readOoxmlPart, type OoxmlPart } from '../package/ooxml-tree.ts';
import { planNumberingImport } from '../store/clipboard-fragment-numbering.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRIPE = 65_536;

function numbering(inner: string): OoxmlPart {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${inner}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function abstract(id: number, format: string): string {
  return (
    `<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
    `<w:numFmt w:val="${format}"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>`
  );
}

const num = (id: number, abstractId: number) =>
  `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/></w:num>`;

const TARGET = numbering(
  abstract(0, 'lowerLetter') + abstract(4, 'bullet') + num(1, 0) + num(7, 4)
);
const FRAGMENT = numbering(abstract(0, 'decimal') + num(1, 0));

describe('planNumberingImport', () => {
  test('without an actor, a new definition takes one past the highest ids', () => {
    const plan = planNumberingImport(FRAGMENT, TARGET)!;
    expect(plan.numIdMap.get('1')).toBe('8');
    expect(plan.abstractsToImport).toHaveLength(1);
    expect(plan.numsToImport).toHaveLength(1);
  });

  test('a definition the target already holds is reused, not imported', () => {
    const plan = planNumberingImport(numbering(abstract(4, 'bullet') + num(2, 4)), TARGET)!;
    expect(plan.numIdMap.get('2')).toBe('7');
    expect(plan.numsToImport).toEqual([]);
    expect(plan.abstractsToImport).toEqual([]);
  });

  test('under an actor, fresh ids sit in the actor stripe and differ between actors', () => {
    const numIdAs = (actor: string) =>
      runWithTransactionActor(actor, () =>
        planNumberingImport(FRAGMENT, TARGET)!.numIdMap.get('1')!
      );
    const alice = Number(numIdAs('alice'));
    const bob = Number(numIdAs('bob'));
    expect(alice % STRIPE).toBe(actorStripe('alice'));
    expect(bob % STRIPE).toBe(actorStripe('bob'));
    expect(alice).not.toBe(bob);
    expect(alice).not.toBe(0);
  });

  test('no fragment numbering part is an empty plan', () => {
    const plan = planNumberingImport(null, TARGET)!;
    expect(plan.numIdMap.size).toBe(0);
    expect(plan.numsToImport).toEqual([]);
  });
});
