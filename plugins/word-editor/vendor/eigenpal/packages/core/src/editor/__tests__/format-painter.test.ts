// Word's Format Painter: copy the formatting here, paint it there, move no text.
//
// Three things are worth pinning and nothing else in the suite covers them:
//
//   1. The capture reads the RESOLVED cascade. Every other formatting write in the engine
//      bases itself on what a run AUTHORS, because echoing the cascade freezes inherited
//      formatting as direct. The painter is the one place where echoing it is the point:
//      copying from a styled heading whose runs author nothing must still carry the face
//      the reader can see, or the feature does nothing on exactly the documents that need
//      it most.
//   2. The LEVEL follows the selection, the way Word's does. A range inside a paragraph is
//      character formatting; a range that covers a paragraph mark carries the paragraph
//      style and its direct properties too.
//   3. Painting is SUBTRACTIVE as well as additive. A capture spells out the properties
//      that are OFF, so painting plain text over bold text un-bolds it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { toolbarCommandState, runToolbarCommand } from '../toolbar-commands.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

// `Fancy` authors the whole face — bold, 24pt, red, Georgia — so a run inside a paragraph
// written in it authors NOTHING and the capture has to resolve the cascade to see any of it.
const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Fancy"><w:name w:val="Fancy"/><w:rPr>' +
  '<w:b/><w:sz w:val="48"/><w:color w:val="FF0000"/>' +
  '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr></w:style>' +
  '</w:styles>';

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
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (runs: string, pPr = '') => `<w:p>${pPr}${runs}</w:p>`;
const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

/** A `Fancy` paragraph, centred and indented, whose run states nothing of its own. */
const STYLED = p(
  textRun('styled'),
  '<w:pPr><w:pStyle w:val="Fancy"/><w:jc w:val="center"/><w:ind w:left="720"/></w:pPr>'
);
const PLAIN = p(textRun('plain'));
/** No runs at all: the layout publishes no style span for it, so nothing resolves a face. */
const EMPTY_STYLED = p('', '<w:pPr><w:pStyle w:val="Fancy"/><w:jc w:val="center"/></w:pPr>');

function withEditor(body: string, run: (editor: DocxEditorInstance) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  try {
    run(editor);
  } finally {
    editor.destroy();
    container.remove();
  }
}

function paragraphNodes(part: { root: OoxmlNode }): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') found.push(node);
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return found;
}

function describeProperties(container: OoxmlNode): string[] {
  if (container.kind === 'textValue') return [];
  return container.children.flatMap((child) => {
    if (child.kind === 'textValue') return [];
    const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
    const ascii = child.attributes.find((entry) => entry.localName === 'ascii')?.value;
    if (val === undefined) return [ascii === undefined ? child.localName : `rFonts=${ascii}`];
    return [`${child.localName}=${val}`];
  });
}

/** The `w:rPr` children of one run, as `name=val` strings. */
function runProperties(editor: DocxEditorInstance, paragraph: number, run = 0): string[] {
  const node = paragraphNodes(editor.surface!.session.part())[paragraph]!;
  if (node.kind === 'textValue') return [];
  const target = node.children.filter((child) => child.kind === 'run')[run];
  if (!target || target.kind === 'textValue') return [];
  const rPr = target.children.find((child) => child.kind === 'runProperties');
  return rPr ? describeProperties(rPr) : [];
}

