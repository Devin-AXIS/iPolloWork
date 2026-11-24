// Authoring a control over the automation protocol: a span, and a point.
//
// Both surfaces plan onto the same store op, so a script and a keystroke must author the same
// element. A COLLAPSED span is the point case — the empty, prompt-showing control Word inserts
// with nothing selected — and it used to be refused as an invalid range, which left a template
// generator unable to place a field it had not first written text into.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  handleAt,
  handlesAt,
  open,
  paragraphsOf,
  roots,
  savedMainXml,
  textAt,
} from './support/protocol.ts';
import type { AutomationHost } from '../protocol.ts';

function withSentence(): AutomationHost {
  return open(docx(`<w:p><w:r><w:t>Between ACME CORP and BUYER LTD</w:t></w:r></w:p>`));
}

function bodyText(host: AutomationHost): string {
  const { body } = roots(host);
  const paragraph = paragraphsOf(host, body)[0]!;
  return textAt(host.execute({ operations: [{ op: 'getText', target: paragraph }] }), 0);
}

describe('insertContentControl over the protocol', () => {
  test('wraps a span in a control of the named subtype', () => {
    const host = withSentence();
    const { body } = roots(host);
    const paragraph = paragraphsOf(host, body)[0]!;
    const response = host.execute({
      operations: [
        {
          op: 'insertContentControl',
          span: { start: { paragraph, offset: 8 }, end: { paragraph, offset: 17 } },
          subtype: 'plainText',
          tag: 'party',
        },
      ],
    });
    expect(response.results[0]?.status).toBe('ok');
    const xml = savedMainXml(host);
    expect(xml).toContain('w:val="party"');
    expect(bodyText(host)).toBe('Between ACME CORP and BUYER LTD');
  });

  test('a collapsed span inserts an empty control showing its prompt', () => {
    const host = withSentence();
    const { body } = roots(host);
    const paragraph = paragraphsOf(host, body)[0]!;
    const response = host.execute({
      operations: [
        {
          op: 'insertContentControl',
          span: { start: { paragraph, offset: 8 }, end: { paragraph, offset: 8 } },
          subtype: 'date',
          tag: 'effective',
          title: 'Effective date',
        },
      ],
    });
    expect(response.results[0]?.status).toBe('ok');
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:showingPlcHdr/>');
    expect(xml).toContain('w:val="effective"');
    // The prompt belongs to the TYPE, so a date field reads as one before anybody fills it.
    expect(bodyText(host)).toBe('Between Click here to enter a date.ACME CORP and BUYER LTD');
  });

  test('returnHandle answers each control of a batch with its own handle', () => {
    const host = open(
      docx(`<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>`)
    );
    const { body } = roots(host);
    const [first, second] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'insertContentControl',
          span: { start: { paragraph: first!, at: 'end' }, end: { paragraph: first!, at: 'end' } },
          subtype: 'plainText',
          tag: 'a',
          returnHandle: true,
        },
        {
          op: 'insertContentControl',
          span: {
            start: { paragraph: second!, at: 'end' },
            end: { paragraph: second!, at: 'end' },
          },
          subtype: 'plainText',
          tag: 'b',
          returnHandle: true,
        },
      ],
    });
    const named = host.execute({
      operations: [
        { op: 'getContentControlTag', contentControl: handleAt(response, 0) },
        { op: 'getContentControlTag', contentControl: handleAt(response, 1) },
      ],
    });
    expect([textAt(named, 0), textAt(named, 1)]).toEqual(['a', 'b']);
  });

  test.each([false, true])(
    'refuses deleting a control containing a queued insertion before writing (delete first: %s)',
    (deleteFirst) => {
      // P1 sits inside a block control the same batch deletes, so the control inserted there is
      // gone after the commit. Its answer must not fall back to the control P2 received.
      const host = open(
        docx(
          '<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>' +
            '<w:p><w:r><w:t>first</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
            '<w:p><w:r><w:t>second</w:t></w:r></w:p>'
        )
      );
      const { body } = roots(host);
      const [first, second] = paragraphsOf(host, body);
      const [block] = handlesAt(
        host.execute({ operations: [{ op: 'getContentControls', scope: { body } }] }),
        0
      );
      const at = (paragraph: NonNullable<typeof first>) => ({
        start: { paragraph, at: 'end' as const },
        end: { paragraph, at: 'end' as const },
      });
      const before = savedMainXml(host);
      const operations: import('../operations.ts').AutomationOperation[] = [
        {
          op: 'insertContentControl',
          span: at(first!),
          subtype: 'plainText',
          tag: 'a',
          returnHandle: true,
        },
        {
          op: 'insertContentControl',
          span: at(second!),
          subtype: 'plainText',
          tag: 'b',
          returnHandle: true,
        },
        { op: 'deleteContentControl', contentControl: block!, keepContent: false },
      ];
      if (deleteFirst) operations.unshift(operations.pop()!);
      const response = host.execute({ operations });
      expect(response.ok).toBe(false);
      expect(response.results[deleteFirst ? 1 : 2]).toMatchObject({
        status: 'error',
        error: { code: 'conflicting-operations' },
      });
      expect(host.revision()).toBe(0);
      expect(savedMainXml(host)).toBe(before);
    }
  );

  test('removes a nested control and its container in one batch', () => {
    const host = open(
      docx(
        '<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>' +
          '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>' +
          '<w:p><w:r><w:t>held</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
          '</w:sdtContent></w:sdt><w:p><w:r><w:t>tail</w:t></w:r></w:p>'
      )
    );
    const { body } = roots(host);
    const found = host.execute({
      operations: [
        { op: 'getContentControlsByTag', scope: { body }, tag: 'inner' },
        { op: 'getContentControlsByTag', scope: { body }, tag: 'outer' },
      ],
    });
    const response = host.execute({
      operations: [handlesAt(found, 0)[0]!, handlesAt(found, 1)[0]!].map((contentControl) => ({
        op: 'deleteContentControl' as const,
        contentControl,
        keepContent: false,
      })),
    });
    expect(response.ok).toBe(true);
    expect(savedMainXml(host)).not.toContain('held');
  });
});
