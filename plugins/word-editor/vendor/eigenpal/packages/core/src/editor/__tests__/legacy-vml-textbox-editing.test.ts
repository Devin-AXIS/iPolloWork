// Legacy VML text boxes: Find reaches their story, a match or a press enters it, and edits
// use the same frame scope as a DrawingML text box. An upright box moves and resizes through
// its frame; the shape takes no wrap or crop changes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedImageStateOf } from '../docx-editor-images.ts';
import { paintRemoteSelections } from '../surface-remote-selection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const W10 = 'urn:schemas-microsoft-com:office:word';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function floatingBox(text: string): string {
  return (
    '<w:r><w:pict><v:rect style="position:absolute;margin-left:200pt;margin-top:0;width:144pt;' +
    'height:48pt;z-index:1;mso-position-horizontal-relative:page" fillcolor="#ccecff">' +
    `<v:textbox><w:txbxContent><w:p>${run(text)}</w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r>`
  );
}

function inlineBox(text: string): string {
  return (
    '<w:r><w:pict><v:shape type="#_x0000_t202" style="width:144pt;height:36pt;' +
    'mso-position-horizontal-relative:char;mso-position-vertical-relative:line">' +
    `<v:textbox><w:txbxContent><w:p>${run(text)}</w:p></w:txbxContent></v:textbox>` +
    '<w10:anchorlock/></v:shape></w:pict></w:r>'
  );
}