/** The attributes one run property carries, for the settings `describeProperties` folds away. */
function runPropertyAttributes(
  editor: DocxEditorInstance,
  paragraph: number,
  localName: string
): Record<string, string> {
  const node = paragraphNodes(editor.surface!.session.part())[paragraph]!;
  if (node.kind === 'textValue') return {};
  const run = node.children.filter((child) => child.kind === 'run')[0];
  if (!run || run.kind === 'textValue') return {};
  const rPr = run.children.find((child) => child.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') return {};
  const property = rPr.children.find(
    (child) => child.kind !== 'textValue' && child.localName === localName
  );
  if (!property || property.kind === 'textValue') return {};
  return Object.fromEntries(property.attributes.map((a) => [a.localName, a.value]));
}

/** One paragraph's own `w:pPr`, minus the mark's run properties. */
function paragraphProperties(editor: DocxEditorInstance, paragraph: number): string[] {
  const node = paragraphNodes(editor.surface!.session.part())[paragraph]!;
  if (node.kind === 'textValue') return [];
  const pPr = node.children.find((child) => child.kind === 'paragraphProperties');
  if (!pPr || pPr.kind === 'textValue') return [];
  return describeProperties(pPr).filter((entry) => entry !== 'rPr');
}

function select(editor: DocxEditorInstance, from: [number, number], to: [number, number]): void {
  const ids = editor.surface!.session.paragraphIds();
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
}

const caretAt = (editor: DocxEditorInstance, paragraph: number, offset: number): void =>
  select(editor, [paragraph, offset], [paragraph, offset]);

describe('the capture', () => {
  test('reads the resolved cascade, so a styled run carries what the reader sees', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      // The source run authors NOTHING: everything visible about it comes from `Fancy`.
      expect(runProperties(editor, 0)).toEqual([]);

      select(editor, [0, 0], [0, 6]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      select(editor, [1, 0], [1, 5]);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true });

      const painted = runProperties(editor, 1);
      expect(painted).toContain('b=1');
      expect(painted).toContain('sz=48');
      expect(painted).toContain('color=FF0000');
      expect(painted).toContain('rFonts=Georgia');
    });
  });

  test('a copy starting on CJK text keeps each face in its own w:rFonts slot', () => {
    // The source run resolves BOTH faces. The capture must write the Latin one into
    // `w:ascii`/`w:hAnsi` and the East Asian one into `w:eastAsia` — copying from a CJK
    // span must never put the East Asian face onto the target's Latin text.
    const CJK = p(
      textRun('甲方shall', '<w:rPr><w:rFonts w:ascii="Georgia" w:eastAsia="SimSun"/></w:rPr>')
    );
    withEditor(CJK + PLAIN, (editor) => {
      // The selection starts ON the CJK span of the mixed run.
      select(editor, [0, 0], [0, 2]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      select(editor, [1, 0], [1, 5]);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true });

      expect(runPropertyAttributes(editor, 1, 'rFonts')).toEqual({
        ascii: 'Georgia',
        hAnsi: 'Georgia',
        eastAsia: 'SimSun',
      });
    });
  });

  test('a range inside one paragraph copies character formatting alone', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      // Two characters short of the paragraph's end, so no paragraph mark is covered.
      select(editor, [0, 0], [0, 4]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('run');

      select(editor, [1, 0], [1, 5]);
      editor.exec({ type: 'pasteFormatting' });
      // The target keeps its own (absent) paragraph formatting: no style, no alignment.
      expect(paragraphProperties(editor, 1)).toEqual([]);
      expect(runProperties(editor, 1)).toContain('b=1');
    });
  });

  test('a selection that covers the paragraph mark copies paragraph formatting too', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');

      select(editor, [1, 0], [1, 5]);
      editor.exec({ type: 'pasteFormatting' });
      expect(paragraphProperties(editor, 1)).toEqual(['pStyle=Fancy', 'ind', 'jc=center']);
    });
  });

  test('an EMPTY paragraph still copies its paragraph formatting', () => {
    withEditor(EMPTY_STYLED + PLAIN, (editor) => {
      caretAt(editor, 0, 0);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');

      select(editor, [1, 0], [1, 5]);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true, changed: true });
      expect(paragraphProperties(editor, 1)).toEqual(['pStyle=Fancy', 'jc=center']);
      // No text to read a face from, so the capture states no character formatting and the
      // target's runs keep their own rather than taking an invented one.
      expect(runProperties(editor, 1)).toEqual([]);
    });
  });

  test('a collapsed caret copies paragraph formatting, as Word does', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      caretAt(editor, 0, 3);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });
});

