// The line-spacing dropdown against the real engine: the multiples it ticks and applies,
// the current spacing shown even when no preset matches it, and the paragraph space rows
// that share its `w:spacing` element.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
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

/** Bare parts resolve labels through the locale catalogue; tests address them by key. */
const label = createT(en);

afterEach(() => {
  cleanup();
});

describe('the line-spacing menu', () => {
  test('the line-spacing menu applies a multiple and ticks the one in force', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="list.lineSpacing"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);

    await act(async () => {
      trigger.click();
    });
    const rows = [...root.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[];
    expect(rows.map((row) => row.textContent)).toEqual([
      '1.0✓',
      '1.15',
      '1.5',
      '2.0',
      '2.5',
      '3.0',
    ]);
    // The fixture states no line spacing, so the single spacing it lays out at is ticked,
    // with a visible check and not only the attribute.
    const tickedBefore = rows.filter((row) => row.hasAttribute('data-selected'));
    expect(tickedBefore.map((row) => row.textContent)).toEqual(['1.0✓']);
    expect(tickedBefore[0]!.getAttribute('aria-checked')).toBe('true');
    expect(tickedBefore[0]!.querySelector('.docx-toolbar__menu-check')).not.toBeNull();

    await act(async () => {
      rows.find((row) => row.textContent === '1.5')!.click();
    });
    expect(editor().snapshot().formatting?.lineSpacing).toEqual({ rule: 'multiple', value: 1.5 });
    expect(root.querySelector('[role="menu"]')).toBeNull();

    // Reopened, the menu reflects the paragraph rather than a fixed list.
    await act(async () => {
      trigger.click();
    });
    const ticked = [...root.querySelectorAll('[role="menuitemradio"]')].find((row) =>
      row.hasAttribute('data-selected')
    );
    expect(ticked?.textContent).toBe('1.5✓');
  });

  test('a spacing no preset matches still shows as the ticked row', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
      editor().exec({ type: 'setLineSpacing', rule: 'exact', value: 18 });
    });
    const root = view.container.querySelector('[data-slot="list.lineSpacing"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    const openRows = async () => {
      await act(async () => {
        trigger.click();
      });
      return [...root.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[];
    };

    let rows = await openRows();
    expect(rows.map((row) => row.textContent)).toEqual([
      'Exactly 18 pt✓',
      '1.0',
      '1.15',
      '1.5',
      '2.0',
      '2.5',
      '3.0',
    ]);
    // Picking the ticked row closes the menu and writes nothing.
    const before = editor().snapshot().formatting?.lineSpacing;
    await act(async () => {
      rows[0]!.click();
    });
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(editor().snapshot().formatting?.lineSpacing).toEqual(before!);

    await act(async () => {
      editor().exec({ type: 'setLineSpacing', rule: 'multiple', value: 1.08 });
    });
    rows = await openRows();
    expect(rows.map((row) => row.textContent)).toEqual([
      '1.0',
      '1.08✓',
      '1.15',
      '1.5',
      '2.0',
      '2.5',
      '3.0',
    ]);
  });

  test('the space before/after rows flip between Add and Remove on what is there', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="list.lineSpacing"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;
    const rows = () => [...root.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[];
    // Indexed past the escape hatch: "Line spacing options…" opens the Paragraph dialog and
    // is not one of the spacing rows this test is about.
    const spacingRows = () => rows().slice(1);

    await act(async () => {
      trigger.click();
    });
    expect(rows().map((row) => row.textContent)).toEqual([
      label('lineSpacing.options' as TranslationKey),
      label('lineSpacing.addSpaceBefore' as TranslationKey),
      label('lineSpacing.addSpaceAfter' as TranslationKey),
    ]);

    await act(async () => {
      spacingRows()[0]!.click();
    });
    expect(editor().snapshot().formatting?.spaceBeforePt).toBe(10);

    await act(async () => {
      trigger.click();
    });
    // Word never offers to add space that is already there.
    expect(spacingRows()[0]!.textContent).toBe(
      label('lineSpacing.removeSpaceBefore' as TranslationKey)
    );
    await act(async () => {
      spacingRows()[0]!.click();
    });
    // ZERO, not absent. Removing the attribute would let the paragraph inherit its style's
    // space again — on a Word default document that gives the space straight back, and the
    // row goes on offering to remove what removing did not remove.
    expect(editor().snapshot().formatting?.spaceBeforePt).toBe(0);

    await act(async () => {
      trigger.click();
    });
    expect(spacingRows()[0]!.textContent).toBe(
      label('lineSpacing.addSpaceBefore' as TranslationKey)
    );
  });

  test('line spacing and paragraph space are independent settings of one w:spacing', async () => {
    // They share one element, so a replacing write made each pick delete the other.
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="list.lineSpacing"]')!;
    const trigger = root.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      ([...root.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[])
        .find((row) => row.textContent === '2.0')!
        .click();
    });
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      // By LABEL, not by index: the menu also carries the "Line spacing options…" escape
      // hatch, and an index would silently start clicking a different row.
      ([...root.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[])
        .find((row) => row.textContent === label('lineSpacing.addSpaceAfter' as TranslationKey))!
        .click();
    });

    expect(editor().snapshot().formatting?.lineSpacing).toEqual({ rule: 'multiple', value: 2 });
    expect(editor().snapshot().formatting?.spaceAfterPt).toBe(10);
  });
});
