// Endpoints carry the revision they were read at, and the host refuses one whose position moved.
//
// A span answered at one revision names text by raw offsets. An edit before an offset moves it,
// so writing through the old span would change other words. The host stamps every endpoint it
// answers with `readAt` and refuses, with `stale-revision`, an endpoint whose paragraph prefix
// changed since. Edits after the span and formatting edits leave it valid. Endpoints built by
// hand carry no stamp and are taken as current.

import { describe, expect, test } from 'bun:test';
import { richDocx } from './support/furniture.ts';
import { open, paragraphsOf, refusal, roots, storyText } from './support/protocol.ts';
import { createReadTexts } from '../stale-spans.ts';
import type { AutomationBatchResponse, AutomationHost, AutomationSpan } from '../protocol.ts';

function fixture() {
  const host = open(
    richDocx({
      body: '<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p><w:p><w:r><w:t>other</w:t></w:r></w:p>',
    })
  );
  const { body } = roots(host);
  const [first, second] = paragraphsOf(host, body);
  return { host, body, first: first!, second: second! };
}

function rawSpans(response: AutomationBatchResponse): readonly AutomationSpan[] {
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'spans') throw new Error('no spans');
  return result.value.spans;
}

function find(host: AutomationHost, paragraph: unknown, text: string): AutomationSpan {
  const response = host.execute({
    operations: [{ op: 'search', scope: { paragraph } as never, text }],
  });
  return rawSpans(response)[0]!;
}

function replace(host: AutomationHost, span: AutomationSpan, text: string) {
  return host.execute({ operations: [{ op: 'replaceSpan', span, text }] });
}

describe('stamped endpoints', () => {
  test('answers stamp each endpoint with the revision they were read at', () => {
    const { host, first } = fixture();
    const response = host.execute({
      operations: [{ op: 'search', scope: { paragraph: first }, text: 'beta' }],
    });
    const [span] = rawSpans(response);
    expect(span!.start.readAt).toBe(response.revision);
    expect(span!.end.readAt).toBe(response.revision);
  });

  test('a span read before an edit earlier in its paragraph refuses and changes nothing', () => {
    const { host, body, first } = fixture();
    const alpha = find(host, first, 'alpha');
    const gamma = find(host, first, 'gamma');
    expect(replace(host, alpha, 'A').ok).toBe(true);
    const before = storyText(host, body);
    expect(refusal(replace(host, gamma, 'G'))).toBe('stale-revision');
    expect(storyText(host, body)).toBe(before);
  });

  test('an edit inside the span makes it stale', () => {
    const { host, first } = fixture();
    const span = find(host, first, 'alpha beta');
    expect(replace(host, find(host, first, 'beta'), 'b').ok).toBe(true);
    expect(refusal(replace(host, span, 'x'))).toBe('stale-revision');
  });

  test('edits after the span, in other paragraphs, and to formatting keep it valid', () => {
    const { host, body, first, second } = fixture();
    const alpha = find(host, first, 'alpha');
    expect(replace(host, find(host, first, 'gamma'), 'G').ok).toBe(true);
    expect(replace(host, find(host, second, 'other'), 'Other').ok).toBe(true);
    expect(
      host.execute({
        operations: [{ op: 'setFont', span: alpha, font: { bold: true } } as never],
      }).ok
    ).toBe(true);
    expect(replace(host, alpha, 'A').ok).toBe(true);
    expect(storyText(host, body)).toContain('A beta G');
  });

  test('an endpoint built by hand is taken as current', () => {
    const { host, body, first } = fixture();
    expect(replace(host, find(host, first, 'alpha'), 'A').ok).toBe(true);
    const handBuilt: AutomationSpan = {
      start: { paragraph: first, offset: 0 },
      end: { paragraph: first, offset: 1 },
    };
    expect(replace(host, handBuilt, 'Z').ok).toBe(true);
    expect(storyText(host, body)).toContain('Z beta gamma');
  });

  test('a span across paragraphs refuses an edit after its start in its first paragraph', () => {
    const spanned = (edit: boolean) => {
      const { host, body, first, second } = fixture();
      const beta = find(host, first, 'beta');
      const other = find(host, second, 'other');
      // An edit elsewhere moves the revision, so the span's endpoints are checked.
      expect(replace(host, find(host, second, 'other'), 'other').ok).toBe(true);
      // An edit to the first paragraph's tail lies inside the span, past its start offset.
      if (edit) expect(replace(host, find(host, first, 'gamma'), 'G').ok).toBe(true);
      return { host, body, response: replace(host, { start: beta.start, end: other.end }, 'x') };
    };
    const untouched = spanned(false);
    expect(untouched.response.ok).toBe(true);
    expect(storyText(untouched.host, untouched.body)).toContain('alpha x');
    expect(refusal(spanned(true).response)).toBe('stale-revision');
  });

  test('a bad offset on an old endpoint is a bad argument, not a stale read', () => {
    const { host, first, second } = fixture();
    const alpha = find(host, first, 'alpha');
    expect(replace(host, find(host, second, 'other'), 'Other').ok).toBe(true);
    const negative = { ...alpha, start: { ...alpha.start, offset: -1 } };
    expect(refusal(replace(host, negative, 'A'))).toBe('invalid-offset');
  });

  test('a long run of writes elsewhere keeps an untouched early range valid', () => {
    const { host, body, first, second } = fixture();
    const alpha = find(host, first, 'alpha');
    // One tracked-size write per sync, far more than any fixed revision window.
    for (let i = 0; i < 150; i += 1)
      expect(
        replace(host, find(host, second, i % 2 ? 'x' : 'other'), i % 2 ? 'other' : 'x').ok
      ).toBe(true);
    expect(replace(host, alpha, 'A').ok).toBe(true);
    expect(storyText(host, body)).toContain('A beta gamma');
  });

  test('a read revision the host has not reached refuses', () => {
    const { host, first } = fixture();
    const alpha = find(host, first, 'alpha');
    const unknown = { ...alpha, start: { ...alpha.start, readAt: 1e9 } };
    const response = replace(host, unknown, 'A');
    expect(refusal(response)).toBe('stale-revision');
    const result = response.results.find((entry) => entry.status === 'error');
    const detail = result?.status === 'error' ? (result.error.detail ?? '') : '';
    expect(detail).toContain('never read');
    expect(detail).not.toContain('no longer checkable');
  });
});

