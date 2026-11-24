import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { blankDocumentBytes } from '../blank-document.ts';
import { createDocxEditor } from '../docx-editor.ts';

test('selection retention forwards to the surface and stays safe when detached', () => {
  const editor = createDocxEditor({ document: blankDocumentBytes() });
  expect(editor.retainSelection()).toBeNull();

  const container = document.createElement('div');
  editor.attach(container);
  const retain = editor.surface!.retainSelection;
  const release = editor.surface!.releaseSelection;
  let retained = false;
  let released = false;
  editor.surface!.retainSelection = () => {
    retained = true;
    return retain.call(editor.surface);
  };
  editor.surface!.releaseSelection = (pin) => {
    released = true;
    release.call(editor.surface, pin);
  };

  const pin = editor.retainSelection();
  expect(pin).not.toBeNull();
  editor.releaseSelection(pin!);
  expect(retained).toBe(true);
  expect(released).toBe(true);

  editor.detach();
  retained = false;
  released = false;
  expect(editor.retainSelection()).toBeNull();
  expect(retained).toBe(false);
  expect(released).toBe(false);
  editor.destroy();
});
