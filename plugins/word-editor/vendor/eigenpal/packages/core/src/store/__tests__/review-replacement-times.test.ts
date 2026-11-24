import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, revisionItemsOf } from '../index.ts';

const FIRST = '2026-01-01T10:00:00Z';
const LATER = '2026-01-02T10:00:00Z';
const revision = (kind: 'ins' | 'del', id: number, text: string, date?: string) => {
  const stamp = date === undefined ? '' : ` w:date="${date}"`;
  const tag = kind === 'ins' ? 't' : 'delText';
  return `<w:${kind} w:id="${id}" w:author="Reviewer"${stamp}><w:r><w:${tag}>${text}</w:${tag}></w:r></w:${kind}>`;
};
function items(content: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return revisionItemsOf(result.part);
}

describe('independent replacement revisions', () => {
  for (const date of [
    LATER,
    '2026-01-01T10:00:01Z',
    '2026-01-01T09:59:59Z',
    undefined,
    'invalid',
  ]) {
    test(`separates a dated deletion from insertion at ${date}`, () => {
      const result = items(revision('del', 1, 'old', FIRST) + revision('ins', 2, 'new', date));
      expect(result.map((item) => item.revisionKind)).toEqual(['delete', 'insert']);
      expect(result.map((item) => item.date)).toEqual([FIRST, date]);
      expect(result.map((item) => item.addresses.length)).toEqual([1, 1]);
    });
  }
  for (const [deletion, insertion] of [
    [FIRST, FIRST],
    [FIRST, '2026-01-01T11:00:00+01:00'],
    [FIRST, '2026-01-01T10:00:00.000Z'],
    ['2026-01-01T10:00:00.0001Z', '2026-01-01T11:00:00.000100+01:00'],
    [undefined, undefined],
    ['invalid', 'invalid'],
  ]) {
    test(`keeps matching editing times independent ${deletion} / ${insertion}`, () => {
      const result = items(
        revision('del', 1, 'old', deletion) + revision('ins', 2, 'new', insertion)
      );
      expect(result.map((item) => item.revisionKind)).toEqual(['delete', 'insert']);
      expect(result.map((item) => item.text)).toEqual(['old', 'new']);
      expect(result.map((item) => item.date)).toEqual([deletion, insertion]);
      expect(result.map((item) => item.addresses.length)).toEqual([1, 1]);
    });
  }
  test('shared IDs and dates do not combine deletion and addition', () => {
    const result = items(revision('del', 1, 'old', FIRST) + revision('ins', 1, 'new', FIRST));
    expect(result.map((item) => item.revisionKind)).toEqual(['delete', 'insert']);
    expect(result[0]!.address).toEqual(result[1]!.address);
    expect(result.map((item) => item.text)).toEqual(['old', 'new']);
  });
  test('does not normalize unzoned dates using the local timezone', () => {
    expect(
      items(revision('del', 1, 'old', '2026-01-01T10:00:00') + revision('ins', 2, 'new', FIRST))
    ).toHaveLength(2);
  });
  test('does not normalize an impossible calendar date', () => {
    expect(
      items(
        revision('del', 1, 'old', '2026-02-30T10:00:00Z') +
          revision('ins', 2, 'new', '2026-03-02T10:00:00Z')
      )
    ).toHaveLength(2);
  });
  test('does not discard fractional-second precision', () => {
    expect(
      items(
        revision('del', 1, 'old', '2026-01-01T10:00:00.0001Z') +
          revision('ins', 2, 'new', '2026-01-01T10:00:00.0002Z')
      )
    ).toHaveLength(2);
  });
  test('does not pair different invalid dates', () => {
    expect(
      items(revision('del', 1, 'old', 'invalid') + revision('ins', 2, 'new', 'other'))
    ).toHaveLength(2);
  });
  test('same-kind deletion fragments remain separate from an addition', () => {
    const result = items(
      revision('del', 1, 'earlier', FIRST) +
        revision('del', 2, 'old', LATER) +
        revision('ins', 3, 'new', LATER)
    );
    expect(result.map((item) => [item.revisionKind, item.text, item.replacedText])).toEqual([
      ['delete', 'earlierold', ''],
      ['insert', 'new', ''],
    ]);
    expect(result[0]!.addresses).toHaveLength(2);
    expect(result[1]!.addresses).toHaveLength(1);
  });
  test('same-kind addition fragments remain separate from a deletion', () => {
    const result = items(
      revision('del', 1, 'old', FIRST) +
        revision('ins', 2, 'new', FIRST) +
        revision('ins', 3, 'later', LATER)
    );
    expect(result.map((item) => [item.revisionKind, item.text])).toEqual([
      ['delete', 'old'],
      ['insert', 'newlater'],
    ]);
  });
  for (const kind of ['ins', 'del'] as const) {
    test(`keeps adjacent ${kind} fragments grouped across editing times`, () => {
      const result = items(revision(kind, 1, 'one', FIRST) + revision(kind, 2, 'two', LATER));
      expect(result).toHaveLength(1);
      expect(result[0]!.text).toBe('onetwo');
      expect(result[0]!.addresses).toHaveLength(2);
    });
  }
  test('does not invent a replacement with an empty insertion from the matching time', () => {
    const result = items(
      revision('del', 1, 'old', FIRST) +
        revision('ins', 2, '', FIRST) +
        revision('ins', 3, 'new', LATER)
    );
    expect(result.some((item) => item.revisionKind === 'replace')).toBe(false);
  });
  test('keeps nested and enclosing revisions independent', () => {
    const result = items(
      `<w:ins w:id="3" w:author="Reviewer" w:date="${FIRST}">${revision('del', 1, 'old', FIRST)}</w:ins>${revision('ins', 2, 'new', FIRST)}`
    );
    expect(result.some((item) => item.revisionKind === 'replace')).toBe(false);
  });
});

for (const kind of ['ins', 'del'] as const) {
  test(`unchanged text separates same-ID ${kind} decisions`, () => {
    const result = items(
      revision(kind, 1, 'A', FIRST) +
        '<w:r><w:t> and </w:t></w:r>' +
        revision(kind, 1, 'B', FIRST) +
        revision(kind, 1, 'C', FIRST)
    );
    expect(result.map((item) => item.text)).toEqual(['A', 'BC']);
    expect(result[0]!.address).toEqual(result[1]!.address);
    expect(result[0]!.id).not.toBe(result[1]!.id);
    expect(result.map((item) => item.ranges.length)).toEqual([1, 2]);
  });
}
