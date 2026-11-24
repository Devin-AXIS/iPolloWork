// The compound toolbar (full-registry default + in-place overrides + the shaped parts).
//
// Against the REAL engine, like editor-composition.test.tsx: a mounted document,
// painted pages, committed ops. What these pin down: the default arrangement IS the
// registry's default bar in registry order (derived from `defaultChromeGroups` here
// too, alignment merged, so a registry change updates the expectation); that a part
// child REPLACES its slot in
// place (and `hidden` removes it); `preset={false}` verbatim rendering; live Bold
// state through a click; asChild prop merging; the wired font-size stepper, zoom
// stepper, and colour split buttons; the undriven pickers rendering disabled; that
// FontFamily's options are the editor's offerable catalog (configured families merged
// with the document's) and selecting one applies it;
// and the caret-preserving mousedown contract.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { createT, en, type TranslationKey, type Translations } from '@docx-editor.dev/i18n';
import { LocaleProvider } from '../src/i18n/index.ts';
import {
  chromeSlotId,
  defaultChromeGroups,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { testReviewModule } from './review-test-module.ts';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

/** `styles` is the content of `w:styles`; the default pins the format defaults. */
function docx(body: string, styles = FORMAT_DOC_DEFAULTS): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

/** Two families named by run-level rFonts, for the font-picker options assertion. */
const FONTED_SOURCE = docx(
  '<w:p>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr><w:t>serif</w:t></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t> mono</w:t></w:r>' +
    '</w:p>'
);

/**
 * The expected default arrangement, DERIVED from the registry exactly as the toolbar
 * derives it: every NON-CONTEXTUAL group in registry order (the default bar,
 * which ends at the editing-mode picker), a separator between groups, and the
 * alignment group MERGED into the one dropdown keyed `'alignment'`.
 * Identities are the parts' `data-slot` markers.
 */
const EXPECTED_ARRANGEMENT: readonly string[] = defaultChromeGroups().flatMap((group, index) => [
  ...(index > 0 ? ['separator'] : []),
  ...(group.id === 'alignment'
    ? ['alignment']
    : group.controls.map((control) => chromeSlotId(group, control) as string)),
]);

function mountToolbar(
  toolbar: ReactNode,
  source: Uint8Array = SOURCE
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      modules={[testReviewModule()]}
      author="Grace Hopper"
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {toolbar}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function toolbarElement(view: ReturnType<typeof render>): HTMLElement {
  return view.getByTestId('docx-toolbar');
}

function entryIdentity(entry: Element): string {
  if (entry.getAttribute('role') === 'separator') return 'separator';
  return entry.getAttribute('data-slot') ?? entry.getAttribute('aria-label') ?? entry.className;
}

/** A group's controls, through each control's `docx-toolbar__item` collapse wrapper. */
function groupEntries(group: Element): Element[] {
  return [...group.children].flatMap((entry) =>
    entry.classList.contains('docx-toolbar__item') ? [...entry.children] : [entry]
  );
}

/** Flatten intentional top-level group wrappers; keep separators and direct children. */
function toolbarArrangement(toolbar: HTMLElement): string[] {
  return [...toolbar.children].flatMap((child) => {
    if (child.getAttribute('role') === 'separator') return 'separator';
    if (
      child.classList.contains('docx-toolbar__group') ||
      child.classList.contains('docx-toolbar__contextual')
    ) {
      return groupEntries(child).map(entryIdentity);
    }
    return entryIdentity(child);
  });
}

function entryRootAtFlatIndex(toolbar: HTMLElement, index: number): Element | null {
  let flat = 0;
  for (const child of toolbar.children) {
    if (child.getAttribute('role') === 'separator') {
      if (flat === index) return child;
      flat += 1;
      continue;
    }
    if (
      child.classList.contains('docx-toolbar__group') ||
      child.classList.contains('docx-toolbar__contextual')
    ) {
      for (const entry of groupEntries(child)) {
        if (flat === index) return entry;
        flat += 1;
      }
      continue;
    }
    if (flat === index) return child;
    flat += 1;
  }
  return null;
}

/** Bare parts resolve labels through the locale catalogue; tests address them by key. */
const label = createT(en);
const byLabel = (key: string): string =>
  `[aria-label=${JSON.stringify(label(key as TranslationKey))}]`;

afterEach(() => {
  cleanup();
});

describe('the default arrangement', () => {
  test('renders the WHOLE chrome registry in registry order, separators between groups', () => {
    const { view } = mountToolbar(<DocxEditorToolbar />);
    const toolbar = toolbarElement(view);
    // The arrangement is derived from the registry on both sides of this assertion —
    // the 10 non-contextual groups, alignment merged — so a registry change updates
    // both in lockstep.
    expect(toolbarArrangement(toolbar)).toEqual([...EXPECTED_ARRANGEMENT]);
    // Every slot is present exactly once.
    for (const slot of EXPECTED_ARRANGEMENT) {
      if (slot === 'separator') continue;
      expect(view.container.querySelectorAll(`[data-slot="${slot}"]`).length).toBe(1);
    }
    // Wired controls are live buttons; the labels come from the registry keys.
    expect(view.container.querySelector(byLabel('formattingBar.boldShortcut'))).not.toBeNull();
    expect(view.container.querySelector(byLabel('formattingBar.undoShortcut'))).not.toBeNull();
    expect(view.container.querySelector('[data-slot="review.authors"]')).toBeNull();
    // No raw key ever reaches the screen — the guard the resolved-label helpers cannot
    // provide, since they resolve through the same catalogue as the code under test.
    expect(toolbar.textContent).not.toContain('toolbar.');
    expect(toolbar.textContent).not.toContain('formattingBar.');
    // The bar self-emits the docx-editor styling scope, like Loading and Viewport.
    expect(toolbar.classList.contains('docx-editor')).toBe(true);
  });

  test('a host can compose the reviewer shortcut with its own icon', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Reviewers icon={<span data-testid="custom-reviewers-icon" />} />
      </DocxEditorToolbar>
    );
    expect(view.container.querySelector('[data-slot="review.authors"]')).not.toBeNull();
    expect(view.getByTestId('custom-reviewers-icon')).not.toBeNull();
  });

  test('LocaleProvider localizes a bare composed toolbar', () => {
    const de = {
      _lang: 'de',
      formattingBar: { boldShortcut: 'Fett (Strg+B)' },
    } as Translations;
    const { view } = mountToolbar(
      <LocaleProvider i18n={de}>
        <DocxEditorToolbar />
      </LocaleProvider>
    );
    expect(view.container.querySelector('[aria-label="Fett (Strg+B)"]')).not.toBeNull();
    // A key the locale leaves out falls through to English, not to the raw key.
    expect(view.container.querySelector(byLabel('formattingBar.undoShortcut'))).not.toBeNull();
  });

  test('a part child overrides its slot IN PLACE; non-part children append', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Bold className="custom-bold" />
        <span data-testid="extra">extra</span>
      </DocxEditorToolbar>
    );
    const toolbar = toolbarElement(view);
    // Same full arrangement (plus the appended extra), with Bold still in its place.
    const identities = toolbarArrangement(toolbar);
    expect(identities.slice(0, EXPECTED_ARRANGEMENT.length)).toEqual([...EXPECTED_ARRANGEMENT]);
    // The Bold in the arrangement IS the override (its className landed).
    const bold = view.container.querySelector(byLabel('formattingBar.boldShortcut'))!;
    expect(bold.className).toContain('custom-bold');
    const boldIndex = EXPECTED_ARRANGEMENT.indexOf('text.bold');
    expect(identities[boldIndex]).toBe('text.bold');
    expect(entryRootAtFlatIndex(toolbar, boldIndex)!.contains(bold)).toBe(true);
    // The non-part child appended in a fixed group after the default set.
    const appended = toolbar.querySelector(
      ':scope > .docx-toolbar__group[data-toolbar-fixed]:last-of-type'
    )!;
    expect(appended.contains(view.getByTestId('extra'))).toBe(true);
  });

  test('a hidden part child removes its slot from the arrangement', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Strike hidden />
      </DocxEditorToolbar>
    );
    const toolbar = toolbarElement(view);
    expect(view.container.querySelector(byLabel('formattingBar.strikethrough'))).toBeNull();
    expect(toolbarArrangement(toolbar).length).toBe(EXPECTED_ARRANGEMENT.length - 1);
    // Neighbours unaffected: underline still present, alignment group intact.
    expect(view.container.querySelector(byLabel('formattingBar.underlineShortcut'))).not.toBeNull();
  });

  test('preset={false} renders only the children, verbatim, in order', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold />
        <DocxEditorToolbar.Separator />
        <DocxEditorToolbar.Undo />
      </DocxEditorToolbar>
    );
    const toolbar = toolbarElement(view);
    expect(toolbarArrangement(toolbar)).toEqual(['text.bold', 'separator', 'history.undo']);
  });
});

