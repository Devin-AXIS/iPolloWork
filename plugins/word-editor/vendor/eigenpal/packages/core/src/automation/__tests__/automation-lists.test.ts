// Lists: which paragraphs a document numbers together, and what level each one sits at.
//
// A list is not a container in a `.docx` — there is no `w:list` element to walk. It is an
// EQUIVALENCE CLASS: every paragraph whose `w:numPr/w:numId` names the same `w:num` is in the
// same list, wherever in the story it sits. So these tests are about identity: the same list
// answers the same handle, two numbers are two lists, and a paragraph that is in no list says
// so rather than answering a list of its own.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  withNumbering,
  handleAt,
  handlesAt,
  open,
  paragraphTexts,
  refusal,
  reopen,
  roots,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

const numbered = (text: string, numId: string, level = 0): string =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${String(level)}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** Two lists and a plain paragraph between them, which is the ordinary shape of a document. */
function withLists(): AutomationHost {
  return open(
    withNumbering(
      docx(
        numbered('one', '3') +
          numbered('two', '3') +
          numbered('nested', '3', 1) +
          `<w:p><w:r><w:t>prose</w:t></w:r></w:p>` +
          numbered('other', '7') +
          numbered('three', '3')
      ),
      ['3', '7']
    )
  );
}

function listsOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getLists', body }] }), 0);
}