describe('painting', () => {
  test('is subtractive: plain formatting over bold text clears the bold', () => {
    withEditor(p(textRun('plain')) + p(textRun('loud', '<w:rPr><w:b/></w:rPr>')), (editor) => {
      select(editor, [0, 0], [0, 5]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 4]);
      editor.exec({ type: 'pasteFormatting' });
      // Explicitly off, not merely dropped: `w:b` may be inherited, so the override has to
      // state the off value or the style's bold comes straight back.
      expect(runProperties(editor, 1)).toContain('b=0');
      expect(editor.snapshot().formatting?.bold).toBe(false);
    });
  });

  test('carries the run properties a toolbar never shows, so the target cannot keep its own', () => {
    const loud =
      '<w:rPr><w:spacing w:val="40"/><w:position w:val="6"/>' +
      '<w:w w:val="150"/><w:kern w:val="32"/></w:rPr>';
    withEditor(p(textRun('plain')) + p(textRun('wide', loud)), (editor) => {
      select(editor, [0, 0], [0, 5]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 4]);
      editor.exec({ type: 'pasteFormatting' });
      // `runPropertyEdits` MERGES over what the target authors, so anything the capture does
      // not name survives the paint. Expanded, raised, stretched text would have.
      const painted = runProperties(editor, 1);
      expect(painted).toContain('spacing=0');
      expect(painted).toContain('position=0');
      expect(painted).toContain('w=100');
      expect(painted).toContain('kern=0');
    });
  });

  test('carries the underline COLOUR, not just its variant', () => {
    const red = '<w:rPr><w:u w:val="single" w:color="FF0000"/></w:rPr>';
    withEditor(
      p(textRun('plain', '<w:rPr><w:u w:val="double"/></w:rPr>')) + p(textRun('loud', red)),
      (editor) => {
        select(editor, [0, 0], [0, 5]);
        editor.exec({ type: 'copyFormatting' });
        select(editor, [1, 0], [1, 4]);
        editor.exec({ type: 'pasteFormatting' });
        // `w:u` merges ATTRIBUTE by attribute, so an omitted colour is the target's colour
        // kept — a red double underline where the source had a text-coloured one.
        expect(runPropertyAttributes(editor, 1, 'u')).toMatchObject({
          val: 'double',
          color: 'auto',
        });
      }
    );
  });

  test('a caret paint carries the paragraph MARK, so a list marker follows its paragraph', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      caretAt(editor, 0, 3);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      caretAt(editor, 1, 2);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true });

      // A paragraph-level capture reformats the paragraph wholesale, and its mark is part of
      // that: a bulleted item painted by CLICKING would otherwise become a list item whose
      // bullet kept the target's old face, while the same capture over a SELECTION carried it.
      const node = paragraphNodes(editor.surface!.session.part())[1]!;
      const pPr =
        node.kind === 'paragraph'
          ? node.children.find((child) => child.kind === 'paragraphProperties')
          : undefined;
      const mark =
        pPr && pPr.kind !== 'textValue'
          ? pPr.children.find((child) => child.kind === 'runProperties')
          : undefined;
      expect(mark).toBeDefined();
    });
  });

  test('a range that ends at the START of a paragraph leaves that paragraph alone', () => {
    withEditor(
      STYLED + PLAIN + p(textRun('third'), '<w:pPr><w:jc w:val="right"/></w:pPr>'),
      (editor) => {
        select(editor, [0, 0], [0, 6]);
        editor.exec({ type: 'copyFormatting' });
        // Dragging from the middle of one paragraph to the very START of the next selects no
        // character of the next. The paragraph write REPLACES, so reaching it would take its
        // style, indents, numbering and spacing with it.
        select(editor, [1, 2], [2, 0]);
        editor.exec({ type: 'pasteFormatting' });
        expect(paragraphProperties(editor, 2)).toEqual(['jc=right']);
      }
    );
  });

  test('a range ending at the next paragraph’s start still marks the one it covered', () => {
    withEditor(p(textRun('plain')) + p(textRun('second')) + PLAIN, (editor) => {
      // A RUN-level capture, so the mark rule is the range's rather than the wholesale one.
      select(editor, [0, 0], [0, 3]);
      editor.exec({ type: 'copyFormatting' });
      // The range reaches PAST paragraph 1's pilcrow — that is what makes the pilcrow part
      // of it — even though the clamp drops paragraph 2 from the write.
      select(editor, [1, 0], [2, 0]);
      editor.exec({ type: 'pasteFormatting' });

      const node = paragraphNodes(editor.surface!.session.part())[1]!;
      const pPr =
        node.kind === 'paragraph'
          ? node.children.find((child) => child.kind === 'paragraphProperties')
          : undefined;
      const mark =
        pPr && pPr.kind !== 'textValue'
          ? pPr.children.find((child) => child.kind === 'runProperties')
          : undefined;
      expect(mark).toBeDefined();
      // And paragraph 2 is untouched, which is the clamp doing its job beside it.
      expect(paragraphProperties(editor, 2)).toEqual([]);
    });
  });

  test('the paragraph write replaces rather than merges, so the source is what survives', () => {
    withEditor(PLAIN + STYLED, (editor) => {
      select(editor, [0, 0], [0, 5]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 6]);
      editor.exec({ type: 'pasteFormatting' });
      // The plain source states no style, no alignment and no indent, so the styled target
      // keeps none of its own — it ends up formatted like the source, which is the promise.
      expect(paragraphProperties(editor, 1)).toEqual([]);
    });
  });

  test('the painted result survives a save and reopen', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx(STYLED + PLAIN) });
    try {
      select(editor, [0, 0], [0, 6]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 5]);
      editor.exec({ type: 'pasteFormatting' });
      const bytes = new Uint8Array(await editor.save());

      const reopened = document.createElement('div');
      document.body.append(reopened);
      const second = createDocxEditor({ container: reopened, document: bytes });
      try {
        expect(paragraphProperties(second, 1)).toEqual(['pStyle=Fancy', 'ind', 'jc=center']);
        expect(runProperties(second, 1)).toContain('sz=48');
        expect(runProperties(second, 1)).toContain('color=FF0000');
      } finally {
        second.destroy();
        reopened.remove();
      }
    } finally {
      editor.destroy();
      container.remove();
    }
  });
});

