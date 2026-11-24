// `getParagraphTextIfPresent` and `getParagraphTextSpan`: the reads that let a client keep its
// own marks on paragraphs. A removed paragraph answers no text instead of refusing, and a range
// of a view's text maps to the one model range that shows it.

import { describe, expect, test } from 'bun:test';
import { createServerAutomationHost } from '../server-host.ts';
import { automationParagraphNodeId } from '../host.ts';
import type {
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
  AutomationValue,
} from '../protocol.ts';
import { docx } from './support/protocol.ts';

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const field = (instruction: string, result: string): string =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run(result) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function open(body: string): AutomationHost {
  const opened = createServerAutomationHost(docx(body));
  if (!opened.ok) throw new Error(`host did not open: ${opened.reason}`);
  return opened.host;
}

function value(response: AutomationBatchResponse, index = 0): AutomationValue {
  const result = response.results[index];
  if (result?.status !== 'ok') throw new Error(`expected an answer, got ${JSON.stringify(result)}`);
  return result.value;
}

function paragraphs(host: AutomationHost): readonly AutomationHandle[] {
  const document = value(host.execute({ operations: [{ op: 'getDocument' }] }));
  if (document.kind !== 'handle') throw new Error('expected a document');
  const body = value(host.execute({ operations: [{ op: 'getBody', document: document.handle }] }));
  if (body.kind !== 'handle') throw new Error('expected a body');
  const listed = value(host.execute({ operations: [{ op: 'getParagraphs', body: body.handle }] }));
  if (listed.kind !== 'handles') throw new Error('expected paragraphs');
  return listed.handles;
}

describe('getParagraphTextIfPresent', () => {
  test('answers the text, and no text once the paragraph is gone', () => {
    const host = open(`<w:p>${run('Keep')}</w:p><w:p>${run('Remove me')}</w:p>`);
    const [, second] = paragraphs(host);
    expect(
      value(host.execute({ operations: [{ op: 'getParagraphTextIfPresent', paragraph: second! }] }))
    ).toEqual({ kind: 'texts', texts: ['Remove me'] });
    expect(host.execute({ operations: [{ op: 'deleteParagraph', paragraph: second! }] }).ok).toBe(
      true
    );
    const response = host.execute({
      operations: [
        { op: 'getParagraphTextIfPresent', paragraph: second! },
        { op: 'getParagraphTextIfPresent', paragraph: paragraphs(host)[0]! },
      ],
    });
    expect(response.ok).toBe(true);
    expect(value(response, 0)).toEqual({ kind: 'texts', texts: [] });
    expect(value(response, 1)).toEqual({ kind: 'texts', texts: ['Keep'] });
  });

  test('refuses a handle that names no paragraph', () => {
    const host = open(`<w:p>${run('Text')}</w:p>`);
    const document = value(host.execute({ operations: [{ op: 'getDocument' }] }));
    if (document.kind !== 'handle') throw new Error('expected a document');
    const response = host.execute({
      operations: [{ op: 'getParagraphTextIfPresent', paragraph: document.handle }],
    });
    expect(response.results[0]).toMatchObject({
      status: 'error',
      error: { code: 'invalid-handle' },
    });
  });
});

describe('getParagraphTextSpan', () => {
  test('maps a plain range one for one', () => {
    const host = open(`<w:p>${run('The teh cat')}</w:p>`);
    const [paragraph] = paragraphs(host);
    const answer = value(
      host.execute({
        operations: [{ op: 'getParagraphTextSpan', paragraph: paragraph!, start: 4, length: 3 }],
      })
    );
    if (answer.kind !== 'span') throw new Error('expected a span');
    expect(answer.span.start.offset).toBe(4);
    expect(answer.span.end.offset).toBe(7);
    expect(automationParagraphNodeId(host, answer.span.start.paragraph)).toBeString();
  });

  test('maps text after an expanded field result to its model offsets', () => {
    const host = open(
      `<w:p>${run('See ')}${field(' REF x ', 'Section 2')}${run(' teh end')}</w:p>`
    );
    const [paragraph] = paragraphs(host);
    const text = value(host.execute({ operations: [{ op: 'getText', target: paragraph! }] }));
    if (text.kind !== 'text') throw new Error('expected text');
    const start = text.text.indexOf('teh');
    const answer = value(
      host.execute({
        operations: [{ op: 'getParagraphTextSpan', paragraph: paragraph!, start, length: 3 }],
      })
    );
    if (answer.kind !== 'span') throw new Error('expected a span');
    const model = value(
      host.execute({ operations: [{ op: 'getSpanText', span: answer.span, projection: 'model' }] })
    );
    expect(model).toEqual({ kind: 'text', text: 'teh' });
    expect(answer.span.start.offset).toBeLessThan(start);
  });

  test('refuses a range outside the text or an empty range', () => {
    const host = open(`<w:p>${run('Short')}</w:p>`);
    const [paragraph] = paragraphs(host);
    for (const [start, length] of [
      [3, 3],
      [0, 0],
      [-1, 2],
      [1.5, 1],
    ] as const) {
      const response = host.execute({
        operations: [{ op: 'getParagraphTextSpan', paragraph: paragraph!, start, length }],
      });
      expect(response.results[0]).toMatchObject({
        status: 'error',
        error: { code: 'invalid-offset' },
      });
    }
  });
});

describe('automationParagraphNodeId', () => {
  test('answers null for a handle another host minted', () => {
    const first = open(`<w:p>${run('One')}</w:p>`);
    const second = open(`<w:p>${run('Two')}</w:p>`);
    const [handle] = paragraphs(first);
    expect(automationParagraphNodeId(first, handle)).toBeString();
    expect(automationParagraphNodeId(second, handle)).toBeNull();
  });
});
