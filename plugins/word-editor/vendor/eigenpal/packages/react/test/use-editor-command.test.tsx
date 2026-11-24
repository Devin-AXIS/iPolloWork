// `useEditorCommand` bound to a raw `EditorCommand` rather than a chrome slot.
//
// The whole point of these tests is the payload-change case. The hook memoizes its selector
// so a command object rebuilt every render does not resubscribe the store on every frame —
// and keying that memo on the command's `type` alone was wrong: two commands can share a
// type and mean different things (`mark: 'bold'` vs `'italic'`), `can`/`isActive` answer
// differently for them, and `snapshot()` is version-cached so the stale answer survived
// until some unrelated engine event bumped the version. `execute` reads the live target, so
// the control rendered one state and ran the other command.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  ),
});

afterEach(cleanup);

/** Reads one mark's live state and exposes a control to switch which mark it reads. */
function MarkProbe({ onState }: { onState: (mark: string, active: boolean) => void }) {
  const [mark, setMark] = useState('bold');
  const { isActive } = useEditorCommand({ type: 'toggleMark', mark });
  onState(mark, isActive);
  return (
    <button type="button" data-testid="switch" onClick={() => setMark('italic')}>
      switch
    </button>
  );
}

function mount(node: React.ReactNode): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        {node}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

/**
 * Select the whole first paragraph, so mark state is derivable.
 *
 * `await act` rather than the sync form: `useEditorState` notifies through a DEFERRED
 * notifier, so the subscriber re-render lands after the command returns.
 */
async function selectAll(editor: DocxEditorInstance): Promise<void> {
  await act(async () => {
    editor.exec({ type: 'selectAll' });
  });
}

describe('a raw command target', () => {
  test('re-derives when the payload changes but the type does not', async () => {
    const seen: { mark: string; active: boolean }[] = [];
    const { view, editor } = mount(
      <MarkProbe onState={(mark, active) => seen.push({ mark, active })} />
    );
    await selectAll(editor());

    // The document's only run is bold and not italic.
    expect(seen.at(-1)).toEqual({ mark: 'bold', active: true });

    act(() => {
      view.getByTestId('switch').click();
    });

    // No engine event happened in between — only the payload changed. Keyed on `type` this
    // still reported `true`, i.e. "this text is italic", which it is not.
    expect(seen.at(-1)).toEqual({ mark: 'italic', active: false });
  });

  test('enabled state comes from the engine, per payload', async () => {
    let state: { isEnabled: boolean; disabledReason: string | null } | null = null;
    function Probe() {
      const { isEnabled, disabledReason } = useEditorCommand({ type: 'copy' });
      state = { isEnabled, disabledReason };
      return null;
    }
    const { editor } = mount(<Probe />);

    // Collapsed caret: the engine refuses copy, in its own words.
    expect(state!.isEnabled).toBe(false);
    expect(state!.disabledReason).toBe('nothing is selected');

    await selectAll(editor());
    expect(state!.isEnabled).toBe(true);
  });

  test('execute runs the command, can-before-exec', async () => {
    let run: (() => boolean) | null = null;
    function Probe() {
      const { execute } = useEditorCommand({ type: 'selectAll' });
      run = execute;
      return null;
    }
    const { editor } = mount(<Probe />);

    await act(async () => {
      expect(run!()).toBe(true);
    });

    expect(editor().snapshot().selectionCollapsed).toBe(false);
  });

  test('execute returns false when the engine refuses', () => {
    let run: (() => boolean) | null = null;
    function Probe() {
      const { execute } = useEditorCommand({ type: 'cut' });
      run = execute;
      return null;
    }
    const { editor } = mount(<Probe />);
    const before = editor().snapshot().revision;

    expect(run!()).toBe(false);
    expect(editor().snapshot().revision).toBe(before);
  });

  test('execute returns exec.ok, not a preceding can check', async () => {
    let run: (() => boolean) | null = null;
    function Probe() {
      const { execute } = useEditorCommand({ type: 'insertRow', where: 'below' });
      run = execute;
      return null;
    }
    const TABLE = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
          '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
          '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
          '</w:body></w:document>'
      ),
    });
    let instance: DocxEditorInstance | null = null;
    render(
      <DocxEditorRoot
        document={TABLE}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          <Probe />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => {});
    const editor = instance!;
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    await act(async () => {
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 1 },
      });
    });
    const revisionBefore = editor.surface!.session.revision();
    const origExec = editor.exec.bind(editor);
    editor.exec = () => ({ ok: false, reason: 'stale admission' });
    expect(editor.can({ type: 'insertRow', where: 'below' }).ok).toBe(true);
    expect(run!()).toBe(false);
    expect(editor.surface!.session.revision()).toBe(revisionBefore);
  });
});

