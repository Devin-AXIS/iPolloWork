import { expect, test } from 'bun:test';
import { createServerAutomationHost } from '../server-host.ts';
import type { AutomationHost } from '../protocol.ts';
import { docx, p } from './support/protocol.ts';

function mode(host: AutomationHost) {
  const result = host.execute({ operations: [{ op: 'getChangeTrackingMode' }] }).results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'text') throw new Error('missing mode');
  return result.value.text;
}

test('subscribers observe the committed tracking mode and reentrant mode writes are retained', () => {
  const opened = createServerAutomationHost(docx(p('Original')));
  if (!opened.ok) throw new Error(opened.reason);
  const host = opened.host;
  try {
    const documentResult = host.execute({ operations: [{ op: 'getDocument' }] }).results[0];
    if (documentResult?.status !== 'ok' || documentResult.value.kind !== 'handle')
      throw new Error('document');
    const bodyResult = host.execute({
      operations: [{ op: 'getBody', document: documentResult.value.handle }],
    }).results[0];
    if (bodyResult?.status !== 'ok' || bodyResult.value.kind !== 'handle') throw new Error('body');
    const observed: string[] = [];
    host.subscribe(() => {
      observed.push(mode(host));
      expect(host.execute({ operations: [{ op: 'setChangeTrackingMode', mode: 'Off' }] }).ok).toBe(
        true
      );
    });
    const response = host.execute({
      operations: [
        { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' },
        { op: 'insertText', at: { body: bodyResult.value.handle, at: 'end' }, text: ' Added' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(observed).toEqual(['TrackMineOnly']);
    expect(mode(host)).toBe('Off');
  } finally {
    host.dispose();
  }
});
