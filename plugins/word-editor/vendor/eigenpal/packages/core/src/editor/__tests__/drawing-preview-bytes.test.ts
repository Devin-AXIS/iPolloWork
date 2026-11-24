import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import {
  drawingPreviewDocx,
  observeUnsupportedElements,
  type UnsupportedElement,
} from '../index.ts';
import {
  createDrawingPreviewPackage,
  inspectDrawingSupport,
  readOoxmlPackage,
} from '../../store/index.ts';
import { smartArtDocx } from '../../store/__tests__/smartart-fixture.ts';
import { previewDocument, previewShape } from '../../store/__tests__/drawing-support-fixtures.ts';

const documents = {
  'a SmartArt diagram': smartArtDocx({
    shapes: [{ preset: 'rect', off: [1000, 2000], ext: [3000, 4000] }],
  }),
  'a drawing in alternative content': previewDocument(
    `<mc:AlternateContent><mc:Choice Requires="wps">${previewShape(
      '<a:effectLst><a:blur rad="12700"/></a:effectLst>'
    )}</mc:Choice><mc:Fallback><w:pict><v:rect style="width:10pt;height:5pt"/></w:pict>` +
      '</mc:Fallback></mc:AlternateContent>'
  ),
};

for (const [name, bytes] of Object.entries(documents)) {
  test(`the editor and a server build the same preview bytes for ${name}`, async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: bytes,
      unsupportedElementRules: [{ includePartial: true }],
    });
    let elements: UnsupportedElement[] = [];
    const stop = observeUnsupportedElements(container, (hosts) => {
      elements = hosts.map((host) => host.unsupported);
    });
    try {
      // A placeholder, a partly rendered drawing, or a report entry from the live document.
      const target =
        elements[0] ?? inspectDrawingSupport(editor.surface!.session.currentPackage()).entries[0]!;
      const fromEditor = drawingPreviewDocx(editor, target);
      const read = readOoxmlPackage(new Uint8Array((await editor.save())!));
      if (!read.ok) throw new Error(read.reason);
      const entry = inspectDrawingSupport(read.package).entries[0]!;
      const fromServer = createDrawingPreviewPackage(read.package, entry);
      if (!fromEditor.ok || !fromServer.ok) throw new Error('not packaged');
      expect(fromServer.docx).toEqual(fromEditor.docx);
    } finally {
      stop();
      editor.destroy();
      container.remove();
    }
  });
}