// A live control rerenders on every snapshot. That must not mint a new group per frame.
import { useEditorValueCommand } from '../src/editor/useEditorValueCommand.ts';
import { useHistoryGroup } from '../src/editor/useHistoryGroup.ts';
import type { ExecResult } from '@docx-editor.dev/core/contracts/editor';

test('range binding survives React updates, groups two gestures, and cleans up', async () => {
  const results: ExecResult[] = [];
  let currentOptions: ReturnType<typeof useHistoryGroup>['options'] | undefined;
  function RangeProbe() {
    const size = useEditorValueCommand('font.size');
    const gesture = useHistoryGroup({ kind: 'range' });
    currentOptions = gesture.options;
    return (
      <input
        data-testid="live-size"
        ref={gesture.ref}
        type="range"
        min="16"
        max="100"
        disabled={!size.isEnabled}
        value={size.value ?? 22}
        onInput={(event) =>
          results.push(size.execute(Number(event.currentTarget.value), gesture.options()))
        }
      />
    );
  }
  const { view, editor } = mount(<RangeProbe />);
  await selectAll(editor());
  const input = view.getByTestId('live-size') as HTMLInputElement;
  for (const values of [
    [24, 28, 32],
    [40, 44],
  ]) {
    await act(async () => {
      input.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 })
      );
    });
    for (const value of values) {
      await act(async () => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  expect(results.map((r) => (r.ok ? r.history?.kind : r.reason))).toEqual([
    'started',
    'extended',
    'extended',
    'started',
    'extended',
  ]);
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(input.value).toBe('32');
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(editor().snapshot().canUndo).toBe(false);
  const handle = currentOptions!().historyGroup!;
  view.unmount();
  expect(handle.state).toBe('closed');
  expect(() => currentOptions!()).toThrow('not mounted');
});

test('React color onChange retains frames through the native final change', async () => {
  const results: ExecResult[] = [];
  function ColorProbe() {
    const color = useEditorValueCommand('text.color');
    const gesture = useHistoryGroup({ kind: 'native-color' });
    return (
      <input
        data-testid="live-color"
        ref={gesture.ref}
        type="color"
        value={`#${color.value ?? '000000'}`}
        disabled={!color.isEnabled}
        onChange={(event) =>
          results.push(color.execute(event.currentTarget.value.slice(1), gesture.options()))
        }
      />
    );
  }
  const { view, editor } = mount(<ColorProbe />);
  await selectAll(editor());
  const input = view.getByTestId('live-color') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (const [index, values] of [
    ['#00ff00', '#007700', '#0070c0'],
    ['#ff00ff', '#c00000'],
  ].entries()) {
    await act(async () => {
      input.dispatchEvent(
        index === 0
          ? new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 })
          : new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })
      );
    });
    for (const [frame, value] of values.entries()) {
      await act(async () => {
        setValue.call(input, value);
        input.dispatchEvent(
          new Event(frame === values.length - 1 ? 'change' : 'input', { bubbles: true })
        );
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(results.map((result) => (result.ok ? result.history?.kind : result.reason))).toEqual([
    'started',
    'extended',
    'extended',
    'started',
    'extended',
  ]);
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(input.value.toLowerCase()).toBe('#0070c0');
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(editor().snapshot().canUndo).toBe(false);
});