function threeParagraphs() {
  const host = open(
    richDocx({
      body:
        '<w:p><w:r><w:t>one start</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two middle</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>three end</w:t></w:r></w:p>',
    })
  );
  const { body } = roots(host);
  const [first, middle, last] = paragraphsOf(host, body);
  return { host, body, first: first!, middle: middle!, last: last! };
}

describe('spans across several paragraphs', () => {
  /** The whole body as one span, read in one answer, as `body.getRange('Whole')` reads it. */
  function wholeSpan(host: AutomationHost, body: unknown): AutomationSpan {
    const response = host.execute({
      operations: [{ op: 'getRange', span: { body }, location: 'Whole' } as never],
    });
    const result = response.results[0];
    if (result?.status !== 'ok') throw new Error(JSON.stringify(result));
    const value = result.value as unknown as { span?: AutomationSpan; spans?: AutomationSpan[] };
    const span = value.span ?? value.spans?.[0];
    if (!span) throw new Error(JSON.stringify(value));
    return span;
  }

  test('an untouched span across three paragraphs still writes after an unrelated edit', () => {
    const { host, body, middle } = threeParagraphs();
    const span = wholeSpan(host, body);
    // A formatting edit inside the span moves no text, so the revision moves and the span holds.
    const middleWord = find(host, middle, 'middle');
    expect(
      host.execute({
        operations: [{ op: 'setFont', span: middleWord, font: { bold: true } } as never],
      }).ok
    ).toBe(true);
    expect(replace(host, span, 'joined').ok).toBe(true);
    expect(storyText(host, body)).toContain('joined');
  });

  test('an edit to a paragraph between the endpoints refuses the span', () => {
    const { host, body, middle } = threeParagraphs();
    const span = wholeSpan(host, body);
    expect(replace(host, find(host, middle, 'middle'), 'MIDDLE').ok).toBe(true);
    const before = storyText(host, body);
    expect(refusal(replace(host, span, 'x'))).toBe('stale-revision');
    expect(storyText(host, body)).toBe(before);
  });
});

describe('the per-paragraph history', () => {
  test('an unchanged paragraph never expires; superseded text leaves past the budget', () => {
    const texts = createReadTexts(10);
    texts.record(1, 'kept', 'stays the same');
    texts.record(1, 'busy', 'v1');
    for (let revision = 2; revision < 500; revision += 1) {
      texts.record(revision, 'busy', `v${String(revision)}-padding`);
      texts.record(revision, 'kept', 'stays the same');
    }
    expect(texts.at(1, 'kept')).toBe('stays the same');
    expect(texts.at(499, 'kept')).toBe('stays the same');
    expect(texts.at(499, 'busy')).toBe('v499-padding');
    // Superseded records past the budget are gone, so those reads are not checkable.
    expect(texts.at(1, 'busy')).toBeUndefined();
    expect(texts.at(2, 'busy')).toBeUndefined();
  });

  test('a revision between two records of a key, never read, is not checkable', () => {
    const texts = createReadTexts();
    texts.record(1, 'p', 'a');
    texts.record(5, 'p', 'b');
    expect(texts.at(1, 'p')).toBe('a');
    expect(texts.at(3, 'p')).toBeUndefined();
    expect(texts.at(5, 'p')).toBe('b');
  });

  test('current records of keys no longer read leave past their own budget', () => {
    // Deleted paragraphs, and the keys between and after them, are never read again.
    const texts = createReadTexts(10, 100);
    for (let index = 0; index < 1000; index += 1)
      texts.record(index, `gone-${String(index)}`, 'text of a paragraph');
    texts.record(1000, 'live', 'read last');
    expect(texts.size()).toBeLessThanOrEqual(100);
    // The most recently read keys stay.
    expect(texts.at(1000, 'live')).toBe('read last');
    expect(texts.at(999, 'gone-999')).toBe('text of a paragraph');
    // The oldest current records left, so reads at them are not checkable.
    expect(texts.at(0, 'gone-0')).toBeUndefined();
  });

  test('reading a key again keeps it among the most recently read', () => {
    const texts = createReadTexts(10, 60);
    texts.record(1, 'kept', 'unchanged');
    for (let index = 0; index < 100; index += 1) {
      texts.record(index + 2, `other-${String(index)}`, 'x');
      texts.record(index + 2, 'kept', 'unchanged');
    }
    expect(texts.at(1, 'kept')).toBe('unchanged');
  });
});