describe('the control', () => {
  test('a refused paint is told apart from a paint that reached nothing', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 5]);
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      const refusal = editor.exec({ type: 'pasteFormatting' });
      expect(refusal.ok).toBe(false);
      // The DOCUMENT's own words. Collapsed to one failure, this told a reader looking at a
      // document open for viewing to select some text.
      if (!refusal.ok) expect(refusal.reason).toBe('the document is open for viewing');
    });
  });

  test('a paint that reaches nothing is refused rather than reported as a no-op change', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      // A RUN-level capture, then a caret in a paragraph with no text to reach: there is no
      // range to paint and no paragraph formatting in the capture, so the command answers for
      // itself rather than letting an unmoved revision read as a successful no-op.
      select(editor, [0, 0], [0, 4]);
      editor.exec({ type: 'copyFormatting' });
      expect(editor.surface!.formatPainter.state().level).toBe('run');
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      select(editor, [1, 0], [1, 5]);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: false });
    });
  });

  test('painting is refused with the engine’s reason until something is copied', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [1, 0], [1, 5]);
      const gate = editor.can({ type: 'pasteFormatting' });
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.reason).toBe('no formatting has been copied');
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: false });
    });
  });

  test('a press arms the painter for one application and reports the mode', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      expect(toolbarCommandState(editor, 'format.painter')).toMatchObject({
        enabled: true,
        active: false,
        value: 'off',
      });

      expect(runToolbarCommand(editor, 'format.painter')).toMatchObject({ ok: true });
      expect(toolbarCommandState(editor, 'format.painter')).toMatchObject({
        enabled: true,
        active: true,
        value: 'once',
      });
    });
  });

  test('arming REACHES a host, so a toolbar can light up', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      let ticks = 0;
      const off = editor.on('selectionChange', () => {
        ticks += 1;
      });
      const first = editor.snapshot();

      runToolbarCommand(editor, 'format.painter');

      // Asserted on the EVENT, not on a later read: `useEditorState` is a subscription, so a
      // press that quietly invalidated the snapshot cache and emitted nothing would leave the
      // button un-pressed until something unrelated woke it. Arming moves no revision and no
      // caret, which is exactly why it needs its own answer in the publish signal.
      expect(ticks).toBe(1);
      expect(editor.snapshot()).not.toBe(first);
      off();
    });
  });

  test('a second press inside the double-press window locks it on', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('locked');
    });
  });

  test('a press on a LOCKED painter stands it down, as a second click does in Word', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('locked');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('a double-click that dismisses the painter does not hand it back armed', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('locked');

      // Two more rapid presses: the pair is one double-click, and its first half turned the
      // painter off. Handing it back armed would leave the user's next click in the document
      // silently repainting formatting they thought they had dismissed.
      runToolbarCommand(editor, 'format.painter');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('a press is refused on a document that would refuse the paint', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      // A caller that dispatches by slot id without reading the enabled state gets the same
      // answer the button shows, rather than an armed painter whose every release builds ops
      // the session then rejects.
      expect(runToolbarCommand(editor, 'format.painter')).toMatchObject({ ok: false });
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('switching to viewing releases an armed painter', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('once');

      // Left armed, the pages would keep the paint cursor and every release would go on
      // building ops the session refuses.
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('a press right after dismissing a single-application arming re-arms it', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      // Past the window, so this press DISMISSES rather than locking.
      Bun.sleepSync(520);
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
      // Inside the window of the press that dismissed it, and it must still arm: a `once`
      // arming is dismissed with a single click, so a press that follows is a change of mind.
      // Swallowed, it would be a control that looks live and does nothing. (A dismissed LOCK
      // is the opposite case, asserted above.)
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('once');
    });
  });

  test('painting through the command spends a single-application arming', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      select(editor, [1, 0], [1, 5]);
      // The keyboard's paint is the same paint. Left armed, the pages kept the copy cursor
      // and the next click in the document painted again.
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('a double press that finds nothing to capture leaves the control unarmed', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      // The capture reads the LAYOUT, so a selection it has not published answers nothing.
      editor.surface!.setSelection({
        anchor: { paragraphId: 'no-such-paragraph', offset: 0 },
        head: { paragraphId: 'no-such-paragraph', offset: 0 },
      });
      expect(runToolbarCommand(editor, 'format.painter')).toMatchObject({ ok: false });
      // Reporting a refusal while the button still renders pressed is the disagreement the
      // enabled-state rule exists to prevent.
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('standing down clears the double-press window, so the next press arms once', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      // Cancel it, then press again straight away. Without clearing the window the third
      // press read as the second half of a double-click and locked the painter on.
      editor.surface!.formatPainter.disarm();
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('once');
    });
  });

  test('the control greys out on a document open for viewing', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      const state = toolbarCommandState(editor, 'format.painter');
      // Arming a painter this document will refuse to apply is the dead button the
      // enabled-state rule exists to prevent.
      expect(state.enabled).toBe(false);
      expect(state.disabledReason).toBe('the document is open for viewing');
    });
  });

  test('a lone second press outside the window stands it down again', async () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      // Past the engine's 500ms double-press window, so this reads as a separate press.
      Bun.sleepSync(520);
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
      // The CAPTURE survives standing down — only the arming ends, so Paste Formatting and
      // the keyboard chord still work.
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });
});