function vmlDocx(box: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:w10="${W10}"><w:body>` +
        `<w:p>${run('body')}</w:p><w:p>${run('before ')}${box}${run(' after')}</w:p>` +
        '</w:body></w:document>'
    ),
  });
}

for (const [kind, box] of [
  ['floating', floatingBox],
  ['inline', inlineBox],
] as const) {
  test(`Find reaches a ${kind} VML box, and its story takes typing, undo, redo, and save`, async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: vmlDocx(box('boxed needle')),
    });
    try {
      const match = editor.findMatches('boxed needle')[0]!;
      expect(match.scope?.kind).toBe('frame');
      expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
      expect(editor.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
      expect(editor.findMatches('New boxed needle')[0]?.scope?.kind).toBe('frame');
      expect(editor.findMatches('before')).toHaveLength(1);
      editor.exec({ type: 'undo' });
      expect(editor.findMatches('New ')).toHaveLength(0);
      editor.exec({ type: 'redo' });
      const saved = new Uint8Array(await editor.save());
      const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
      expect(xml).toContain('<v:textbox><w:txbxContent>');
      expect(xml).toContain('New boxed needle');
      const reopened = createDocxEditor({
        container: document.createElement('div'),
        document: saved,
      });
      try {
        expect(reopened.findMatches('New boxed needle')[0]?.scope?.kind).toBe('frame');
      } finally {
        reopened.destroy();
      }
    } finally {
      editor.destroy();
    }
  });
}

test('a press on the VML box text enters its story and paints the text', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: vmlDocx(floatingBox('boxed needle')) });
  try {
    const content = container.querySelector('.docx-drawing-textbox-content')!;
    expect(content.textContent).toContain('boxed needle');
    content.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    );
    expect(editor.surface!.activeScope().kind).toBe('frame');
    const active = container.querySelector<HTMLElement>('[data-docx-textbox-active="true"]');
    expect(active?.querySelector('[data-paragraph-id]')).not.toBeNull();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('the VML text box frame moves and resizes, with no wrap or crop controls', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: vmlDocx(floatingBox('boxed needle')),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    expect(editor.selectMatch(match).ok).toBe(true);
    expect(selectedImageStateOf(editor.surface!)).toMatchObject({
      canMove: true,
      canResize: true,
      canChangeWrap: false,
      canCrop: false,
    });
    expect(editor.exec({ type: 'setImagePosition', horizontalEmu: 3175000 }).ok).toBe(true);
    expect(
      editor.exec({ type: 'setImageProperties', widthEmu: 2540000, heightEmu: 762000 }).ok
    ).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    // Only the geometry entries change, in place; the rest of the style stays as authored.
    expect(xml).toContain(
      'style="position:absolute;margin-left:250pt;margin-top:0;width:200pt;height:60pt;z-index:1;' +
        'mso-position-horizontal-relative:page"'
    );
    expect(editor.findMatches('boxed needle')[0]?.scope?.kind).toBe('frame');
  } finally {
    editor.destroy();
  }
});

test('a turned VML text box keeps its geometry as authored', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: vmlDocx(floatingBox('boxed needle').replace('z-index:1;', 'z-index:1;rotation:30;')),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    expect(editor.selectMatch(match).ok).toBe(true);
    expect(selectedImageStateOf(editor.surface!)).toBeNull();
    expect(editor.exec({ type: 'setImagePosition', horizontalEmu: 3175000 }).ok).toBe(false);
  } finally {
    editor.destroy();
  }
});

test('a remote caret and range paint inside the VML box', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: vmlDocx(floatingBox('boxed needle')),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    const scope = match.scope;
    if (scope?.kind !== 'frame') throw new Error('Missing text box scope');
    const layout = editor.surface!.layout();
    const drawing = layout.pages[0]!.anchoredDrawings!.find(
      (item) => item.drawingNodeId === scope.drawingNodeId
    )!;
    const remote = {
      actorId: 'peer',
      name: 'Peer',
      anchor: { nodeId: match.blockId, paragraphId: '00000001', offset: 0 },
      head: { nodeId: match.blockId, paragraphId: '00000001', offset: 0 },
    };
    const layer = document.createElement('div');
    paintRemoteSelections(layer, layout, [remote], { scale: 1 });
    const caret = layer.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    expect(Number.parseFloat(caret!.style.left)).toBeGreaterThanOrEqual(drawing.x);
    expect(Number.parseFloat(caret!.style.left)).toBeLessThan(drawing.x + drawing.width);
    paintRemoteSelections(layer, layout, [{ ...remote, head: { ...remote.head, offset: 5 } }], {
      scale: 1,
    });
    expect(layer.querySelectorAll('.docx-remote-selection-rect').length).toBeGreaterThan(0);
  } finally {
    editor.destroy();
  }
});

test('suggesting enters a pressed box and tracks its typing there, not at the anchor', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: vmlDocx(floatingBox('boxed needle')) });
  try {
    editor.surface!.setEditingMode('suggest');
    editor.surface!.setAuthor('Reviewer');
    container
      .querySelector('.docx-drawing-textbox-content')!
      .dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      );
    expect(editor.surface!.activeScope().kind).toBe('frame');
    expect(editor.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const story = xml.slice(xml.indexOf('<w:txbxContent>'), xml.indexOf('</w:txbxContent>'));
    expect(story).toContain('<w:ins ');
    expect(story).toContain('New ');
    // The only insertion is the one in the box: nothing lands beside the anchor.
    expect(xml.split('<w:ins ')).toHaveLength(2);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('switching to suggesting inside a box keeps the box, and its typing is tracked there', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: vmlDocx(floatingBox('boxed needle')) });
  try {
    editor.surface!.setAuthor('Reviewer');
    container
      .querySelector('.docx-drawing-textbox-content')!
      .dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      );
    expect(editor.surface!.activeScope().kind).toBe('frame');
    editor.surface!.setEditingMode('suggest');
    expect(editor.surface!.activeScope().kind).toBe('frame');
    expect(editor.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const story = xml.slice(xml.indexOf('<w:txbxContent>'), xml.indexOf('</w:txbxContent>'));
    expect(story).toContain('<w:ins ');
    expect(xml.split('<w:ins ')).toHaveLength(2);
    // Viewing leaves the box: it takes no caret there.
    editor.surface!.setEditingMode('view');
    expect(editor.surface!.activeScope().kind).toBe('body');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('suggesting moves and resizes the box frame directly, with no tracked change', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: vmlDocx(floatingBox('boxed needle')),
  });
  try {
    editor.surface!.setAuthor('Reviewer');
    editor.surface!.setEditingMode('suggest');
    expect(editor.selectMatch(editor.findMatches('boxed needle')[0]!).ok).toBe(true);
    expect(selectedImageStateOf(editor.surface!)).toMatchObject({
      canMove: true,
      canResize: true,
    });
    expect(editor.exec({ type: 'setImagePosition', horizontalEmu: 3175000 }).ok).toBe(true);
    expect(
      editor.exec({ type: 'setImageProperties', widthEmu: 2540000, heightEmu: 762000 }).ok
    ).toBe(true);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).toContain('margin-left:250pt;margin-top:0;width:200pt;height:60pt;');
    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
    expect(xml).not.toContain('Change ');
  } finally {
    editor.destroy();
  }
});

test('viewing still refuses to enter a box', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: vmlDocx(floatingBox('boxed needle')),
  });
  try {
    editor.surface!.setEditingMode('view');
    const scope = editor.findMatches('boxed needle')[0]!.scope!;
    expect(editor.surface!.setActiveScope(scope)).toBe(false);
  } finally {
    editor.destroy();
  }
});
