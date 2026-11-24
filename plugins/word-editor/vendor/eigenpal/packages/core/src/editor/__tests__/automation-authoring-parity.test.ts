import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createServerAutomationHost, type AutomationHost } from '../../automation/index.ts';
import { docx, handleAt, handlesAt, roots } from '../../automation/__tests__/support/protocol.ts';

function edit(host: AutomationHost): Record<string, string> {
  const { document, body } = roots(host);
  const section = handlesAt(host.execute({ operations: [{ op: 'getSections', document }] }), 0)[0]!;
  const header = handleAt(
    host.execute({
      operations: [{ op: 'getFurniture', section, kind: 'header', variant: 'default' }],
    }),
    0
  );
  expect(host.execute({ operations: [{ op: 'getText', target: header }] }).changed).toBe(false);
  expect(
    host.execute({
      operations: [{ op: 'replaceSpan', span: { body: header }, text: 'Shared header' }],
    }).ok
  ).toBe(true);
  const paragraph = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0)[0]!;
  const list = handleAt(host.execute({ operations: [{ op: 'startNewList', paragraph }] }), 0);
  expect(
    host.execute({
      operations: [
        {
          op: 'setListLevelFormat',
          list,
          level: 0,
          format: { numbering: 'Arabic', startingNumber: 3 },
        },
      ],
    }).ok
  ).toBe(true);
  const saved = host.save();
  if (!saved.ok) throw new Error('save failed');
  const files = unzipSync(saved.bytes);
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => /^(word\/(document|header\d+|numbering)\.xml)$/.test(name))
      .map(([name, bytes]) => [name, strFromU8(bytes)])
  );
}

test('browser and headless hosts save identical new headers and numbered lists', () => {
  const bytes = docx('<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>');
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error('open failed');
  const editor = createDocxEditor({ container: document.createElement('div'), document: bytes });
  const browser = createBrowserAutomationHost(editor);
  try {
    expect(edit(browser)).toEqual(edit(opened.host));
  } finally {
    browser.dispose();
    opened.host.dispose();
    editor.destroy();
  }
});
