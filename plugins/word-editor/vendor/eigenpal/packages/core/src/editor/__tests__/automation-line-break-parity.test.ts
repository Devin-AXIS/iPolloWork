import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createServerAutomationHost, type AutomationHost } from '../../automation/index.ts';
import {
  docx,
  handlesAt,
  p,
  roots,
  savedMainXml,
} from '../../automation/__tests__/support/protocol.ts';

function edit(host: AutomationHost): string {
  const { body } = roots(host);
  const [first, second] = handlesAt(
    host.execute({ operations: [{ op: 'getParagraphs', body }] }),
    0
  );
  const response = host.execute({
    operations: [
      {
        op: 'insertBreak',
        span: { start: { paragraph: first!, offset: 9 }, end: { paragraph: first!, offset: 9 } },
        breakType: 'Line',
        location: 'Before',
      },
      { op: 'insertText', at: { paragraph: second!, at: 'end' }, text: '\vName' },
    ],
  });
  expect(response.ok).toBe(true);
  return savedMainXml(host);
}

// Tracked writes in the browser host need the review module, which these tests do not load.
test('browser and headless hosts write identical line breaks', () => {
  const bytes = docx(p('Acme Ltd 1 Main Street') + p('Signed'));
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error('open failed');
  const editor = createDocxEditor({ container: document.createElement('div'), document: bytes });
  const browser = createBrowserAutomationHost(editor);
  try {
    const headless = edit(opened.host);
    expect(headless.match(/<w:br\/>/g)).toHaveLength(2);
    expect(edit(browser)).toBe(headless);
  } finally {
    browser.dispose();
    opened.host.dispose();
    editor.destroy();
  }
});