describe('live button state', () => {
  test('Bold click applies bold: data-active appears and the snapshot agrees', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const bold = view.container.querySelector(
      byLabel('formattingBar.boldShortcut')
    ) as HTMLButtonElement;
    expect(bold.disabled).toBe(false);
    expect(bold.hasAttribute('data-active')).toBe(false);
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      bold.click();
    });
    expect(bold.hasAttribute('data-active')).toBe(true);
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(editor().snapshot().formatting?.bold).toBe(true);
  });

  test('a generic Button on image.insert reflects engine probe state', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Button slot="image.insert" />
      </DocxEditorToolbar>
    );
    const button = view.container.querySelector(byLabel('toolbar.image')) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('data-disabled')).toBe(false);
    expect(button.title).not.toBe('not wired to an editor command');
    expect(button.hasAttribute('aria-pressed')).toBe(false);
  });

  test('Action is a host-owned control: no slot, our styling, our caret guard', () => {
    // `Button` is slot-bound on purpose — that is what stops a control and its menu twin
    // describing one capability two ways. An action the ENGINE does not model has no slot
    // and never will, and before this the host hand-wrote our private class name.
    let ran = 0;
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Action label="Send for review" onSelect={() => (ran += 1)} />
      </DocxEditorToolbar>
    );
    const action = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Send for review"]'
    )!;
    // Appended after the whole default arrangement — it drives no slot.
    const toolbar = toolbarElement(view);
    const appended = toolbar.querySelector(
      ':scope > .docx-toolbar__group[data-toolbar-fixed]:last-of-type'
    )!;
    expect(appended.contains(action)).toBe(true);
    expect(action.className).toContain('docx-toolbar__button');

    // The caret guard is the reason this is a component and not a documented class name.
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    action.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    act(() => {
      action.click();
    });
    expect(ran).toBe(1);
  });

  test('Action carries pressed and disabled state the host owns', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Action label="Track changes" active />
        <DocxEditorToolbar.Action label="Publish" disabled disabledReason="Needs approval" />
      </DocxEditorToolbar>
    );
    const tracked = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Track changes"]'
    )!;
    expect(tracked.getAttribute('aria-pressed')).toBe('true');
    expect(tracked.hasAttribute('data-active')).toBe(true);

    const publish = view.container.querySelector<HTMLButtonElement>('[aria-label="Publish"]')!;
    expect(publish.disabled).toBe(true);
    // Say WHY, the way the engine's own controls do.
    expect(publish.title).toBe('Needs approval');
  });

  test('asChild merges onto the child: className concat, click toggles, data-active flows', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold asChild className="mine">
          <button type="button" className="theirs" data-testid="as-child-bold">
            B
          </button>
        </DocxEditorToolbar.Bold>
      </DocxEditorToolbar>
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    const child = view.getByTestId('as-child-bold');
    // One rendered element: the child, carrying both class lists.
    expect(child.className).toContain('docx-toolbar__button');
    expect(child.className).toContain('mine');
    expect(child.className).toContain('theirs');
    expect(child.textContent).toBe('B');
    await act(async () => {
      child.click();
    });
    expect(child.hasAttribute('data-active')).toBe(true);
    expect(editor().snapshot().formatting?.bold).toBe(true);
  });
});

