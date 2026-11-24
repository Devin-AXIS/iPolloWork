// The Paragraph dialog, against the real engine.
//
// It is the escape hatch the line-spacing menu never had. That menu's rows are Word's
// shortcuts — a fixed 10pt Add, a zeroing Remove — and on a document whose style already
// supplies space-after they move a paragraph by the DIFFERENCE, which reads as a control
// that does nothing (issue #360). What these pin down: the form SEEDS from the selection,
// OK writes every field in ONE undo step, a refused write leaves the dialog open, and an
// untouched mixed flag is not flattened across the selection.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorParagraphDialog } from '../src/editor/DocxEditorParagraphDialog.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

const p = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/**
 * Mount CLOSED, then open — the order a user works in, and the order the seed depends on.
 *
 * The dialog seeds from the selection when it opens and not on every tick, so that a
 * concurrent edit cannot fight the user's typing. A harness that mounted it already open
 * would seed from the caret the document loaded with, not from the selection under test.
 */
function mountDialog(body: string) {
  let instance: DocxEditorInstance | null = null;
  let closed = 0;
  const bytes = docx(body);
  const tree = (open: boolean) => (
    <DocxEditorRoot
      document={bytes}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorParagraphDialog open={open} onClose={() => (closed += 1)} />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const view = render(tree(false));
  const openDialog = async () => {
    await act(async () => {
      view.rerender(tree(true));
    });
  };
  const close = async () => {
    await act(async () => {
      view.rerender(tree(false));
    });
  };
  return { view, editor: () => instance!, closes: () => closed, openDialog, close };
}

/**
 * Where to look for the dialog's controls.
 *
 * The dialog portals to `document.body`, so `view.container` no longer holds it. The whole
 * document does, and each test mounts one dialog, so `document` is the honest root.
 */
const root = (): Document => document;

const field = (_view: ReturnType<typeof render>, label: string) =>
  root().querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement;

const checkboxFor = (_view: ReturnType<typeof render>, text: string) => {
  const wrapper = [...root().querySelectorAll('label')].find((node) =>
    node.textContent?.includes(text)
  );
  return wrapper?.querySelector('input[type="checkbox"]') as HTMLInputElement;
};

const cancelButton = (_view: RenderResult): HTMLButtonElement => {
  const found = [...root().querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === 'Cancel'
  );
  if (!found) throw new Error('no Cancel button');
  return found;
};

const okButton = (_view: ReturnType<typeof render>) =>
  [...root().querySelectorAll('button')].find(
    (node) => node.textContent === 'OK'
  ) as HTMLButtonElement;

const xmlOf = (editor: DocxEditorInstance) => serializeOoxmlPart(editor.surface!.session.part());

afterEach(cleanup);

describe('the Paragraph dialog', () => {
  test('seeds every field from the selection', async () => {
    const { view, editor, openDialog } = mountDialog(
      p(
        'alpha',
        '<w:jc w:val="center"/><w:ind w:left="720" w:right="360" w:hanging="360"/>' +
          '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>' +
          '<w:keepNext/>'
      )
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    expect((field(view, 'Alignment') as HTMLSelectElement).value).toBe('center');
    expect(field(view, 'Before text').value).toBe('0.5');
    expect(field(view, 'After text').value).toBe('0.25');
    // A negative signed first line is Word's "Hanging", shown as a positive magnitude.
    expect((field(view, 'Special') as HTMLSelectElement).value).toBe('hanging');
    expect(field(view, 'By').value).toBe('0.25');
    expect(field(view, 'Before').value).toBe('12');
    expect(field(view, 'After').value).toBe('6');
    expect((field(view, 'Line spacing') as HTMLSelectElement).value).toBe('multiple');
    expect(field(view, 'At').value).toBe('1.5');
    expect(checkboxFor(view, 'Keep with next').checked).toBe(true);
  });

  test('OK writes every field as one undo step', async () => {
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    await act(async () => {
      fireEvent.change(field(view, 'Alignment'), { target: { value: 'justify' } });
      fireEvent.change(field(view, 'Before'), { target: { value: '18' } });
      fireEvent.change(field(view, 'Before text'), { target: { value: '0.5' } });
      fireEvent.change(field(view, 'Line spacing'), { target: { value: 'exact' } });
    });
    await act(async () => {
      fireEvent.change(field(view, 'At'), { target: { value: '20' } });
      fireEvent.click(checkboxFor(view, 'Page break before'));
    });
    await act(async () => {
      okButton(view).click();
    });

    const xml = xmlOf(editor());
    expect(xml).toContain('w:jc w:val="both"');
    expect(xml).toContain('w:before="360"');
    expect(xml).toContain('w:left="720"');
    expect(xml).toContain('w:lineRule="exact"');
    expect(xml).toContain('w:line="400"');
    expect(xml).toContain('w:pageBreakBefore w:val="1"');

    // ONE undo takes the whole dialog back.
    await act(async () => {
      editor().exec({ type: 'undo' });
    });
    const undone = xmlOf(editor());
    expect(undone).not.toContain('w:jc');
    expect(undone).not.toContain('w:ind');
    expect(undone).not.toContain('w:pageBreakBefore');
  });

  test('it closes on OK, and stays open when the engine refuses', async () => {
    const { view, editor, closes, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    await act(async () => {
      okButton(view).click();
    });
    expect(closes()).toBe(1);

    // An indent past the engine's bound is refused, so the dialog must NOT claim success.
    const {
      view: bad,
      editor: badEditor,
      closes: badCloses,
      openDialog: openBad,
    } = mountDialog(p('beta'));
    await act(async () => {
      badEditor().surface!.selectAll();
    });
    await openBad();
    await act(async () => {
      fireEvent.change(field(bad, 'Before text'), { target: { value: '99999' } });
    });
    await act(async () => {
      okButton(bad).click();
    });
    expect(badCloses()).toBe(0);
    expect(xmlOf(badEditor())).not.toContain('w:ind');
  });

  test('changing the line-spacing rule re-bases the value, so lines are not read as points', async () => {
    // The value means LINES under Multiple and POINTS otherwise. Carrying 1 into
    // "Exactly" would ask for a 1pt line box and swallow the text.
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    // Nothing states a line spacing, so the box shows the single spacing the page uses.
    expect(field(view, 'At').value).toBe('1');
    await act(async () => {
      fireEvent.change(field(view, 'Line spacing'), { target: { value: 'atLeast' } });
    });
    expect(field(view, 'At').value).toBe('12');
  });

  test('an untouched mixed flag is left mixed rather than flattened', async () => {
    // Two paragraphs disagreeing about keepNext. The box opens unchecked, and OK must not
    // stamp "off" onto the one that had it on — only fields the user changed are sent.
    const { view, editor, openDialog } = mountDialog(p('one', '<w:keepNext/>') + p('two'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(editor().surface!.formatting().paragraphFlags.keepNext).toBeNull();
    // Indeterminate, NOT unchecked. Unchecked would claim the paragraphs agree it is off.
    expect(checkboxFor(view, 'Keep with next').indeterminate).toBe(true);

    await act(async () => {
      okButton(view).click();
    });
    // Still mixed: the user never touched the box, and an untouched field is not a decision.
    expect(editor().surface!.formatting().paragraphFlags.keepNext).toBeNull();
  });

  test('touching that box RESOLVES the disagreement across the selection', async () => {
    const { view, editor, openDialog } = mountDialog(p('one', '<w:keepNext/>') + p('two'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    // Click it on, which also clears the indeterminate look — from here it means what it shows.
    await act(async () => {
      fireEvent.click(checkboxFor(view, 'Keep with next'));
    });
    expect(checkboxFor(view, 'Keep with next').indeterminate).toBe(false);
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().surface!.formatting().paragraphFlags.keepNext).toBe(true);
  });

  test('resolving a mixed flag BACK to its opening value still writes', async () => {
    // Clicking a mixed box on and then off is how a user says "off, for all of them". The
    // value now equals the seed, so a comparison on values alone sees no change — and the
    // box is left reading as settled over paragraphs that still disagree.
    const { view, editor, openDialog } = mountDialog(p('one', '<w:keepNext/>') + p('two'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(editor().surface!.formatting().paragraphFlags.keepNext).toBeNull();

    const box = checkboxFor(view, 'Keep with next');
    await act(async () => {
      fireEvent.click(box);
    });
    await act(async () => {
      fireEvent.click(box);
    });
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(false);

    await act(async () => {
      okButton(view).click();
    });
    // The selection AGREES now, which is the whole job of the dialog.
    expect(editor().surface!.formatting().paragraphFlags.keepNext).toBe(false);
  });

  test('Clear all works over a selection whose tab stops disagree', async () => {
    // A mixed tab list reads as null, so the list shows empty. "Clear all" then leaves it
    // equal to the seed while plainly being a decision.
    const { view, editor, openDialog } = mountDialog(
      p('one', '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>') +
        p('two', '<w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs>')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(editor().surface!.formatting().tabStops).toBeNull();

    const clearAll = [...root().querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Clear all'
    );
    if (!clearAll) throw new Error('no Clear all button');
    await act(async () => {
      clearAll.click();
    });
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().surface!.formatting().tabStops).toEqual([]);
  });

  test('a mixed VALUE field shows the disagreement, and can be set to what it shows', async () => {
    // The trap this closes: a disagreement rendered as a plausible concrete value made the
    // disagreement uncorrectable, because the value that would fix it is the one already on
    // screen — so nothing "moved" and nothing was written. Four paragraphs at mixed
    // alignments showed "Left" and could not be set to Left.
    const { view, editor, openDialog } = mountDialog(
      p('one', '<w:jc w:val="right"/>') + p('two', '<w:jc w:val="left"/>')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    // The read says they disagree, and the control says so too rather than picking one.
    expect(editor().surface!.formatting().alignment).toBeNull();
    const alignment = field(view, 'Alignment') as HTMLSelectElement;
    expect(alignment.value).toBe('');

    await act(async () => {
      fireEvent.change(alignment, { target: { value: 'left' } });
    });
    await act(async () => {
      okButton(view).click();
    });
    // Both paragraphs agree now, which is the whole point of opening the dialog.
    expect(editor().surface!.formatting().alignment).toBe('left');
  });

  test('a mixed Special pair can be normalised, and does not claim "(none)"', async () => {
    // One paragraph indents its first line, the other hangs. "(none)" is true of neither,
    // and picking it wrote nothing because the control was already showing it.
    const { view, editor, openDialog } = mountDialog(
      p('one', '<w:ind w:firstLine="720"/>') + p('two', '<w:ind w:hanging="720"/>')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    const special = field(view, 'Special') as HTMLSelectElement;
    expect(special.value).toBe('');

    await act(async () => {
      fireEvent.change(special, { target: { value: 'none' } });
    });
    await act(async () => {
      okButton(view).click();
    });
    // Both agree now. Before this, both kept their own indent and OK was a no-op.
    expect(editor().surface!.formatting().indent?.firstLine).toBe(0);
    expect(editor().surface!.formatting().indent?.mixed.firstLine).toBe(false);
  });

  test('a mixed line-spacing RULE opens empty, so a point value is not read as lines', async () => {
    // The rule fabricated "Multiple" over a disagreement. Typing 16 into "At" then meant
    // sixteen line-heights instead of sixteen points — the unit came from a value the user
    // never chose.
    const { view, editor, openDialog } = mountDialog(
      p('one', '<w:spacing w:line="280" w:lineRule="exact"/>') +
        p('two', '<w:spacing w:line="360" w:lineRule="exact"/>')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    const rule = field(view, 'Line spacing') as HTMLSelectElement;
    expect(rule.value).toBe('');
    expect((field(view, 'At') as HTMLInputElement).value).toBe('');

    await act(async () => {
      fireEvent.change(rule, { target: { value: 'exact' } });
    });
    await act(async () => {
      fireEvent.change(field(view, 'At'), { target: { value: '16' } });
    });
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().surface!.formatting().lineSpacing).toEqual({ rule: 'exact', value: 16 });
  });

  test('reopening on a DIFFERENT selection re-reads the disagreement', async () => {
    // The values can be equal while the disagreements differ — every disagreeing field
    // reads null on the value side — so a comparator that ignores them hands back the
    // previous slice and the dialog renders a mixed selection as settled.
    const { view, editor, openDialog, close } = mountDialog(
      p('alpha') +
        p('two', '<w:spacing w:before="240"/>') +
        p('three', '<w:spacing w:before="480"/>')
    );
    // First: a lone paragraph that states no spacing. Not a disagreement.
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    await close();

    // Then: two paragraphs that disagree, whose value also reads null.
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(editor().surface!.formatting().disagrees.spaceBeforePt).toBe(true);
    expect((field(view, 'Before') as HTMLInputElement).value).toBe('');
  });

  test('a value typed over a mixed line spacing cannot be written without its rule', async () => {
    // The rule and the value are ONE setting, and a value without its rule is meaningless.
    // Typing 16 into "At" over a disagreement used to write sixteen LINE-HEIGHTS, because
    // the seed's `multiple` fallback supplied a unit the user never chose. This is the
    // second route to that bug — the rule select was fixed first, this one was not.
    const { view, editor, openDialog } = mountDialog(
      p('one', '<w:spacing w:line="320" w:lineRule="exact"/>') + p('two')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    expect(editor().surface!.formatting().disagrees.lineSpacing).toBe(true);
    const at = field(view, 'At') as HTMLInputElement;
    // Locked until a rule says what a number in it would mean.
    expect(at.disabled).toBe(true);

    // Pick the rule, and the pair unlocks and writes in the unit that was chosen.
    await act(async () => {
      fireEvent.change(field(view, 'Line spacing'), { target: { value: 'exact' } });
    });
    expect((field(view, 'At') as HTMLInputElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.change(field(view, 'At'), { target: { value: '16' } });
    });
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().surface!.formatting().lineSpacing).toEqual({ rule: 'exact', value: 16 });
  });

  test('a single paragraph is never told it disagrees with itself', async () => {
    // `spaceBefore` reads null when nothing in the cascade states it, which is most
    // paragraphs. Rendering that as "Mixed" put the placeholder on a lone caret.
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    expect(editor().surface!.formatting().spaceBeforePt).toBeNull();
    // Absent, not disagreed: the box shows a number rather than the mixed placeholder.
    expect((field(view, 'Before') as HTMLInputElement).value).toBe('0');
    expect(document.body.textContent).not.toContain('Mixed');
  });

  test('a mixed spacing field opens empty, and stays mixed if left alone', async () => {
    const { view, editor, openDialog } = mountDialog(
      p('one', '<w:spacing w:before="240"/>') + p('two', '<w:spacing w:before="120"/>')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    expect(editor().surface!.formatting().spaceBeforePt).toBeNull();
    expect((field(view, 'Before') as HTMLInputElement).value).toBe('');

    await act(async () => {
      okButton(view).click();
    });
    // Untouched, so not written: the paragraphs keep their own values.
    expect(editor().surface!.formatting().spaceBeforePt).toBeNull();
  });

  test('a mixed tab list says so, instead of claiming there are no tab stops', async () => {
    const { view, editor, openDialog } = mountDialog(
      p('one', '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>') +
        p('two', '<w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs>')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(document.body.textContent).toContain('different tab stops');
  });

  test('changing the line rule and changing back restores the value it opened on', async () => {
    // Otherwise a user who picks "Exactly" and reconsiders silently writes the hardcoded
    // 1.08 over whatever their style supplies.
    const { view, editor, openDialog } = mountDialog(
      p('alpha', '<w:spacing w:line="276" w:lineRule="auto"/>')
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(field(view, 'At').value).toBe('1.15');

    await act(async () => {
      fireEvent.change(field(view, 'Line spacing'), { target: { value: 'exact' } });
    });
    expect(field(view, 'At').value).toBe('12');
    await act(async () => {
      fireEvent.change(field(view, 'Line spacing'), { target: { value: 'multiple' } });
    });
    expect(field(view, 'At').value).toBe('1.15');

    await act(async () => {
      okButton(view).click();
    });
    // Nothing moved, so nothing was written over the style.
    expect(editor().snapshot().canUndo).toBe(false);
  });

  test('Tab stays inside the dialog rather than landing on the document behind it', async () => {
    // The page behind is the EDITABLE surface, so a Tab that escapes puts the caret back in
    // the text the dialog is about to format, and the next keystroke types into it.
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    const panel = root().querySelector('[role="dialog"]');
    if (!panel) throw new Error('the dialog did not render');
    const focusable = [...panel.querySelectorAll<HTMLElement>('button, input, select')].filter(
      (node) => !node.hasAttribute('disabled')
    );
    const last = focusable[focusable.length - 1]!;

    // Walking forward off the END wraps to the first control, not out of the dialog.
    await act(async () => {
      last.focus();
      fireEvent.keyDown(panel, { key: 'Tab' });
    });
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusable[0]!);

    // And Shift+Tab off the FRONT wraps to the last.
    await act(async () => {
      fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    });
    expect(document.activeElement).toBe(last);
  });

  test('Enter on a select commits the option, it does not submit the dialog', async () => {
    // Enter is how you commit the option you have arrowed to. Submitting the whole form
    // out from under that gesture closes the dialog before the user has finished choosing.
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();

    const alignment = field(view, 'Alignment');
    await act(async () => {
      fireEvent.keyDown(alignment, { key: 'Enter' });
    });
    // Still open, and nothing written.
    expect(root().querySelector('[role="dialog"]')).not.toBeNull();
    expect(editor().snapshot().canUndo).toBe(false);
  });

  test('a refused write says so instead of swallowing the OK', async () => {
    // `Exactly 0` is a line box of no height; the op layer refuses it. Before this the
    // dialog just sat there, which reads as broken rather than as refused.
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    await act(async () => {
      fireEvent.change(field(view, 'Line spacing'), { target: { value: 'exact' } });
    });
    await act(async () => {
      fireEvent.change(field(view, 'At'), { target: { value: '0' } });
    });
    await act(async () => {
      okButton(view).click();
    });

    const alert = root().querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // Still open, because nothing was written.
    expect(root().querySelector('[role="dialog"]')).not.toBeNull();
  });

  test('a no-change OK writes nothing, so it cannot detach a paragraph from its style', async () => {
    // Sending the whole form would bake every cascaded value into direct `w:pPr`: the
    // paragraph keeps its look and quietly stops following the style it was written from.
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    await act(async () => {
      okButton(view).click();
    });
    // Nothing authored: the paragraph still holds only what it opened with.
    expect(editor().snapshot().canUndo).toBe(false);
  });
});

describe('the Paragraph dialog Direction field', () => {
  const direction = (view: ReturnType<typeof render>) =>
    field(view, 'Direction') as HTMLSelectElement;

  test('seeds the current direction, and OK writes the one you pick', async () => {
    const { view, editor, openDialog } = mountDialog(p('alpha', '<w:bidi/>'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(direction(view).value).toBe('rtl');

    await act(async () => {
      fireEvent.change(direction(view), { target: { value: 'ltr' } });
    });
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().snapshot().formatting?.direction).toBe('ltr');
  });

  test('a paragraph with no w:bidi opens as left-to-right, and Right-to-left writes w:bidi', async () => {
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(direction(view).value).toBe('ltr');

    await act(async () => {
      fireEvent.change(direction(view), { target: { value: 'rtl' } });
    });
    await act(async () => {
      okButton(view).click();
    });
    expect(xmlOf(editor())).toContain('<w:bidi');
    expect(editor().snapshot().formatting?.direction).toBe('rtl');
  });

  test('Direction trades the Alignment field edge and moves the paragraph like the toolbar', async () => {
    const { view, editor, openDialog } = mountDialog(p('alpha'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    const alignment = field(view, 'Alignment') as HTMLSelectElement;
    expect(alignment.value).toBe('left');
    await act(async () => {
      fireEvent.change(direction(view), { target: { value: 'rtl' } });
    });
    // The start edge is now the right one, and the field says so before OK.
    expect(alignment.value).toBe('right');
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().snapshot().formatting).toMatchObject({ direction: 'rtl', alignment: 'right' });
    // Same XML as the toolbar button: the stored alignment is untouched.
    expect(xmlOf(editor())).not.toContain('<w:jc');
  });

  test('a mixed selection opens blank, stays mixed if untouched, and resolves when set', async () => {
    const { view, editor, openDialog, close } = mountDialog(p('one', '<w:bidi/>') + p('two'));
    await act(async () => {
      editor().surface!.selectAll();
    });
    await openDialog();
    expect(editor().snapshot().formatting?.disagrees?.direction).toBe(true);
    expect(direction(view).value).toBe('');

    // Untouched: OK writes nothing, so the paragraphs keep their own directions.
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().snapshot().canUndo).toBe(false);
    await close();

    await openDialog();
    expect(direction(view).value).toBe('');
    await act(async () => {
      fireEvent.change(direction(view), { target: { value: 'rtl' } });
    });
    await act(async () => {
      okButton(view).click();
    });
    expect(editor().snapshot().formatting?.direction).toBe('rtl');
    expect(editor().snapshot().formatting?.disagrees?.direction).toBe(false);
  });
});
