import { definePopup } from '../src/editor/popup-renderer';
// DocxEditor.ContentControl — inspector, remove, accessibility, focus preservation.
//
// Against the REAL engine: a mounted document with an SDT, caret inside it, live query
// state. Widgets for list/date payloads are NOT covered here — those payloads are not
// public on ContentControlSummary, so the adapter leaves them to the engine.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

import { useEffect, useState } from 'react';
import { useDocxEditor } from '../src/editor/context';
import { DocxEditorContentControlWidget } from '../src/editor/DocxEditorContentControlWidget';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorContentControl } from '../src/editor/DocxEditorContentControl.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { useContentControl } from '../src/editor/useContentControl.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
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
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sdt = (sdtPr: string, content: string) =>
  `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

const PLAIN = docx(
  sdt(`<w:alias w:val="Project"/><w:tag w:val="project"/><w:text/>`, p('Enter project name'))
);
const LOCKED = docx(
  sdt(
    `<w:alias w:val="Locked"/><w:tag w:val="locked"/><w:lock w:val="contentLocked"/><w:text/>`,
    p('cannot edit')
  )
);
const REMOVAL_LOCKED = docx(
  sdt(`<w:alias w:val="Keep"/><w:lock w:val="sdtLocked"/><w:text/>`, p('editable but kept'))
);
const BOUND = docx(
  sdt(
    `<w:alias w:val="Bound"/><w:dataBinding w:xpath="/a" w:storeItemID="{G}"/><w:text/>`,
    p('from xml')
  )
);
const DROPDOWN = docx(
  sdt(
    `<w:dropDownList>` +
      `<w:listItem w:displayText="One" w:value="1"/>` +
      `<w:listItem w:displayText="Two" w:value="2"/>` +
      `</w:dropDownList>`,
    p('One')
  )
);
const CHECKBOX = docx(
  sdt(
    `<w14:checkbox>` +
      `<w14:checked w14:val="0"/>` +
      `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
      `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>` +
      `</w14:checkbox>`,
    `<w:p><w:r><w:sym w:font="MS Gothic" w:char="2610"/></w:r></w:p>`
  )
);

interface Mounted {
  readonly view: ReturnType<typeof render>;
  editor(): DocxEditorInstance;
}

function Probe() {
  const chrome = useContentControl();
  return (
    <div
      data-testid="content-control-probe"
      data-has-control={chrome.control ? '1' : '0'}
      data-alias={chrome.control?.alias ?? ''}
      data-tag={chrome.control?.tag ?? ''}
      data-type={chrome.control?.controlType ?? ''}
      data-locked={chrome.control?.locked ? '1' : '0'}
      data-removal-locked={chrome.control?.removalLocked ? '1' : '0'}
      data-bound={chrome.control?.bound ? '1' : '0'}
      data-placeholder={chrome.control?.placeholder ? '1' : '0'}
      data-can-remove={chrome.canRemove ? '1' : '0'}
      data-can-set-value={chrome.canSetValue ? '1' : '0'}
      data-show-all={chrome.showAll ? '1' : '0'}
      data-form-fill={chrome.formFill ? '1' : '0'}
      data-inspector-open={chrome.inspectorOpen ? '1' : '0'}
      data-remove-reason={chrome.removeDisabledReason ?? ''}
      data-set-value-reason={chrome.setValueDisabledReason ?? ''}
    />
  );
}

function ShowAllDriver() {
  const { setShowAll, setFormFill } = useContentControl();
  return (
    <>
      <button type="button" data-testid="driver-show-all" onClick={() => setShowAll(true)} />
      <button type="button" data-testid="driver-hide-all" onClick={() => setShowAll(false)} />
      <button type="button" data-testid="driver-form-fill" onClick={() => setFormFill(true)} />
    </>
  );
}

function SetValueDriver({ value }: { value: string }) {
  const { setValue } = useContentControl();
  const [result, setResult] = useState<ReturnType<typeof setValue> | null>(null);
  return (
    <>
      <button
        type="button"
        data-testid="driver-set-value"
        onClick={() => setResult(setValue(value))}
      />
      <div
        data-testid="set-value-result"
        data-ok={result === null ? '' : result.ok ? '1' : '0'}
        data-code={result && !result.ok ? result.code : ''}
        data-reason={result && !result.ok ? result.reason : ''}
      />
    </>
  );
}