/** A run with an explicit 12pt size (`w:sz` is half-points), for the stepper tests. */
const SIZED_SOURCE = docx(
  '<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>sized text</w:t></w:r></w:p>'
);

describe('the shaped parts', () => {
  test('the font-size stepper shows the selection size and a step applies through the engine', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, SIZED_SOURCE);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const stepper = view.container.querySelector('[data-slot="font.size"]')!;
    const value = stepper.querySelector('.docx-toolbar__stepper-value') as HTMLInputElement;
    expect(value.value).toBe('12');
    const increase = stepper.querySelector(byLabel('fontSize.increase')) as HTMLButtonElement;
    expect(increase.disabled).toBe(false);
    await act(async () => {
      increase.click();
    });
    // The stepper walks the PRESET ladder (8..12, 14, 16, ...), not a fixed
    // increment: 12pt steps to 14pt, read back from the engine's snapshot.
    expect(editor().snapshot().formatting?.fontSizePt).toBe(14);
    expect(value.value).toBe('14');
    const decrease = stepper.querySelector(byLabel('fontSize.decrease')) as HTMLButtonElement;
    await act(async () => {
      decrease.click();
    });
    expect(editor().snapshot().formatting?.fontSizePt).toBe(12);
  });

  test('the font-size box opens a preset list, and a pick applies it', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, SIZED_SOURCE);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="font.size"]')!;
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(root.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => {
      input.click();
    });
    const list = root.querySelector('[role="listbox"]')!;
    expect(list).not.toBeNull();
    const options = [...list.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
    expect(options.map((option) => option.textContent)).toEqual([
      '8',
      '9',
      '10',
      '11',
      '12',
      '14',
      '16',
      '18',
      '20',
      '24',
      '28',
      '36',
      '48',
      '72',
    ]);
    // The size in force is the ticked row, so the list opens on the current value.
    expect(options.find((option) => option.hasAttribute('data-selected'))!.textContent).toBe('12');

    await act(async () => {
      options.find((option) => option.textContent === '36')!.click();
    });
    expect(editor().snapshot().formatting?.fontSizePt).toBe(36);
    // Picking closes the list and hands the caret back to the document.
    expect(root.querySelector('[role="listbox"]')).toBeNull();
  });

  test('a size typed into the box applies on Enter, including one off the ladder', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, SIZED_SOURCE);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="font.size"]')!;
    const input = root.querySelector('input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: '13.5' } });
    });
    // The draft is what the box shows while it is being typed, not the document's value.
    expect(input.value).toBe('13.5');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(editor().snapshot().formatting?.fontSizePt).toBe(13.5);
    expect(root.querySelector('[role="listbox"]')).toBeNull();
  });

  test('Escape abandons the typed value, and nonsense reverts rather than clamping', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, SIZED_SOURCE);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="font.size"]')!;
    const input = root.querySelector('input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: '48' } });
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(editor().snapshot().formatting?.fontSizePt).toBe(12);
    expect(input.value).toBe('12');

    // Out of `w:sz`'s range and not a number at all: neither is a size, so neither is
    // silently turned into one the user did not ask for.
    for (const nonsense of ['0', '9999', 'huge', '']) {
      await act(async () => {
        fireEvent.change(input, { target: { value: nonsense } });
        fireEvent.blur(input);
      });
      expect([nonsense, editor().snapshot().formatting?.fontSizePt]).toEqual([nonsense, 12]);
    }
  });

  test('the Paragraph dialog outlives the part that opened it', async () => {
    // The line-spacing part moves between the formatting bar and the overflow panel every
    // time the toolbar re-measures — a window resize, a browser zoom, opening devtools. A
    // dialog mounted inside it went with it, mid-edit, with nothing written and no warning.
    // It lives above the toolbar now, so unmounting the part leaves it standing.
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="list.lineSpacing"]')!;
    await act(async () => {
      (root.querySelector('button') as HTMLButtonElement).click();
    });
    const options = [...root.querySelectorAll('[role="menuitem"]')].find((row) =>
      row.textContent?.includes('Line spacing options')
    ) as HTMLButtonElement;
    await act(async () => {
      options.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    // The dialog is NOT inside the part — it portals to the body — which is what lets it
    // survive the part going away.
    const part = view.container.querySelector('[data-slot="list.lineSpacing"]');
    expect(part?.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  test('closing the Paragraph dialog hands focus back to the line-spacing trigger', async () => {
    // Leaving focus on `<body>` strands a keyboard user: arrow keys and typing both go
    // nowhere, and it is a long walk back to the document. Returning it to the control that
    // opened the dialog is the standard contract, and the one mechanism that touches
    // neither the document selection nor the scroll position.
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="list.lineSpacing"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      trigger.click();
    });
    const options = [...root.querySelectorAll('[role="menuitem"]')].find((row) =>
      row.textContent?.includes('Line spacing options')
    ) as HTMLButtonElement;
    expect(options).toBeTruthy();
    await act(async () => {
      options.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    const cancel = [...document.body.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Cancel'
    )!;
    await act(async () => {
      cancel.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('the zoom stepper resizes the mounted page live, keeps edits and undo, and shows all zoom levels', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    const instance = editor();
    const mountedSurface = instance.surface;
    instance.surface!.setSelection({
      anchor: { paragraphId: instance.surface!.session.paragraphIds()[0]!, offset: 11 },
      head: { paragraphId: instance.surface!.session.paragraphIds()[0]!, offset: 11 },
    });
    instance.surface!.type('!');
    const stepper = view.container.querySelector('[data-slot="zoom.level"]')!;
    const value = stepper.querySelector('.docx-toolbar__stepper-value')!;
    const pageWidth = () =>
      parseFloat((view.container.querySelector('.docx-page') as HTMLElement).style.width);
    const widthBefore = pageWidth();
    // The middle is the "% ▾" menu button: the level plus the caret glyph.
    expect(value.textContent).toBe('100%▾');
    await act(async () => {
      (value as HTMLButtonElement).click();
    });
    // The two fits come first and are ticked from the MODE, not from the percentage, so a
    // reader tracking the viewport at 79% does not see "75%" lit up beside them.
    expect(
      [...stepper.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    ).toEqual(['Automatic', 'Fit width', '25%', '50%', '75%', '100%', '125%', '150%', '200%']);
    await act(async () => {
      (value as HTMLButtonElement).click();
    });
    const zoomIn = stepper.querySelector(byLabel('zoom.zoomIn')) as HTMLButtonElement;
    await act(async () => {
      zoomIn.click();
    });
    // The buttons walk the preset LEVELS (50/75/100/125/150/200), not a fixed
    // step: 100% steps to 125%.
    expect(editor()).toBe(instance);
    expect(editor().surface).toBe(mountedSurface);
    expect(editor().snapshot().zoom).toBe(1.25);
    expect(value.textContent).toBe('125%▾');
    expect(pageWidth()).toBeCloseTo(widthBefore * 1.25);
    expect(view.container.textContent).toContain('hello world!');
    expect(editor().can({ type: 'undo' }).ok).toBe(true);
    const zoomOut = stepper.querySelector(byLabel('zoom.zoomOut')) as HTMLButtonElement;
    await act(async () => {
      zoomOut.click();
    });
    expect(editor().snapshot().zoom).toBe(1);
  });

  // The point of the two fit rows: the tick follows the MODE, not the percentage. Ticking the
  // level that matches the resolved scale lights up "100%" while the editor is tracking the
  // viewport and about to move off it.
  test('the zoom menu ticks the mode, not the percentage', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    const stepper = view.container.querySelector('[data-slot="zoom.level"]')!;
    const rows = () => [...stepper.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
    // The trigger TOGGLES, so opening an already-open menu closes it. Idempotent on purpose:
    // these assertions read the menu several times in a row.
    const openMenu = async () => {
      if (rows().length === 0) {
        await act(async () => {
          (stepper.querySelector('.docx-toolbar__stepper-value') as HTMLButtonElement).click();
        });
      }
      return rows();
    };
    const ticked = (rows: HTMLButtonElement[]) =>
      rows.filter((row) => row.hasAttribute('data-selected')).map((row) => row.textContent);

    // Default is auto, resolved to 100% here. "Automatic" is ticked; "100%" is NOT.
    expect(editor().snapshot().zoom).toBe(1);
    expect(ticked(await openMenu())).toEqual(['Automatic']);

    // Picking the level ends the fit, and now the level is what is ticked.
    await act(async () => {
      (await openMenu()).find((row) => row.textContent === '100%')!.click();
    });
    expect(ticked(await openMenu())).toEqual(['100%']);

    // A fit with bounds this menu cannot offer ticks NOTHING, rather than lighting up a row
    // that would silently replace those bounds when clicked.
    await act(async () => {
      editor().setZoomMode({ type: 'fit', fit: 'pageWidth', maxZoom: 2 });
    });
    expect(ticked(await openMenu())).toEqual([]);
  });

  test('the font-colour split applies its seed from the main half and a swatch pick from the grid', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const split = view.container.querySelector('[data-slot="text.color"]')!;
    const main = split.querySelector('.docx-toolbar__colorsplit-main') as HTMLButtonElement;
    expect(main.disabled).toBe(false);
    await act(async () => {
      main.click();
    });
    // The seed is the registry swatch: the chrome spec's default red (the apply
    // half starts at { rgb: 'FF0000' } before any pick).
    expect(editor().snapshot().formatting?.color).toEqual({ kind: 'hex', value: 'FF0000' });

    const caret = split.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
    await act(async () => {
      caret.click();
    });
    const swatch = split.querySelector('[data-value="000000"]') as HTMLButtonElement;
    expect(swatch).not.toBeNull();
    await act(async () => {
      swatch.click();
    });
    expect(editor().snapshot().formatting?.color).toEqual({ kind: 'hex', value: '000000' });
    // A pick closes the popup.
    expect(split.querySelector('.docx-toolbar__swatch-popup')).toBeNull();
  });

  test('the highlight split applies yellow by default and an ST_HighlightColor name from the grid', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const split = view.container.querySelector('[data-slot="text.highlight"]')!;
    const main = split.querySelector('.docx-toolbar__colorsplit-main') as HTMLButtonElement;
    await act(async () => {
      main.click();
    });
    expect(editor().snapshot().formatting?.highlight).toBe('yellow');

    const caret = split.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
    await act(async () => {
      caret.click();
    });
    const swatch = split.querySelector('[data-value="cyan"]') as HTMLButtonElement;
    await act(async () => {
      swatch.click();
    });
    expect(editor().snapshot().formatting?.highlight).toBe('cyan');
  });

  test('every dropdown-shaped slot is now a real control, so none renders as a lookalike', () => {
    // This used to pin the picker LOOKALIKE — a disabled combobox for a dropdown-shaped slot
    // the engine did not own. Both slots that needed it grew real controls (`list.lineSpacing`
    // and `review.editingMode`), so the lookalike has no subject left and the helper that
    // built it is gone. What matters now is the opposite: neither renders inert.
    const { view } = mountToolbar(<DocxEditorToolbar />);
    for (const slot of ['list.lineSpacing', 'review.editingMode']) {
      const part = view.container.querySelector(`[data-slot="${slot}"]`)!;
      expect(part).not.toBeNull();
      expect(part.getAttribute('aria-disabled')).not.toBe('true');
      expect(part.querySelector('button')).not.toBeNull();
    }
  });

  test('the editing-mode control shows the current mode and switches it', () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    const trigger = view.container.querySelector('[data-testid="editing-mode-trigger"]')!;
    expect(trigger.getAttribute('data-mode')).toBe('editing');

    act(() => {
      (trigger as HTMLButtonElement).click();
    });
    const suggesting = view.container.querySelector('[data-testid="editing-mode-suggesting"]')!;
    act(() => {
      (suggesting as HTMLButtonElement).click();
    });

    expect(editor().getEditingMode()).toBe('suggesting');
    expect(
      view.container
        .querySelector('[data-testid="editing-mode-trigger"]')!
        .getAttribute('data-mode')
    ).toBe('suggesting');
  });

  test('the style picker lists the DOCUMENT paragraph styles and a pick applies one', async () => {
    const styled = docx(
      '<w:p><w:r><w:t>hello</w:t></w:r></w:p>',
      // Declared OUT of gallery order on purpose — a round-tripped file routinely is, and
      // a picker that just echoes `styles.xml` shows Heading 1 above Normal.
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
        '<w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="64"/></w:rPr></w:style>' +
        // Unranked: keeps its document position, after everything Word's gallery ranks.
        '<w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
        // A character style must NOT appear among the paragraph options.
        '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>'
    );
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, styled);

    // Live: a real button trigger showing the unstyled placeholder (raw key — no `t`).
    const trigger = view.container.querySelector(
      '[data-slot="styles.style"] .docx-toolbar__style-trigger'
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    // The paragraph names no `w:pStyle`, but it IS written in the document's default
    // style, and that is what Word's box shows — not a generic placeholder over a style
    // the menu below lists by name with the tick beside nothing.
    expect(trigger.textContent).toBe('Normal');

    await act(async () => {
      trigger.click();
    });
    const rows = [...view.container.querySelectorAll('[data-slot="styles.style"] [role="option"]')];
    // The selected row carries a ✓ glyph, so compare the label span rather than the row.
    const items = rows.map((row) => row.querySelector('span')?.textContent);
    // Word's gallery order, NOT the order the part lists them in, with the unranked style
    // keeping its document position at the end. `Heading 1` is title-cased for display:
    // Word writes the built-in name lowercase and title-cases it in its own UI. `Callout`
    // is the document's own style, so its name is shown exactly as authored.
    expect(items).toEqual(['Normal', 'Heading 1', 'Callout']);
    // The paragraph states no `w:pStyle` but IS written in the default style, so the tick
    // sits on it. Reading "no style" as "nothing selected" left every row unticked while
    // the trigger showed a placeholder for a style the list names.
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    expect(rows[1]!.getAttribute('aria-selected')).toBe('false');

    // Each row renders in the style's OWN face, so the menu previews rather than listing
    // identical rows. The values come from the engine's bounded derivation and go into a
    // style OBJECT — never a CSS string.
    const headingRow = view.container.querySelector(
      '[data-slot="styles.style"] [role="option"]:nth-of-type(2) span'
    ) as HTMLElement;
    expect(headingRow.style.fontWeight).toBe('700');
    expect(headingRow.style.color.toUpperCase()).toBe('#1F3864');
    // 32pt in the document, CLAMPED for the menu: a Title at its own size would push every
    // other row off the screen, and the row still reads as bigger than body text.
    expect(headingRow.style.fontSize).toBe('20px');
    const normalRow = view.container.querySelector(
      '[data-slot="styles.style"] [role="option"]:nth-of-type(1) span'
    ) as HTMLElement;
    expect(normalRow.style.fontWeight).toBe('');
    expect(Number.parseFloat(normalRow.style.fontSize || '0')).toBeLessThan(20);

    const heading = [
      ...view.container.querySelectorAll('[data-slot="styles.style"] [role="option"]'),
    ][1] as HTMLButtonElement;
    await act(async () => {
      heading.click();
    });
    expect(editor().snapshot().formatting?.styleId).toBe('Heading1');
    expect(trigger.textContent).toBe('Heading 1');
  });

  test('save is NOT in the default bar (contextual slot); composed, it needs onSave to be live', async () => {
    // The registry's default bar ends at the editing-mode picker: save belongs in
    // the host's File menu, so its slot is contextual and absent from the default
    // arrangement.
    const onSaveCalls: number[] = [];
    const { view } = mountToolbar(<DocxEditorToolbar onSave={() => onSaveCalls.push(1)} />);
    expect(view.container.querySelector('[data-slot="file.save"]')).toBeNull();
    cleanup();

    // Explicitly composed (appended after the default set), it is live with a handler…
    const { view: composed } = mountToolbar(
      <DocxEditorToolbar onSave={() => onSaveCalls.push(1)}>
        <DocxEditorToolbar.Save />
      </DocxEditorToolbar>
    );
    const save = composed.container.querySelector('[data-slot="file.save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
    });
    expect(onSaveCalls.length).toBe(1);
    cleanup();

    // …and disabled without one: Editor.save() returns bytes the HOST must deliver.
    const { view: bare } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Save />
      </DocxEditorToolbar>
    );
    const disabledSave = bare.container.querySelector(
      '[data-slot="file.save"]'
    ) as HTMLButtonElement;
    expect(disabledSave.disabled).toBe(true);
  });
});

describe('the FontFamily compound', () => {
  test('options are the offerable catalog; selecting applies and closes', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, FONTED_SOURCE);
    expect(editor().getDocumentFonts()).toEqual(['Courier New', 'Georgia']);
    expect(editor().getAvailableFonts()).toEqual(
      expect.arrayContaining(['Arial', 'Calibri', 'Courier New', 'Georgia'])
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    const trigger = view.container.querySelector(
      '.docx-toolbar__font-family-trigger'
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    // Mixed-font selection: no agreed value, so the trigger shows the em-dash.
    expect(trigger.textContent).toBe('—');

    await act(async () => {
      trigger.click();
    });
    const listbox = view.container.querySelector('[role="listbox"]')!;
    // Standard choices keep the grouped menu order.
    const options = [...listbox.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      'Arial',
      'Calibri',
      'Helvetica',
      'Open Sans',
      'Roboto',
      'Verdana',
      'Cambria',
      'Garamond',
      'Georgia',
      'Times New Roman',
      'Consolas',
      'Courier New',
    ]);
    expect(
      [...listbox.querySelectorAll('.docx-toolbar__menu-label')].map((label) => label.textContent)
    ).toEqual([
      label('font.sansSerif' as TranslationKey),
      label('font.serif' as TranslationKey),
      label('font.monospace' as TranslationKey),
    ]);

    await act(async () => {
      (options.find((option) => option.textContent === 'Georgia') as HTMLButtonElement).click();
    });
    expect(editor().snapshot().formatting?.fontFamily).toBe('Georgia');
    expect(view.container.querySelector('[role="listbox"]')).toBeNull();
    expect(trigger.textContent).toBe('Georgia');
    await act(async () => {
      trigger.click();
    });
    const reopened = [...view.container.querySelectorAll('[role="option"]')];
    expect(reopened.map((option) => option.textContent?.replace('✓', ''))).toEqual(
      options.map((option) => option.textContent)
    );
    const selected = reopened.find((option) => option.textContent === 'Georgia✓')!;
    expect(selected.hasAttribute('data-selected')).toBe(true);
    expect(selected.querySelector('.docx-toolbar__menu-check')).not.toBeNull();
  });

  test('custom Item children render inside a composed FontFamily', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.FontFamily>
          <DocxEditorToolbar.FontFamily.Trigger />
          <DocxEditorToolbar.FontFamily.Content>
            <DocxEditorToolbar.FontFamily.Item value="Georgia">
              <em data-testid="fancy-georgia">Fancy Georgia</em>
            </DocxEditorToolbar.FontFamily.Item>
          </DocxEditorToolbar.FontFamily.Content>
        </DocxEditorToolbar.FontFamily>
      </DocxEditorToolbar>,
      FONTED_SOURCE
    );
    // The font picker writes RUN formatting, so it needs a range — a collapsed caret
    // carries none yet and the trigger is honestly disabled until something is selected.
    await act(async () => {
      editor().surface!.selectAll();
    });
    const trigger = view.container.querySelector(
      '.docx-toolbar__font-family-trigger'
    ) as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    expect(view.getByTestId('fancy-georgia').textContent).toBe('Fancy Georgia');
  });
});