describe('the keyboard', () => {
  const chord = (
    key: string,
    code: string,
    init: KeyboardEventInit = {},
    modifiers: readonly string[] = []
  ): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, code, cancelable: true, ...init });
    // happy-dom's `getModifierState` does not answer for AltGraph, and AltGraph is the whole
    // subject of one of these tests, so the event carries its own answer.
    Object.defineProperty(event, 'getModifierState', {
      configurable: true,
      value: (name: string) => modifiers.includes(name),
    });
    return event;
  };

  test('Cmd+Alt+C copies and Cmd+Alt+V paints — Command on a Mac, Ctrl elsewhere', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);

      select(editor, [0, 0], [0, 6]);
      // `metaKey`: the keymap treats Cmd and Ctrl as ONE accelerator, so the Mac chord and
      // the Windows chord reach the same command.
      onKeyDown(chord('ç', 'KeyC', { metaKey: true, altKey: true }));
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');

      select(editor, [1, 0], [1, 5]);
      onKeyDown(chord('√', 'KeyV', { metaKey: true, altKey: true }));
      expect(runProperties(editor, 1)).toContain('sz=48');
    });
  });

  test('Ctrl+Alt+C works the same way, and reads the key rather than the code', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      onKeyDown(chord('c', '', { ctrlKey: true, altKey: true }));
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });

  test('Ctrl+Alt still reaches a chord the AltGr layout composes nothing for', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      // `AltGraph` reports the MODIFIER, not whether this key composes with it. Polish maps
      // AltGr over a, c, e, l, n, o, s, x and z — so `v` still produces `v`, and refusing on
      // the modifier alone would have taken these chords down there for nothing.
      const event = chord('v', 'KeyV', { ctrlKey: true, altKey: true }, ['AltGraph']);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 5]);
      onKeyDown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(runProperties(editor, 1)).toContain('sz=48');
    });
  });

  test('AltGr types its character instead of capturing — the chord is Ctrl+Alt, not AltGr', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      // Windows and Linux spell AltGr as Ctrl+Alt, so every Ctrl+Alt binding sits on top of
      // a character somebody's layout composes: AltGr+C is `ć` on Polish. Swallowing it
      // would type nothing at all.
      const event = chord('ć', 'KeyC', { ctrlKey: true, altKey: true }, ['AltGraph']);
      onKeyDown(event);
      expect(event.defaultPrevented).toBe(false);
      expect(editor.surface!.formatPainter.state().level).toBe('none');
    });
  });

  test('a remapped layout keys the chord on the character, not the keycap', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      // Dvorak types `c` from the key at QWERTY's `I` position. A user reaching for the chord
      // presses the key that types `c`, and Windows resolves accelerators the same way —
      // reading the keycap first sent this to whatever `KeyI` is bound to instead.
      onKeyDown(chord('c', 'KeyI', { ctrlKey: true, altKey: true }));
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });

  test('the keycap answers only when the character is not a letter', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      // macOS composes Option+C into `ç`, so there is no letter to read and the keycap is
      // the only identifier left. The same fallback is what makes an AltGr-composed
      // character below fail the accelerator test rather than be swallowed.
      onKeyDown(chord('ç', 'KeyC', { metaKey: true, altKey: true }));
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });

  test('an unidentified key code still reaches the chord, through the character', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      // Android IMEs, remote desktops and on-screen keyboards report a code that names no
      // physical key. Matched against `Key*` alone, the chord was silently dead on exactly
      // the keyboards that have no keys.
      onKeyDown(chord('c', 'Unidentified', { ctrlKey: true, altKey: true }));
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });

  test('Escape stands the armed painter down before it releases any other mode', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('once');

      const event = chord('Escape', 'Escape');
      onKeyDown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('Ctrl+Shift+V still arms a force-plain paste — the painter did not take it', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      const event = chord('V', 'KeyV', { ctrlKey: true, shiftKey: true });
      onKeyDown(event);
      // Not prevented: the browser's own paste has to follow, and the armed flag is what the
      // paste handler reads. Nothing was captured, so the painter stayed out of it.
      expect(event.defaultPrevented).toBe(false);
      expect(editor.surface!.formatPainter.state().level).toBe('none');
    });
  });
});

