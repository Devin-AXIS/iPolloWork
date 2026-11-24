import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { paintRemoteSelections } from '../surface-remote-selection.ts';

test('remote textbox carets and ranges paint inside the box at each zoom', () => {
  const editor = createDocxEditor({ container: document.createElement('div'), document: 'blank' });
  try {
    expect(editor.exec({ type: 'insertTextBox' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'boxed needle' }).ok).toBe(true);
    const surface = editor.surface!;
    const match = editor.findMatches('boxed needle')[0]!;
    expect(surface.setActiveScope(match.scope!)).toBe(true);
    const scope = surface.activeScope();
    if (scope.kind !== 'frame') throw new Error('Missing textbox scope');
    const paragraphId = surface.state().selection.head.paragraphId;
    surface.setActiveScope({ kind: 'body' });
    const layout = surface.layout();
    const drawing = layout.pages[0]!.anchoredDrawings!.find(
      (item) => item.drawingNodeId === scope.drawingNodeId && !item.accessibility.hidden
    )!;
    const remote = {
      actorId: 'peer',
      name: 'Peer',
      anchor: { nodeId: paragraphId, paragraphId: '00000001', offset: 0 },
      head: { nodeId: paragraphId, paragraphId: '00000001', offset: 0 },
    };
    for (const scale of [1, 2]) {
      const layer = document.createElement('div');
      paintRemoteSelections(layer, layout, [remote], { scale });
      const caret = layer.querySelector<HTMLElement>('.docx-remote-caret');
      expect(caret).not.toBeNull();
      expect(Number.parseFloat(caret!.style.left)).toBeGreaterThanOrEqual(drawing.x * scale);
      expect(Number.parseFloat(caret!.style.left)).toBeLessThan(
        (drawing.x + drawing.textboxStory!.contentOffset.x + drawing.textboxStory!.contentWidth) *
          scale
      );
      paintRemoteSelections(layer, layout, [{ ...remote, head: { ...remote.head, offset: 5 } }], {
        scale,
      });
      expect(layer.querySelectorAll('.docx-remote-selection-rect').length).toBeGreaterThan(0);
      expect(layer.querySelector('.docx-remote-caret-label')?.textContent).toBe('Peer');
    }
  } finally {
    editor.destroy();
  }
});