describe('the caret-preserving mousedown contract', () => {
  test('toolbar button mousedown is prevented; form-field mousedown is not', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <select data-testid="toolbar-select">
          <option value="x">x</option>
        </select>
      </DocxEditorToolbar>
    );
    const bold = view.container.querySelector(byLabel('formattingBar.boldShortcut'))!;
    const buttonEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    bold.dispatchEvent(buttonEvent);
    expect(buttonEvent.defaultPrevented).toBe(true);

    const select = view.getByTestId('toolbar-select');
    const selectEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    select.dispatchEvent(selectEvent);
    expect(selectEvent.defaultPrevented).toBe(false);
  });
});

describe('namespace statics', () => {
  test('DocxEditor.Toolbar IS the compound toolbar with its parts attached', () => {
    expect(DocxEditor.Toolbar).toBe(DocxEditorToolbar);
    expect(DocxEditorToolbar.Bold.docxSlot).toBe('text.bold');
    expect(DocxEditorToolbar.FontFamily.docxSlot).toBe('font.family');
    expect(typeof DocxEditorToolbar.Button).toBe('function');
    expect(typeof DocxEditorToolbar.Separator).toBe('function');
    expect(typeof DocxEditorToolbar.FontFamily.Trigger).toBe('function');
    expect(typeof DocxEditorToolbar.FontFamily.Content).toBe('function');
    expect(typeof DocxEditorToolbar.FontFamily.Item).toBe('function');
    // The shaped parts carry their slot statics too.
    expect(DocxEditorToolbar.FontSize.docxSlot).toBe('font.size');
    expect(DocxEditorToolbar.FontColor.docxSlot).toBe('text.color');
    expect(DocxEditorToolbar.Highlight.docxSlot).toBe('text.highlight');
    expect(DocxEditorToolbar.Zoom.docxSlot).toBe('zoom.level');
    expect(DocxEditorToolbar.StylePicker.docxSlot).toBe('styles.style');
    expect(DocxEditorToolbar.EditingMode.docxSlot).toBe('review.editingMode');
    expect(DocxEditorToolbar.Save.docxSlot).toBe('file.save');
    expect(DocxEditorToolbar.BulletList.docxSlot).toBe('list.bullet');
    expect(DocxEditorToolbar.TableInsert.docxSlot).toBe('table.insert');
    expect(DocxEditorToolbar.TableBorderTarget.docxSlot).toBe('table.borderTarget');
    expect(DocxEditorToolbar.TableBorderColor.docxSlot).toBe('table.borderColor');
    expect(DocxEditorToolbar.TableBorderStyle.docxSlot).toBe('table.borderStyle');
    expect(DocxEditorToolbar.TableBorderWidth.docxSlot).toBe('table.borderWidth');
    expect(DocxEditorToolbar.TableCellFill.docxSlot).toBe('table.cellFill');
  });
});