function OpenInspector() {
  const { openInspector, control } = useContentControl();
  return (
    <button
      type="button"
      data-testid="open-inspector"
      disabled={!control}
      onMouseDown={(event) => {
        const tag = (event.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        event.preventDefault();
      }}
      onClick={() => openInspector()}
    >
      open
    </button>
  );
}

function mount(source: Uint8Array, extras?: React.ReactNode): Mounted {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.ContentControlInspector />
        <DocxEditorToolbar.ContentControlRemove />
        <DocxEditorToolbar.ContentControlShowAll />
        <DocxEditorToolbar.ContentControlFormFill />
      </DocxEditorToolbar>
      <Probe />
      <ShowAllDriver />
      <OpenInspector />
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorContentControl />
        {extras}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function caret(mounted: Mounted, offset: number, paragraphIndex = 0): void {
  act(() => {
    const paragraphId = mounted.editor().surface!.session.paragraphIds()[paragraphIndex]!;
    mounted.editor().surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  });
}

function probe(mounted: Mounted): HTMLElement {
  return mounted.view.getByTestId('content-control-probe');
}

afterEach(() => {
  cleanup();
});

describe('content-control authoring surface', () => {
  test('live inspector state follows the caret into a control', () => {
    const mounted = mount(PLAIN);
    // A block control wraps the only paragraph, so the default caret is already inside.
    caret(mounted, 2);
    const live = probe(mounted);
    expect(live.dataset.hasControl).toBe('1');
    expect(live.dataset.alias).toBe('Project');
    expect(live.dataset.tag).toBe('project');
    expect(live.dataset.type).toBe('plainText');
    expect(live.dataset.locked).toBe('0');
  });

  test('the shared state keeps its object while the control is unchanged', async () => {
    const seen: unknown[] = [];
    function Track() {
      seen.push(useContentControl());
      return null;
    }
    const mounted = mount(PLAIN, <Track />);
    caret(mounted, 2);
    // Typing inside the control changes its text, not its state.
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await act(async () => {
      await frame();
      await frame();
    });
    const settled = seen.at(-1);
    const renders = seen.length;
    for (const text of ['a', 'b']) {
      await act(async () => {
        mounted.editor().surface!.type(text);
        await frame();
        await frame();
      });
    }
    expect(mounted.editor().surface!.session.bodyText()).toContain('Enab');
    expect(seen.at(-1)).toBe(settled);
    expect(seen.length).toBe(renders);
  });

  test('inspector panel reports alias, tag, type, and lock', () => {
    const mounted = mount(PLAIN);
    caret(mounted, 2);
    act(() => {
      fireEvent.click(mounted.view.getByTestId('open-inspector'));
    });

    const panel = mounted.view.getByTestId('content-control-inspector');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(mounted.view.getByTestId('content-control-inspector-alias').textContent).toContain(
      'Project'
    );
    expect(mounted.view.getByTestId('content-control-inspector-tag').textContent).toContain(
      'project'
    );
    expect(mounted.view.getByTestId('content-control-inspector-type').textContent).toMatch(
      /Plain text|plainText/i
    );
    expect(mounted.view.getByTestId('content-control-inspector-lock').textContent).toMatch(
      /Unlocked|unlocked/i
    );
  });

  test('content-locked control disables editing affordances with the engine reason', () => {
    const mounted = mount(LOCKED);
    caret(mounted, 2);
    const live = probe(mounted);
    expect(live.dataset.locked).toBe('1');
    // contentLocked forbids content edits, not unwrap — remove stays available.
    expect(live.dataset.canRemove).toBe('1');

    act(() => {
      fireEvent.click(mounted.view.getByTestId('open-inspector'));
    });
    const remove = mounted.view.getByTestId('content-control-inspector-remove');
    expect(remove).toHaveProperty('disabled', false);
    expect(mounted.view.getByTestId('content-control-inspector-locked-note')).toBeTruthy();
  });

  test('sdtLocked reports content editable but remove disabled', () => {
    const mounted = mount(REMOVAL_LOCKED);
    caret(mounted, 2);
    const live = probe(mounted);
    expect(live.dataset.locked).toBe('0');
    expect(live.dataset.removalLocked).toBe('1');
    expect(live.dataset.canRemove).toBe('0');
    expect(live.dataset.removeReason).toMatch(/locked/i);
  });

  test('bound control is reported and remove stays available only when unlocked', () => {
    const mounted = mount(BOUND);
    caret(mounted, 2);
    act(() => {
      fireEvent.click(mounted.view.getByTestId('open-inspector'));
    });
    const live = probe(mounted);
    expect(live.dataset.bound).toBe('1');
    expect(live.dataset.canSetValue).toBe('0');
    expect(live.dataset.setValueReason).toMatch(/bound/i);
    expect(mounted.view.getByTestId('content-control-inspector-bound-note')).toBeTruthy();
    expect(mounted.view.getByTestId('content-control-inspector-bound')).toBeTruthy();
  });

  test('query fallback derives bound and lock axes when boundary hit-test is empty', () => {
    const mounted = mount(BOUND);
    caret(mounted, 2);
    const ops = mounted.editor().surface!.contentControls;
    const previous = ops.atCaret;
    ops.atCaret = () => null;
    try {
      caret(mounted, 3);
      const live = probe(mounted);
      expect(live.dataset.hasControl).toBe('1');
      expect(live.dataset.bound).toBe('1');
      expect(live.dataset.locked).toBe('0');
      expect(live.dataset.canSetValue).toBe('0');
      expect(live.dataset.setValueReason).toMatch(/bound/i);
    } finally {
      ops.atCaret = previous;
    }
  });

  test('query fallback keeps content lock and wrapper lock on separate axes', () => {
    const mounted = mount(REMOVAL_LOCKED);
    caret(mounted, 2);
    const ops = mounted.editor().surface!.contentControls;
    const previous = ops.atCaret;
    ops.atCaret = () => null;
    try {
      caret(mounted, 1);
      const live = probe(mounted);
      expect(live.dataset.hasControl).toBe('1');
      expect(live.dataset.locked).toBe('0');
      expect(live.dataset.removalLocked).toBe('1');
      expect(live.dataset.canRemove).toBe('0');
      expect(live.dataset.canSetValue).toBe('1');
    } finally {
      ops.atCaret = previous;
    }
  });

  test('direct setShowAll updates subscribed React state', () => {
    const mounted = mount(PLAIN);
    expect(probe(mounted).dataset.showAll).toBe('0');
    act(() => {
      fireEvent.click(mounted.view.getByTestId('driver-show-all'));
    });
    expect(probe(mounted).dataset.showAll).toBe('1');
    expect(mounted.editor().surface!.contentControls.showAll()).toBe(true);
    act(() => {
      fireEvent.click(mounted.view.getByTestId('driver-hide-all'));
    });
    expect(probe(mounted).dataset.showAll).toBe('0');
  });

  test('remove keeps content and clears the wrapper', () => {
    const mounted = mount(PLAIN);
    caret(mounted, 2);
    expect(mounted.editor().query({ type: 'contentControls' })).toHaveLength(1);

    act(() => {
      fireEvent.click(mounted.view.getByTestId('open-inspector'));
    });
    act(() => {
      fireEvent.click(mounted.view.getByTestId('content-control-inspector-remove'));
    });

    expect(mounted.editor().query({ type: 'contentControls' })).toHaveLength(0);
    expect(mounted.editor().query({ type: 'contentControlAt' })).toBeNull();
    expect(mounted.editor().query({ type: 'paragraphs' })[0]?.text).toBe('Enter project name');
    expect(mounted.view.queryByTestId('content-control-inspector')).toBeNull();
  });

  test('toolbar remove is accessible and disabled when wrapper is locked', () => {
    const mounted = mount(REMOVAL_LOCKED);
    caret(mounted, 2);
    const button = mounted.view.container.querySelector(
      '[data-slot="contentControl.remove"]'
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBeTruthy();
    expect(button.getAttribute('title')).toMatch(/locked/i);
  });

  test('inspector mousedown preserves the caret', () => {
    const mounted = mount(PLAIN);
    caret(mounted, 3);
    const before = mounted.editor().surface!.state().selection.head;

    act(() => {
      fireEvent.click(mounted.view.getByTestId('open-inspector'));
    });
    const panel = mounted.view.getByTestId('content-control-inspector');
    act(() => {
      fireEvent.mouseDown(panel);
    });

    const after = mounted.editor().surface!.state().selection.head;
    expect(after.paragraphId).toBe(before.paragraphId);
    expect(after.offset).toBe(before.offset);
  });

  test('show-all and form-fill toggles are pressable and aria-pressed', () => {
    const mounted = mount(PLAIN);
    const showAll = mounted.view.container.querySelector(
      '[data-slot="contentControl.showAll"]'
    ) as HTMLButtonElement;
    const formFill = mounted.view.container.querySelector(
      '[data-slot="contentControl.formFill"]'
    ) as HTMLButtonElement;
    expect(showAll.getAttribute('aria-pressed')).toBe('false');
    expect(formFill.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      fireEvent.click(showAll);
    });
    expect(showAll.getAttribute('aria-pressed')).toBe('true');
    expect(showAll.getAttribute('data-active')).toBe('');

    act(() => {
      fireEvent.click(formFill);
    });
    expect(formFill.getAttribute('aria-pressed')).toBe('true');
  });

  test('setValue preserves engine invalidArgs for dropdown values', () => {
    const mounted = mount(DROPDOWN, <SetValueDriver value="9" />);
    caret(mounted, 1);
    act(() => {
      fireEvent.click(mounted.view.getByTestId('driver-set-value'));
    });
    const result = mounted.view.getByTestId('set-value-result');
    expect(result.dataset.ok).toBe('0');
    expect(result.dataset.code).toBe('invalidArgs');
    expect(result.dataset.reason).toMatch(/not valid/i);
  });

  test('setValue preserves engine typeMismatch for checkbox values', () => {
    const mounted = mount(CHECKBOX, <SetValueDriver value="maybe" />);
    caret(mounted, 0);
    act(() => {
      fireEvent.click(mounted.view.getByTestId('driver-set-value'));
    });
    const result = mounted.view.getByTestId('set-value-result');
    expect(result.dataset.ok).toBe('0');
    expect(result.dataset.code).toBe('typeMismatch');
    expect(result.dataset.reason).toMatch(/does not match/i);
  });
});

for (const mode of ['native', 'custom', 'component', 'manual'] as const) {
  test(`value widget ownership: ${mode}`, async () => {
    let manual: ContentControlWidgetSession | undefined;
    let editor: DocxEditorInstance | undefined;
    function ManualOwner() {
      const owner = useDocxEditor();
      useEffect(
        () =>
          owner?.setContentControlWidgetChrome({
            onRequest(session) {
              manual = session;
            },
          }),
        [owner]
      );
      return null;
    }
    const view = render(
      <DocxEditorRoot
        document={DROPDOWN}
        onReady={(value) => {
          editor = value as DocxEditorInstance;
        }}
        popups={{
          contentControlWidget:
            mode === 'native'
              ? undefined
              : mode === 'manual'
                ? false
                : mode === 'component'
                  ? definePopup(DocxEditorContentControlWidget)
                  : (props) => <DocxEditorContentControlWidget {...props} />,
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          {mode === 'manual' ? <ManualOwner /> : null}
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => {});
    await act(async () => {
      editor!.focus();
    });
    const opener = document.activeElement;
    const widget = view.container.querySelector<HTMLElement>('[data-docx-cc-widget="dropdown"]');
    expect(widget !== null).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(widget!, { button: 0, pointerId: 1, pointerType: 'mouse' });
    });
    expect(view.container.querySelectorAll('.docx-content-control-menu').length).toBe(
      mode === 'native' ? 1 : 0
    );
    expect(view.container.querySelectorAll('[data-docx-popup="contentControlWidget"]').length).toBe(
      mode === 'custom' || mode === 'component' ? 1 : 0
    );
    if (mode === 'manual') {
      expect(manual !== undefined).toBe(true);
      expect(manual!.signal.aborted).toBe(false);
      await act(async () => {
        expect(manual!.apply('2')).toBe(true);
      });
      expect(editor!.surface!.session.bodyText()).toContain('Two');
    }
    if (mode === 'custom' || mode === 'component') {
      // The packaged dropdown is the same list the engine paints: one option per entry, the
      // current value marked, and a press commits at once — no Apply step, as in Word.
      // Scoped to the pop-up: the painted widget button itself carries role="listbox".
      const popup = view.container.querySelector<HTMLElement>(
        '[data-docx-popup="contentControlWidget"]'
      )!;
      const list = popup.querySelector<HTMLElement>('[role="listbox"]')!;
      const options = [...popup.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      expect(options.map((option) => option.textContent)).toEqual(['One', 'Two']);
      expect(options[0]!.getAttribute('aria-selected')).toBe('true');
      expect(list.contains(document.activeElement)).toBe(true);
      await act(async () => {
        fireEvent.click(options[1]!);
      });
      expect(
        view.container.querySelectorAll('[data-docx-popup="contentControlWidget"]').length
      ).toBe(0);
      expect(editor!.surface!.session.bodyText()).toContain('Two');
      expect(document.activeElement === opener).toBe(true);
    }
  });
}

const CHECKBOX_PRESS = docx(
  `<w:p><w:r><w:t xml:space="preserve">Done: </w:t></w:r>${sdt(
    `<w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
      `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`,
    `<w:r><w:t>☐</w:t></w:r>`
  )}<w:r><w:t xml:space="preserve"> yes</w:t></w:r></w:p>`
);

for (const configured of [false, true]) {
  test(`checkbox presses reach a renderer only through contentControlCheckbox (${configured})`, async () => {
    const seen: ContentControlWidgetSession['kind'][] = [];
    const Recorder = (props: { session: ContentControlWidgetSession }) => {
      seen.push(props.session.kind);
      return <DocxEditorContentControlWidget {...props} />;
    };
    const view = render(
      <DocxEditorRoot
        document={CHECKBOX_PRESS}
        popups={{
          contentControlWidget: (props) => <Recorder {...props} />,
          ...(configured ? { contentControlCheckbox: (props) => <Recorder {...props} /> } : {}),
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => {});
    const widget = view.container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]');
    expect(widget !== null).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(widget!, { button: 0, pointerId: 1, pointerType: 'mouse' });
    });
    // Either way the box flips: the engine toggles it when no renderer takes the press, and
    // the packaged renderer applies the toggle at once when one does.
    expect(
      view.container
        .querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]')
        ?.getAttribute('data-checked')
    ).toBe('true');
    // A pop-up renderer written for dropdowns never sees the checkbox session.
    expect(seen).toEqual(configured ? ['checkbox'] : []);
  });
}

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMG_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const GLOSSARY_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument';

/** A document whose main part carries an image relationship and, optionally, a glossary. */
function richDocx(body: string, glossary?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (glossary
          ? '<Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>` +
        (glossary
          ? `<Relationship Id="rIdGl" Type="${GLOSSARY_REL}" Target="glossary/document.xml"/>`
          : '') +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
    ...(glossary ? { 'word/glossary/document.xml': strToU8(glossary) } : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const PICTURE_PRESS = richDocx(
  `<w:p><w:r><w:t xml:space="preserve">Photo: </w:t></w:r>${sdt(
    '<w:alias w:val="Photo"/><w:picture/>',
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="457200" cy="457200"/><wp:docPr id="3" name="pic"/>' +
      `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
      '<pic:nvPicPr><pic:cNvPr id="3" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  )}</w:p>`
);

const GALLERY_PRESS = richDocx(
  `<w:p><w:r><w:t xml:space="preserve">Pick: </w:t></w:r>${sdt(
    '<w:alias w:val="Block"/><w:showingPlcHdr/><w:docPartList><w:docPartGallery w:val="Quick Parts"/></w:docPartList>',
    '<w:r><w:t>Choose a building block.</w:t></w:r>'
  )}</w:p>`,
  `<w:glossaryDocument xmlns:w="${W}"><w:docParts>` +
    '<w:docPart><w:docPartPr><w:name w:val="Sign-off"/><w:category><w:name w:val="General"/><w:gallery w:val="docParts"/></w:category></w:docPartPr>' +
    '<w:docPartBody><w:p><w:r><w:t>Approved by the board</w:t></w:r></w:p></w:docPartBody></w:docPart>' +
    '<w:docPart><w:docPartPr><w:name w:val="Address"/><w:category><w:name w:val="General"/><w:gallery w:val="docParts"/></w:category></w:docPartPr>' +
    '<w:docPartBody><w:p><w:r><w:t>1 Main St</w:t></w:r></w:p></w:docPartBody></w:docPart>' +
    '</w:docParts></w:glossaryDocument>'
);

for (const configured of [false, true]) {
  test(`picture presses reach a renderer only through contentControlPicture (${configured})`, async () => {
    const seen: ContentControlWidgetSession['kind'][] = [];
    const Recorder = (props: { session: ContentControlWidgetSession }) => {
      seen.push(props.session.kind);
      return <DocxEditorContentControlWidget {...props} />;
    };
    const view = render(
      <DocxEditorRoot
        document={PICTURE_PRESS}
        popups={{
          contentControlWidget: (props) => <Recorder {...props} />,
          ...(configured ? { contentControlPicture: (props) => <Recorder {...props} /> } : {}),
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await act(async () => {});
    const widget = view.container.querySelector<HTMLElement>('[data-docx-cc-widget="picture"]');
    expect(widget !== null).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(widget!, { button: 0, pointerId: 1, pointerType: 'mouse' });
    });
    // The packaged renderer is a file input in a panel that takes no room; without the
    // entry the engine arms its own picker on the pages layer, and the pop-up renderer
    // written for lists never sees the press.
    const popup = view.container.querySelector<HTMLElement>(
      '[data-docx-popup="contentControlWidget"]'
    );
    expect(popup !== null).toBe(configured);
    expect(popup?.querySelector('[data-docx-part=picture]') !== null && popup !== null).toBe(
      configured
    );
    expect(
      view.container.querySelector('input[type="file"][data-docx-part="picture"]') !== null
    ).toBe(configured);
    expect(view.container.querySelector('.docx-content-control-picture-picker') !== null).toBe(
      !configured
    );
    expect(seen).toEqual(configured ? ['picture'] : []);
  });
}

test('a gallery press renders the packaged list of glossary blocks, and a pick lands one', async () => {
  let editor: DocxEditorInstance | undefined;
  const view = render(
    <DocxEditorRoot
      document={GALLERY_PRESS}
      onReady={(instance) => {
        editor = instance;
      }}
      popups={{ contentControlWidget: (props) => <DocxEditorContentControlWidget {...props} /> }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await act(async () => {});
  const widget = view.container.querySelector<HTMLElement>(
    '[data-docx-cc-widget="buildingBlockGallery"]'
  );
  expect(widget !== null).toBe(true);
  await act(async () => {
    fireEvent.pointerDown(widget!, { button: 0, pointerId: 1, pointerType: 'mouse' });
  });
  const popup = view.container.querySelector<HTMLElement>(
    '[data-docx-popup="contentControlWidget"]'
  )!;
  expect(popup.getAttribute('data-kind')).toBe('buildingBlockGallery');
  const options = [...popup.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.map((option) => option.textContent)).toEqual(['Address', 'Sign-off']);
  await act(async () => {
    options[1]!.click();
  });
  expect(editor!.surface!.session.bodyText()).toBe('Pick: Approved by the board');
  expect(view.container.querySelector('[data-docx-popup="contentControlWidget"]')).toBeNull();
});
