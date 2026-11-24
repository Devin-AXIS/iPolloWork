import { describe, expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { stubReviewModule } from './review-test-module.ts';
import { createServerAutomationHost } from '../../automation/server-host.ts';
import { docx, p } from '../../automation/__tests__/support/protocol.ts';
import type { AutomationHost, AutomationHandle } from '../../automation/protocol.ts';

function paragraph(host: AutomationHost): AutomationHandle {
  const get = (response: ReturnType<AutomationHost['execute']>) => {
    const value = response.results[0];
    if (value?.status !== 'ok' || value.value.kind !== 'handle') throw new Error('Missing handle');
    return value.value.handle;
  };
  const document = get(host.execute({ operations: [{ op: 'getDocument' }] }));
  const body = get(host.execute({ operations: [{ op: 'getBody', document }] }));
  const result = host.execute({ operations: [{ op: 'getParagraphs', body }] }).results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles')
    throw new Error('Missing paragraphs');
  return result.value.handles[0]!;
}
function replace(host: AutomationHost) {
  const target = paragraph(host);
  return host.execute({
    operations: [
      {
        op: 'proposeReplacement',
        author: 'Agent',
        text: 'XY',
        span: { start: { paragraph: target, offset: 1 }, end: { paragraph: target, offset: 3 } },
      },
    ],
  });
}
function read(host: AutomationHost) {
  const result = host.execute({ operations: [{ op: 'getText', target: paragraph(host) }] })
    .results[0];
  return result?.status === 'ok' && result.value.kind === 'text' ? result.value.text : '';
}

describe('browser automation proposal gates', () => {
  for (const mode of ['edit', 'suggest', 'view'] as const) {
    test(`proposal in ${mode} mode`, () => {
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createDocxEditor({
        container,
        document: docx(p('abcd')),
        author: 'Human',
        modules: [stubReviewModule()],
      });
      const host = createBrowserAutomationHost(editor);
      try {
        editor.surface!.setEditingMode(mode);
        const result = replace(host);
        expect(result.ok).toBe(mode !== 'view');
        if (mode === 'view') expect(read(host)).toBe('abcd');
        else {
          expect(read(host)).toBe('abcXYd');
          const revisions = editor.surface!.session.part();
          expect(JSON.stringify(revisions)).toContain('Agent');
          const opened = createServerAutomationHost(docx(p('abcd')));
          if (!opened.ok) throw new Error(opened.reason);
          try {
            expect(replace(opened.host).ok).toBe(true);
            expect(read(opened.host)).toBe(read(host));
          } finally {
            opened.host.dispose();
          }
        }
      } finally {
        host.dispose();
        editor.destroy();
        container.remove();
      }
    });
  }
  test('a browser without review support refuses explicit proposals', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx(p('abcd')) });
    const host = createBrowserAutomationHost(editor);
    try {
      expect(replace(host).ok).toBe(false);
      expect(read(host)).toBe('abcd');
    } finally {
      host.dispose();
      editor.destroy();
      container.remove();
    }
  });
});