/** Two-by-two table for contextual table chrome tests. */
const TABLE_2X2 = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
);

const TABLE_CHROME_SLOTS = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
] as const;

function caretInCell(editor: DocxEditorInstance, paragraphIndex: number, offset = 1): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  });
}

describe('contextual table chrome (Task 10)', () => {
  test('table border controls are absent outside a table', () => {
    const { view } = mountToolbar(<DocxEditorToolbar />);
    for (const slot of TABLE_CHROME_SLOTS) {
      expect(view.container.querySelector(`[data-slot="${slot}"]`)).toBeNull();
    }
  });

  test('table border controls appear in registry order when the caret is in a table', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, TABLE_2X2);
    await act(async () => {
      caretInCell(editor(), 0);
    });
    expect(editor().snapshot().table).not.toBeNull();
    const toolbar = toolbarElement(view);
    const identities = toolbarArrangement(toolbar);
    const tableStart = identities.indexOf('table.borderTarget');
    expect(tableStart).toBeGreaterThan(-1);
    expect(identities.slice(tableStart, tableStart + TABLE_CHROME_SLOTS.length)).toEqual([
      ...TABLE_CHROME_SLOTS,
    ]);
  });

  test('a hidden table part removes its slot from the contextual group', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.TableBorderStyle hidden />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    expect(view.container.querySelector('[data-slot="table.borderStyle"]')).toBeNull();
    expect(view.container.querySelector('[data-slot="table.borderTarget"]')).not.toBeNull();
  });

  test('preset={false} with composed table parts renders only those parts', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    expect(toolbarArrangement(toolbarElement(view))).toEqual([
      'table.borderTarget',
      'table.cellFill',
    ]);
  });

  test('table controls share the toolbar horizontal axis', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderColor />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    for (const root of view.container.querySelectorAll<HTMLElement>('[data-slot^="table."]')) {
      expect(root.style.display).toBe('inline-flex');
      expect(root.style.alignItems).toBe('center');
      expect(root.style.verticalAlign).toBe('middle');
    }
  });

  test('target then color picks dispatch complete border commands through the shared draft', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableBorderColor />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    const targetRoot = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    await act(async () => {
      (targetRoot.querySelector('button') as HTMLButtonElement).click();
    });
    const inside = [...targetRoot.querySelectorAll('[role="menuitemradio"]')].find(
      (row) => row.getAttribute('data-value') === 'inside'
    ) as HTMLButtonElement;
    await act(async () => {
      inside.click();
    });
    const colorRoot = view.container.querySelector('[data-slot="table.borderColor"]')!;
    await act(async () => {
      (colorRoot.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
    });
    const swatch = colorRoot.querySelector('[data-pick="accent1"]') as HTMLButtonElement;
    expect(swatch).not.toBeNull();
    await act(async () => {
      swatch.click();
    });
    expect(
      editor().can({
        type: 'setTableBorders',
        scope: 'inside',
        spec: { style: 'single', size: 8, color: { kind: 'hex', value: '4472C4' } },
      }).ok
    ).toBe(true);
  });

  test('none clears borders on the active target and clear fill removes direct fill', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    editor().exec({ type: 'setCellFill', color: { kind: 'hex', value: 'FF0000' } });
    const targetRoot = view.container.querySelector('[data-slot="table.borderTarget"]')!;
    await act(async () => {
      (targetRoot.querySelector('button') as HTMLButtonElement).click();
    });
    const none = [...targetRoot.querySelectorAll('[role="menuitemradio"]')].find(
      (row) => row.getAttribute('data-value') === 'none'
    ) as HTMLButtonElement;
    await act(async () => {
      none.click();
    });
    expect(editor().can({ type: 'setTableBorders', scope: 'none', target: 'all' }).ok).toBe(true);

    const fillRoot = view.container.querySelector('[data-slot="table.cellFill"]')!;
    await act(async () => {
      (fillRoot.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
    });
    await act(async () => {
      (fillRoot.querySelector('.docx-toolbar__swatch-clear') as HTMLButtonElement).click();
    });
    expect(editor().can({ type: 'setCellFill', color: null }).ok).toBe(true);
  });

  test('disabled table controls expose the engine refusal as the accessible reason', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderTarget />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    await act(async () => {
      editor().exec({ type: 'setEditingMode', mode: 'viewing' });
    });
    const trigger = view.container.querySelector(
      '[data-slot="table.borderTarget"] button'
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.title).toBe('This document is open for viewing');
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      'This document is open for viewing'
    );
  });

  test('table chrome labels resolve through t, not hardcoded English', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar t={(key) => key} preset={false}>
        <DocxEditorToolbar.TableBorderStyle />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    const trigger = view.container.querySelector(
      '[data-slot="table.borderStyle"] button'
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('table.borders.styleAriaLabel');
    await act(async () => {
      trigger.click();
    });
    const labels = [
      ...view.container.querySelectorAll('[data-slot="table.borderStyle"] [role="menuitemradio"]'),
    ].map((row) => row.textContent);
    expect(labels).toEqual([
      'table.borderStyles.single',
      'table.borderStyles.dashed',
      'table.borderStyles.dotted',
      'table.borderStyles.double',
      'table.borderStyles.triple',
      'table.borderStyles.thick',
    ]);
  });

  test('table border color and cell fill use the full Word-style color picker', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderColor />
        <DocxEditorToolbar.TableCellFill />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    for (const slot of ['table.borderColor', 'table.cellFill'] as const) {
      const root = view.container.querySelector(`[data-slot="${slot}"]`)!;
      await act(async () => {
        (root.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement).click();
      });
      const popup = root.querySelector('[role="dialog"]')!;
      // The shared colour picker: six theme rows, the standard row, and the hex field.
      const grid = popup.querySelector('.docx-color-picker__content--inline')!;
      expect(grid.querySelectorAll('[data-color-swatch]')).toHaveLength(70);
      expect(grid.querySelector('.docx-color-picker__hex input')).not.toBeNull();
      await act(async () => {
        fireEvent.keyDown(popup, { key: 'Escape' });
      });
    }
  });

  test('table toolbar mousedown is prevented; swatch inputs remain usable', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.TableBorderColor />
        <input data-testid="toolbar-input" />
      </DocxEditorToolbar>,
      TABLE_2X2
    );
    await act(async () => {
      caretInCell(editor(), 0);
    });
    const before = editor().surface!.selectedText();
    const trigger = view.container.querySelector(
      '[data-slot="table.borderColor"] .docx-toolbar__colorsplit-main'
    )!;
    const buttonEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(buttonEvent);
    expect(buttonEvent.defaultPrevented).toBe(true);
    expect(editor().surface!.selectedText()).toBe(before);

    const input = view.getByTestId('toolbar-input');
    const inputEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    input.dispatchEvent(inputEvent);
    expect(inputEvent.defaultPrevented).toBe(false);
  });
});

