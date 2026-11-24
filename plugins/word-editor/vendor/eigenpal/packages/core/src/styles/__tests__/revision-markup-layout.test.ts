import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readFileSync } from 'node:fs';

test('framework dialog chrome preserves the markup layout and host spacing tokens', () => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
  const style = document.createElement('style');
  const root = document.createElement('div');
  try {
    style.textContent = readFileSync(new URL('../editor.css', import.meta.url), 'utf8');
    document.head.append(style);
    root.className = 'docx-editor';
    const dialog = document.createElement('dialog');
    dialog.className = 'docx-dialog docx-revision-markup-dialog';
    root.append(dialog);
    document.body.append(root);
    const resolved = window.getComputedStyle(dialog);
    expect(resolved.maxWidth).toBe('624px');
    expect(resolved.padding).toBe('20px');
    root.style.setProperty('--doc-dialog-padding', '28px');
    expect(window.getComputedStyle(dialog).padding).toBe('28px');
    dialog.style.maxWidth = '720px';
    expect(window.getComputedStyle(dialog).maxWidth).toBe('720px');
  } finally {
    root.remove();
    style.remove();
  }
});