function numberAt(host: AutomationHost, list: AutomationHandle): number {
  const response = host.execute({ operations: [{ op: 'getListId', list }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'number') {
    throw new Error(`expected a number: ${JSON.stringify(response)}`);
  }
  return result.value.value;
}

function textsOfList(host: AutomationHost, list: AutomationHandle, level?: number): string[] {
  const paragraphs = handlesAt(
    host.execute({
      operations: [{ op: 'getListParagraphs', list, ...(level === undefined ? {} : { level }) }],
    }),
    0
  );
  const response = host.execute({
    operations: paragraphs.map((paragraph) => ({ op: 'getText' as const, target: paragraph })),
  });
  return paragraphs.map((_, index) => {
    const result = response.results[index];
    if (result?.status !== 'ok' || result.value.kind !== 'text') throw new Error('expected text');
    return result.value.text;
  });
}

function levelOf(host: AutomationHost, paragraph: AutomationHandle): number {
  const response = host.execute({ operations: [{ op: 'getListLevel', paragraph }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'number') {
    throw new Error(`expected a level: ${JSON.stringify(response)}`);
  }
  return result.value.value;
}

describe('a list is the paragraphs that share a number', () => {
  test('a story answers one list per `w:numId`, in the order the numbers first appear', () => {
    const host = withLists();
    const { body } = roots(host);
    const lists = listsOf(host, body);
    expect(lists.map((list) => numberAt(host, list))).toEqual([3, 7]);
  });

  test('a list holds every paragraph that names it, including one after a gap', () => {
    const host = withLists();
    const { body } = roots(host);
    const [first] = listsOf(host, body) as [AutomationHandle];
    // "three" sits after prose and after the other list, and is still in list 3.
    expect(textsOfList(host, first)).toEqual(['one', 'two', 'nested', 'three']);
  });

  test('asking one level answers only the paragraphs at it', () => {
    const host = withLists();
    const { body } = roots(host);
    const [first] = listsOf(host, body) as [AutomationHandle];
    expect(textsOfList(host, first, 1)).toEqual(['nested']);
    expect(textsOfList(host, first, 0)).toEqual(['one', 'two', 'three']);
  });

  test('two asks for the same list are the same handle, and a document with none answers none', () => {
    const host = withLists();
    const { body } = roots(host);
    expect(listsOf(host, body)[0]).toEqual(listsOf(host, body)[0]);

    const plain = open(docx(`<w:p><w:r><w:t>prose</w:t></w:r></w:p>`));
    expect(listsOf(plain, roots(plain).body)).toEqual([]);
  });

  test('a document may not be asked for a list by a number it does not use', () => {
    const host = withLists();
    const { body } = roots(host);
    // A list handle is minted only for a number the story actually names, so there is no way
    // to forge one: the collection is the only source.
    const response = host.execute({ operations: [{ op: 'getLists', body }] });
    expect(response.ok).toBe(true);
    const forged = { kind: 'list', ref: 'list:forged:1' } as unknown as AutomationHandle;
    expect(refusal(host.execute({ operations: [{ op: 'getListId', list: forged }] }))).toBe(
      'invalid-handle'
    );
  });
});

describe('a paragraph knows which list it is in', () => {
  test('a numbered paragraph answers its list and its level', () => {
    const host = withLists();
    const { body } = roots(host);
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    const nested = paragraphs[2] as AutomationHandle;
    const list = handleAt(
      host.execute({ operations: [{ op: 'getParagraphList', paragraph: nested }] }),
      0
    );
    expect(numberAt(host, list)).toBe(3);
    expect(levelOf(host, nested)).toBe(1);
  });

  test('a paragraph in no list is refused rather than answered a list of its own', () => {
    const host = withLists();
    const { body } = roots(host);
    const prose = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0)[3];
    const response = host.execute({
      operations: [{ op: 'getParagraphList', paragraph: prose as AutomationHandle }],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('a level with no `w:ilvl` is level zero, which is what the file means', () => {
    const host = open(
      docx(
        `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>`
      )
    );
    const { body } = roots(host);
    const paragraph = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    )[0];
    expect(levelOf(host, paragraph as AutomationHandle)).toBe(0);
  });
});

describe('a list item moves between levels', () => {
  test('demoting a paragraph writes its new level and survives save and reopen', () => {
    const host = withLists();
    const { body } = roots(host);
    const second = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0)[1];
    const response = host.execute({
      operations: [{ op: 'setListLevel', paragraph: second as AutomationHandle, level: 2 }],
    });
    expect(response.ok).toBe(true);
    expect(response.changed).toBe(true);

    const next = reopen(host);
    const paragraph = handlesAt(
      next.host.execute({ operations: [{ op: 'getParagraphs', body: next.body }] }),
      0
    )[1];
    expect(levelOf(next.host, paragraph as AutomationHandle)).toBe(2);
  });

  test('a level outside what a list has is refused, not clamped', () => {
    const host = withLists();
    const { body } = roots(host);
    const second = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0)[1];
    for (const level of [-1, 9, 1.5]) {
      const response = host.execute({
        operations: [{ op: 'setListLevel', paragraph: second as AutomationHandle, level }],
      });
      expect(response.ok).toBe(false);
      expect(refusal(response)).toBe('invalid-offset');
    }
  });

  test('a paragraph that is in no list has no level to move', () => {
    const host = withLists();
    const { body } = roots(host);
    const prose = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0)[3];
    const response = host.execute({
      operations: [{ op: 'setListLevel', paragraph: prose as AutomationHandle, level: 1 }],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-content');
  });
});

describe('a list takes a new item', () => {
  test('inserting at the end of a list numbers the new paragraph with it', () => {
    const host = withLists();
    const { body } = roots(host);
    const [first] = listsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'insertListParagraph', list: first, where: 'end', text: 'four' }],
    });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    expect(paragraphTexts(next.host, next.body)).toEqual([
      'one',
      'two',
      'nested',
      'prose',
      'other',
      'three',
      'four',
    ]);
    const [reopened] = listsOf(next.host, next.body) as [AutomationHandle];
    expect(textsOfList(next.host, reopened)).toEqual(['one', 'two', 'nested', 'three', 'four']);
  });

  test('inserting at the start of a list numbers it at the first item’s level', () => {
    const host = open(docx(numbered('one', '3') + numbered('nested', '3', 1)));
    const { body } = roots(host);
    const [first] = listsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [{ op: 'insertListParagraph', list: first, where: 'start', text: 'zero' }],
    });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    expect(paragraphTexts(next.host, next.body)).toEqual(['zero', 'one', 'nested']);
    const [reopened] = listsOf(next.host, next.body) as [AutomationHandle];
    expect(textsOfList(next.host, reopened, 0)).toEqual(['zero', 'one']);
  });

  test('the new paragraph is answered, so a caller can go on writing into it', () => {
    const host = open(docx(numbered('one', '3')));
    const { body } = roots(host);
    const [first] = listsOf(host, body) as [AutomationHandle];
    const created = handleAt(
      host.execute({
        operations: [{ op: 'insertListParagraph', list: first, where: 'end', text: 'two' }],
      }),
      0
    );
    expect(created.kind).toBe('paragraph');
    expect(levelOf(host, created)).toBe(0);
  });

  test('two items added at one edge in one batch are refused, like any two edits to a paragraph', () => {
    const host = withLists();
    const { body } = roots(host);
    const [first] = listsOf(host, body) as [AutomationHandle];
    const response = host.execute({
      operations: [
        { op: 'insertListParagraph', list: first, where: 'end', text: 'a' },
        { op: 'insertListParagraph', list: first, where: 'end', text: 'b' },
      ],
    });
    // Two inserts at the same edge of one list in one batch are two structural edits to the
    // same paragraph, which the batch rule already refuses.
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('conflicting-operations');
  });

  test('a list is reachable by the number the document gives it, and an unused number is not', () => {
    const host = withLists();
    const { body } = roots(host);
    const [first] = listsOf(host, body) as [AutomationHandle];
    const id = numberAt(host, first);
    // THE SAME OBJECT, because a handle is minted once per list: asking by number and asking by
    // position are two ways of naming one list, not two lists.
    const byId = host.execute({ operations: [{ op: 'getListById', body, id }] });
    expect(handleAt(byId, 0)).toEqual(first);
    // A `w:numId` no paragraph uses names a numbering definition, not a list.
    expect(refusal(host.execute({ operations: [{ op: 'getListById', body, id: 4242 }] }))).toBe(
      'invalid-handle'
    );
  });
});