describe('the drag gesture', () => {
  const MARGIN = 72;

  function mount(body: string): { surface: PaginatedSurface; pages: HTMLElement } {
    const container = document.createElement('div');
    document.body.append(container);
    const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    // happy-dom reports no layout, so the one measurement the pointer controller makes is
    // supplied. A non-zero origin, so a controller that forgot to subtract it would fail.
    Object.defineProperty(pages, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 50,
        right: 1100,
        bottom: 1050,
        width: 1000,
        height: 1000,
        x: 100,
        y: 50,
      }),
    });
    return { surface: result.surface, pages };
  }

  const pointer = (type: string, x: number, y: number): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100 + MARGIN + x,
      clientY: 50 + MARGIN + y,
    });

  /** Drag across the second paragraph's line, which is where the painter should land. */
  function dragSecondLine(pages: HTMLElement): void {
    pages.dispatchEvent(pointer('pointerdown', -40, 25));
    document.dispatchEvent(pointer('pointermove', 500, 25));
    document.dispatchEvent(pointer('pointerup', 500, 25));
  }

  test('an armed painter paints the range the drag produced, then stands down', () => {
    const { surface, pages } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      surface.formatPainter.press();
      expect(surface.formatPainter.state().mode).toBe('once');
      // The affordance the reader sees: the pages layer says the next drag paints.
      expect(pages.dataset['formatPainter']).toBe('');

      dragSecondLine(pages);

      expect(surface.formatPainter.state().mode).toBe('off');
      expect(pages.dataset['formatPainter']).toBeUndefined();
      const painted = paragraphNodes(surface.session.part())[1]!;
      expect(painted.kind === 'paragraph' && describeProperties(painted).length).toBeGreaterThan(0);
    } finally {
      surface.destroy();
    }
  });

  test('a cancelled gesture does not paint and leaves the painter armed', () => {
    const { surface, pages } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      surface.formatPainter.press();
      const before = surface.session.packageRevision();

      // `pointercancel` is the browser TAKING the gesture away — a system touch gesture, a
      // device change — so the range under the pointer is not one the user chose.
      pages.dispatchEvent(pointer('pointerdown', -40, 25));
      document.dispatchEvent(pointer('pointermove', 500, 25));
      document.dispatchEvent(pointer('pointercancel', 500, 25));

      expect(surface.session.packageRevision()).toBe(before);
      expect(surface.formatPainter.state().mode).toBe('once');
    } finally {
      surface.destroy();
    }
  });

  test('apply names the document’s refusal rather than reporting its own op count', () => {
    const { surface } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      expect(surface.formatPainter.capture()).toBe(true);
      // The write is built and then refused, which is exactly the case an op count cannot
      // see: `commit` hands nothing back, so the model revision is what settles it.
      surface.setEditingMode('view');
      surface.setSelection({
        anchor: { paragraphId: ids[1]!, offset: 0 },
        head: { paragraphId: ids[1]!, offset: 5 },
      });
      expect(surface.formatPainter.apply()).toBe('refused');
    } finally {
      surface.destroy();
    }
  });

  test('one click paints the WORD under it, then stands the painter down', () => {
    const bold = '<w:rPr><w:b/></w:rPr>';
    const { surface, pages } = mount(p(textRun('plain')) + p(textRun('second line here', bold)));
    try {
      const ids = surface.session.paragraphIds();
      // A RUN-level capture: a range inside one paragraph, short of its end.
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 3 },
      });
      surface.formatPainter.press();

      // ONE click, in the middle of "line" on the second paragraph. A caret selects nothing,
      // so painting the range would paint nothing at all — Word paints the word under the
      // pointer, which is what leaves the gesture with something to spend its arming on.
      pages.dispatchEvent(pointer('pointerdown', 40, 25));
      document.dispatchEvent(pointer('pointerup', 40, 25));

      expect(surface.formatPainter.state().mode).toBe('off');
      // The bold run was split around the painted word, so a run in the paragraph now
      // states the source's un-bold face.
      const painted = paragraphNodes(surface.session.part())[1]!;
      const faces =
        painted.kind === 'paragraph'
          ? painted.children
              .filter((child) => child.kind === 'run')
              .map((run) => {
                if (run.kind === 'textValue') return [];
                const rPr = run.children.find((child) => child.kind === 'runProperties');
                return rPr ? describeProperties(rPr) : [];
              })
          : [];
      expect(faces.some((face) => face.includes('b=0'))).toBe(true);
    } finally {
      surface.destroy();
    }
  });

  test('a locked painter stays armed after painting', () => {
    const { surface, pages } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      surface.formatPainter.press();
      surface.formatPainter.press();
      expect(surface.formatPainter.state().mode).toBe('locked');

      dragSecondLine(pages);

      expect(surface.formatPainter.state().mode).toBe('locked');
      expect(pages.dataset['formatPainter']).toBe('');
    } finally {
      surface.destroy();
    }
  });
});

describe('a click with the painter armed beside an inline control', () => {
  test('paints the word up to the control edge, never into the control', () => {
    const control = `<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>${textRun('TOKEN')}</w:sdtContent></w:sdt>`;
    const body =
      p(textRun('src', '<w:rPr><w:b/></w:rPr>')) + p(textRun('aa') + control + textRun('zz'));
    withEditor(body, (editor) => {
      select(editor, [0, 0], [0, 3]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      caretAt(editor, 1, 1);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true });
      expect(runProperties(editor, 1, 0)).toContain('b=1');
      caretAt(editor, 1, 4);
      expect(editor.getSelectionFormatting()?.bold).toBe(false);
    });
  });
});