// The React half of the enabled-state contract the Vue toolbar is held to in
// `packages/vue/test/toolbar-engine-state.test.ts`. Same slots, same rules: a control is
// enabled because `Editor.can` said so, never because the chrome registry said so.
//
// React always worked here — `ToolbarButton` goes through `useEditorCommand` and has
// never read the registry's state kind — while Vue branched on it and rendered twelve
// wired commands permanently disabled. These assertions are the tripwire that keeps
// React on the engine's answer, so the two adapters cannot drift apart again.
describe('enabled state is the engine answer, not a registry constant', () => {
  test('underline is live: enabled at a range selection, and a click applies it', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const underline = view.container.querySelector(
      '[data-slot="text.underline"]'
    ) as HTMLButtonElement;
    expect(underline.disabled).toBe(false);
    // The label, not an "unavailable" apology.
    expect(underline.title).toBe(label('formattingBar.underlineShortcut' as TranslationKey));
    await act(async () => {
      underline.click();
    });
    expect(editor().snapshot().formatting?.underline).toBe(true);
    expect(underline.hasAttribute('data-active')).toBe(true);
  });

  test('superscript, subscript and clear-formatting are live in the default bar', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const button = (slot: string) =>
      view.container.querySelector(`[data-slot="${slot}"]`) as HTMLButtonElement;
    for (const slot of ['script.super', 'script.sub', 'format.clear']) {
      expect(button(slot).disabled, slot).toBe(false);
      expect(button(slot).title, slot).not.toBe('not wired to an editor command');
    }

    await act(async () => {
      button('script.sub').click();
    });
    expect(editor().snapshot().formatting?.subscript).toBe(true);
    expect(button('script.sub').hasAttribute('data-active')).toBe(true);
    // One property, two values: raising text must not leave BOTH controls pressed.
    expect(button('script.super').hasAttribute('data-active')).toBe(false);

    await act(async () => {
      button('format.clear').click();
    });
    expect(editor().snapshot().formatting?.subscript).toBe(false);
    expect(button('script.sub').hasAttribute('data-active')).toBe(false);
  });

  test('the list controls are live, and outdent tracks the engine rather than a flag', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const indent = view.container.querySelector('[data-slot="list.indent"]') as HTMLButtonElement;
    const outdent = view.container.querySelector('[data-slot="list.outdent"]') as HTMLButtonElement;
    expect(indent.disabled).toBe(false);
    // Nothing to outdent at level 0 — the engine's answer, and it changes when the
    // document does.
    expect(outdent.disabled).toBe(true);
    await act(async () => {
      indent.click();
    });
    expect(outdent.disabled).toBe(false);
  });

  test('the default bar has no dead controls left', () => {
    // This test carried a shrinking list of slots the default bar rendered with no command
    // behind them — `text.link`, then `script.super`/`script.sub`/`format.clear`, and last
    // `review.comments`, which now toggles the review pane. The list is empty, so the
    // assertion inverts: nothing the default bar renders may report "not wired". The
    // remaining unwired slots (image, table, TOC) are contextual and not in this bar.
    const { view } = mountToolbar(<DocxEditorToolbar />);
    // The compound parts put `data-slot` on a wrapper and the tooltip on the button inside
    // it, so scanning `[data-slot]` for a title was blind to exactly the parts this covers.
    // Scan every element carrying the reason, then name the slot by walking up to it.
    const controls = [...view.container.querySelectorAll('[data-slot]')];
    expect(controls.length).toBeGreaterThan(10);
    const dead = [...view.container.querySelectorAll('[title]')].filter(
      (part) => part.getAttribute('title') === 'This control is not connected to an editor command'
    );
    expect(dead.map((part) => part.closest('[data-slot]')?.getAttribute('data-slot'))).toEqual([]);
  });

  test('a wired control the engine refuses NOW shows the engine reason', async () => {
    // Undo over an empty history: the engine refuses, and the tooltip is its refusal —
    // not a permanent "unavailable in preview". A refusal that lifts as soon as the
    // document moves is the whole point; a registry constant could not.
    const twoParagraphs = docx(
      '<w:p><w:r><w:t>alpha</w:t></w:r></w:p><w:p><w:r><w:t>beta</w:t></w:r></w:p>'
    );
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, twoParagraphs);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const undo = view.container.querySelector('[data-slot="history.undo"]') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(undo.title).toContain('nothing to undo');

    await act(async () => {
      (view.container.querySelector('[data-slot="text.underline"]') as HTMLButtonElement).click();
    });
    expect(undo.disabled).toBe(false);
  });
});
