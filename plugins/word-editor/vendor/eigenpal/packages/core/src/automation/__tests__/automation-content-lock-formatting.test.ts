// `contentLockPolicy: { allowFormattingInLockedContent }` over the automation protocol: a content
// lock still protects what a control SAYS, and stops protecting how it LOOKS only for a host that
// opted in. Without the option the protocol is unchanged (see automation-content-controls.test.ts).

import { describe, expect, test } from 'bun:test';
import { createServerAutomationHost } from '../server-host.ts';
import { docx, handlesAt, paragraphsOf, refusal, roots, savedMainXml } from './support/protocol.ts';
import type { AutomationHost } from '../protocol.ts';

const BODY =
  `<w:p><w:r><w:t>ABC</w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/>` +
  `</w:sdtPr><w:sdtContent><w:r><w:t>TOKEN</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t>DEF</w:t></w:r></w:p>`;

function open(allowFormatting: boolean): AutomationHost {
  const opened = createServerAutomationHost(
    docx(BODY),
    allowFormatting ? { contentLockPolicy: { allowFormattingInLockedContent: true } } : {}
  );
  if (!opened.ok) throw new Error(opened.reason);
  return opened.host;
}

function span(host: AutomationHost, start: number, end: number) {
  const { body } = roots(host);
  const paragraph = paragraphsOf(host, body)[0]!;
  return { start: { paragraph, offset: start }, end: { paragraph, offset: end } };
}

describe('contentLockPolicy over the protocol', () => {
  test('default: setFont over a content-locked control is refused', () => {
    const host = open(false);
    const response = host.execute({
      operations: [{ op: 'setFont', span: span(host, 3, 8), font: { bold: true } }],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('transaction-refused');
    const failed = response.results.find((result) => result.status === 'error');
    expect(failed?.status === 'error' ? failed.error.detail : undefined).toBe('locked');
  });

  test('opt-in: setFont restyles the control and the text around it, the lock stays', () => {
    const host = open(true);
    const response = host.execute({
      operations: [{ op: 'setFont', span: span(host, 0, 11), font: { bold: true } }],
    });
    expect(response.ok).toBe(true);
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('w:val="sdtContentLocked"');
  });

  test('opt-in: typing into the control and removing it are still refused', () => {
    const host = open(true);
    const { body } = roots(host);
    const control = handlesAt(
      host.execute({ operations: [{ op: 'getContentControls', scope: { body } }] }),
      0
    )[0]!;
    const write = host.execute({
      operations: [
        { op: 'insertContentControlText', contentControl: control, text: 'x', at: 'replace' },
      ],
    });
    expect(write.ok).toBe(false);
    const remove = host.execute({
      operations: [{ op: 'deleteContentControl', contentControl: control, keepContent: false }],
    });
    expect(remove.ok).toBe(false);
  });
});
