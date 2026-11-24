// React tree-lane wiring contract (legacy-lane retirement, phase 3).
//
// `DocxEditor` is a THIN host over `createDocxEditor`: it owns a container element, the
// facade's lifetime, and prop-to-facade forwarding — nothing else. These assertions are
// the static half a headless run can enforce on every commit: the adapter must reach the
// engine through the composition root, program against the `Editor` contract alone, and
// derive no geometry of its own. The predecessor of this file pinned the legacy display
// pipeline (adapter event bridge, display lists, paint gates); the tree lane's surface
// owns interaction and painting internally, so those rules are replaced, not dropped.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');

// The host is now sugar over the provider-first composition layer, so the wiring these
// rules pin lives across the sugar component AND the primitives it composes. The rules
// apply to the union: the facade must be created/destroyed somewhere in this set, and
// the forbidden symbols must appear nowhere in it.
const editorSourcePaths = [
  join(SRC, 'components', 'DocxEditor.tsx'),
  join(SRC, 'editor', 'context.ts'),
  join(SRC, 'editor', 'loading-snapshot.ts'),
  join(SRC, 'editor', 'DocxEditorRoot.tsx'),
  join(SRC, 'editor', 'DocxEditorViewport.tsx'),
  join(SRC, 'editor', 'DocxEditorContent.tsx'),
  join(SRC, 'editor', 'useEditorState.ts'),
  join(SRC, 'editor', 'useEditorCommand.ts'),
  join(SRC, 'editor', 'useEditorEvent.ts'),
];
const editorSources = new Map(editorSourcePaths.map((path) => [path, readFileSync(path, 'utf8')]));
const editorSource = [...editorSources.values()].join('\n');
const viewportPath = join(SRC, 'editor', 'DocxEditorViewport.tsx');
const viewportSource = editorSources.get(viewportPath)!;
const nonViewportSource = [...editorSources.entries()]
  .filter(([path]) => path !== viewportPath)
  .map(([, source]) => source)
  .join('\n');

describe('React tree-lane wiring (phase 3)', () => {
  test('the editor is created through the composition root facade', () => {
    expect(editorSource).toContain('createDocxEditor');
    expect(editorSource).toContain("from '@docx-editor.dev/core/editor'");
    // The legacy engine constructor and its display pipeline must be gone.
    for (const forbidden of [
      'createEditor(',
      'attachAdapterEventBridge',
      'installDisplayFonts',
      'PaintEpochGate',
      'EditorHost',
    ]) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('the adapter programs against the Editor contract, never the surface escape hatch', () => {
    // `DocxEditorInstance.surface` exists for harnesses and tests; a production adapter that
    // reaches through it is depending on internals the contract does not name.
    expect(editorSource).not.toContain('.surface');
  });

  test('no adapter-side geometry derivation', () => {
    for (const forbidden of [
      'getBoundingClientRect',
      'getClientRects',
      'elementFromPoint',
      'caretRangeFromPoint',
    ]) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('pointer input stays surface-owned, and keyboard zoom stays viewport-scoped', () => {
    // Pointer, caret, and selection stay in the paginated surface. This task adds one
    // viewport-scoped keyboard hook for zoom shortcuts; it must not turn into a global listener.
    for (const forbidden of ['onPointerDown=', 'onPointerMove=', 'onPointerUp=']) {
      expect(editorSource).not.toContain(forbidden);
    }
    expect(viewportSource).toContain('zoomLevelForShortcut');
    // CAPTURE phase, and exactly one binding: the engine keymap on the painted pages binds
    // the same Ctrl/Cmd+`=` chord, so zoom has to claim the event before the pages see it.
    expect(viewportSource.match(/onKeyDownCapture=/g)?.length ?? 0).toBe(1);
    expect(viewportSource).not.toContain('onKeyDown=');
    expect(nonViewportSource).not.toContain('onKeyDown=');
    expect(nonViewportSource).not.toContain('onKeyDownCapture=');
    for (const forbidden of [
      "document.addEventListener('keydown'",
      "document.removeEventListener('keydown'",
      "window.addEventListener('keydown'",
      "window.removeEventListener('keydown'",
    ]) {
      expect(editorSource).not.toContain(forbidden);
    }
  });

  test('the adapter never imports ProseMirror or a private engine package', () => {
    for (const forbidden of ['prosemirror', 'engine-binding', 'engine-layout', 'engine-core']) {
      expect(editorSource.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('the facade is destroyed on cleanup', () => {
    expect(editorSource).toContain('instance.destroy()');
  });

  test('the container carries the shared style-scope and surface classes', () => {
    // docx-editor scopes every --doc-* token AND every compiled Tailwind utility;
    // docx-paginated-surface carries the engine surface's paper styling. Without either,
    // pages paint unstyled. Matched as a CLASS rather than a substring: the package name
    // `@docx-editor.dev/...` contains the scope name, so a plain `toContain` passes even
    // when nothing puts the class on an element.
    expect(editorSource).toMatch(/className=[^\n]*\bdocx-editor\b/);
    expect(editorSource).toMatch(/className=[^\n]*\bdocx-paginated-surface\b/);
  });

  test('zoom flows through setZoom, never a remount', () => {
    // Remounting on zoom reopens the document from bytes and discards every edit,
    // the caret, and the undo history.
    expect(editorSource).toContain('setZoom');
  });

  test('document changes are forwarded from the facade change event', () => {
    expect(editorSource).toContain("on('change'");
  });
});
