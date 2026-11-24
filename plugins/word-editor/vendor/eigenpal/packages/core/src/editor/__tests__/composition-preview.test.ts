// THE SYLLABLE BEING COMPOSED IS VISIBLE WHERE THE INPUT METHOD WRITES IT.
//
// `insertCompositionText` cannot be prevented, so an input method writes into the painted run
// the caret is in, and the model hears of it only at `compositionend`. A caret at the end of a
// line that ends in a space sits at the end of that space's run, which is painted clipped to
// one space's advance. So every word after the first on a line being written was composed out
// of sight, and each syllable appeared only once the next one committed it.
//
// The event order these tests drive is the one Hangul input methods produce for one syllable
// and the start of the next: `compositionstart`, then per jamo `compositionupdate`, the
// browser's own rewrite of the composing text node, and `input`; at the syllable boundary
// `compositionend` with the finished syllable, and in the same task a new `compositionstart`
// for the next one. A candidate replacement (Japanese, Chinese) is the same shape with a
// longer string replacing the shorter one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tab = (before: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${before}</w:t></w:r><w:r><w:tab/></w:r></w:p>`;
const cell = (inner: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${inner}</w:tc></w:tr></w:tbl>`;

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** A body, and optionally a default header and one footnote, each a paragraph of `text`. */
function docx(body: string, stories: { header?: string; footnote?: string } = {}): Uint8Array {
  const overrides =
    (stories.header
      ? `<Override PartName="/word/header1.xml" ContentType="${TYPE}.header+xml"/>`
      : '') +
    (stories.footnote
      ? `<Override PartName="/word/footnotes.xml" ContentType="${TYPE}.footnotes+xml"/>`
      : '');
  const rels =
    (stories.header ? `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` : '') +
    (stories.footnote
      ? `<Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/>`
      : '');
  const reference = stories.footnote ? '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' : '';
  const sectPr = stories.header
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>'
    : '';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${TYPE}.document.main+xml"/>${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${reference}${sectPr}</w:body></w:document>`
    ),
  };
  if (stories.header)
    files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${p(stories.header)}</w:hdr>`);
  if (stories.footnote) {
    files['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1">${p(stories.footnote)}</w:footnote></w:footnotes>`
    );
  }
  return zipSync(files);
}

function withSurface(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => void
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface, container);
  } finally {
    opened.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}

async function withSurfaceAsync(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => Promise<void>
): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    await run(opened.surface, container);
  } finally {
    opened.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}

/** Let the next frame pass, then the tasks queued after it (the commit, its paint) run. */
async function nextTasks(): Promise<void> {
  await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  for (let index = 0; index < 3; index += 1) await new Promise((done) => setTimeout(done, 0));
}

function caretAt(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

function compositionEvent(type: string, data = ''): CompositionEvent {
  const event = new CompositionEvent(type, { bubbles: true });
  Object.defineProperty(event, 'data', { value: data, configurable: true });
  return event;
}

/** The run the browser's caret is in: where an input method writes. */
function caretRun(): HTMLElement {
  const node = document.getSelection()!.focusNode!;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as HTMLElement);
  return element.closest<HTMLElement>('[data-start]')!;
}

function clipped(run: HTMLElement): boolean {
  return (
    (run.style.clipPath !== '' && run.style.clipPath !== 'none') || run.style.overflow === 'hidden'
  );
}

/**
 * One composition, driven the way a browser drives it: each step REPLACES the composing
 * string in the text node the caret is in, then `input` fires. Returns the run composed into
 * after each step, and whether it clipped then.
 */
function composeSteps(
  pages: HTMLElement,
  steps: readonly string[]
): { run: HTMLElement; clipped: boolean }[] {
  pages.dispatchEvent(compositionEvent('compositionstart'));
  const node = document.getSelection()!.focusNode as Text;
  const start = document.getSelection()!.focusOffset;
  const tail = node.data.slice(start);
  const head = node.data.slice(0, start);
  const seen: { run: HTMLElement; clipped: boolean }[] = [];
  for (const step of steps) {
    pages.dispatchEvent(compositionEvent('compositionupdate', step));
    node.data = head + step + tail;
    document.getSelection()!.setBaseAndExtent(node, start + step.length, node, start + step.length);
    pages.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: step })
    );
    const run = node.parentElement!.closest<HTMLElement>('[data-start]')!;
    seen.push({ run, clipped: clipped(run) });
  }
  pages.dispatchEvent(compositionEvent('compositionend', steps[steps.length - 1] ?? ''));
  return seen;
}

const pagesOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.docx-pages')!;

describe('a composition after the space that ends a line', () => {
  test('the composing text is not clipped, and commits', async () => {
    await withSurfaceAsync(docx(p('우리나라 ')), async (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 5);
      // The precondition the report hinged on: the caret is in the clipped space run.
      const space = caretRun();
      expect(space.textContent).toBe(' ');
      expect(clipped(space)).toBe(true);
      const width = space.style.width;
      const seen = composeSteps(pagesOf(container), ['ㅇ', '아', '알']);
      expect(seen.map((step) => step.run)).toEqual([space, space, space]);
      expect(seen.map((step) => step.clipped)).toEqual([false, false, false]);
      // The composed text commits on a later task, as typed text does, and its paint with it.
      // Until then the text the input method wrote stays visible where it was composed.
      expect(surface.session.bodyText()).toBe('우리나라 ');
      expect(clipped(space)).toBe(false);
      await nextTasks();
      expect(surface.session.bodyText()).toBe('우리나라 알');
      // Put back the way it was painted, whether or not the paint kept the element.
      expect(space.style.width).toBe(width);
      expect(clipped(space)).toBe(true);
    });
  });

  test('every step of the composition is visible while it is composed', () => {
    withSurface(docx(p('우리나라 ')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 5);
      const pages = pagesOf(container);
      const space = caretRun();
      const width = space.style.width;
      pages.dispatchEvent(compositionEvent('compositionstart'));
      // Released before the input method writes anything: the first jamo is visible too.
      expect(clipped(space)).toBe(false);
      expect(space.style.width).toBe('auto');
      expect(space.style.minWidth).toBe(width);
      const node = document.getSelection()!.focusNode as Text;
      node.data = ' ㅇ';
      document.getSelection()!.setBaseAndExtent(node, 2, node, 2);
      pages.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ㅇ' }));
      expect(clipped(space)).toBe(false);
      pages.dispatchEvent(compositionEvent('compositionend', 'ㅇ'));
      surface.flushPendingInput();
      expect(surface.session.bodyText()).toBe('우리나라 ㅇ');
    });
  });

  test('syllable after syllable: each composes visibly, and each is one undo step', () => {
    withSurface(docx(p('우리나라 ')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 5);
      const pages = pagesOf(container);
      const syllables = [
        ['ㅇ', '아', '알'],
        ['르', '름'],
        ['ㄷ', '다'],
      ];
      // The boundary rewrite a Hangul input method performs: the final consonant moves to the
      // next syllable, so the first composition commits shorter than its last update.
      const committed = ['아', '름', '다'];
      for (const [index, steps] of syllables.entries()) {
        pages.dispatchEvent(compositionEvent('compositionstart'));
        const node = document.getSelection()!.focusNode as Text;
        const start = document.getSelection()!.focusOffset;
        const head = node.data.slice(0, start);
        for (const step of steps!) {
          pages.dispatchEvent(compositionEvent('compositionupdate', step));
          node.data = head + step;
          document
            .getSelection()!
            .setBaseAndExtent(node, head.length + step.length, node, head.length + step.length);
          pages.dispatchEvent(new InputEvent('input', { bubbles: true, data: step }));
          const run = node.parentElement!.closest<HTMLElement>('[data-start]')!;
          expect(clipped(run)).toBe(false);
        }
        node.data = head + committed[index]!;
        document.getSelection()!.setBaseAndExtent(node, head.length + 1, node, head.length + 1);
        pages.dispatchEvent(compositionEvent('compositionend', committed[index]!));
      }
      // The input method starts each syllable in the task that ends the one before, so each
      // starts over the last one's queued text, and none has reached the model yet.
      expect(surface.session.bodyText()).toBe('우리나라 ');
      surface.flushPendingInput();
      expect(surface.session.bodyText()).toBe('우리나라 아름다');
      expect(pagesOf(container).textContent).toContain('우리나라 아름다');
      // One step per committed syllable, as before.
      surface.undo();
      expect(surface.session.bodyText()).toBe('우리나라 아름');
      surface.undo();
      expect(surface.session.bodyText()).toBe('우리나라 아');
    });
  });

  test('a cancelled composition leaves the run clipped as painted', () => {
    withSurface(docx(p('우리나라 ')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 5);
      const pages = pagesOf(container);
      pages.dispatchEvent(compositionEvent('compositionstart'));
      pages.dispatchEvent(compositionEvent('compositionend', ''));
      expect(surface.session.bodyText()).toBe('우리나라 ');
      caretAt(surface, id, 5);
      expect(clipped(caretRun())).toBe(true);
      for (const run of container.querySelectorAll<HTMLElement>('[data-start]')) {
        expect(run.style.clipPath).not.toBe('none');
      }
    });
  });
});

describe('the same rule wherever the run is painted', () => {
  test('after a tab that ends a line: the tab keeps its advance and the text shows', () => {
    withSurface(docx(tab('a')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 2);
      const run = caretRun();
      expect(run.textContent).toBe('\t');
      expect(clipped(run)).toBe(true);
      const width = run.style.width;
      const pages = pagesOf(container);
      pages.dispatchEvent(compositionEvent('compositionstart'));
      expect(clipped(run)).toBe(false);
      expect(run.style.tabSize).toBe(width);
      pages.dispatchEvent(compositionEvent('compositionend', ''));
      expect(clipped(run)).toBe(true);
      expect(run.style.tabSize).toBe('');
    });
  });

  test('in a table cell', () => {
    withSurface(docx(cell(p('우리나라 '))), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 5);
      expect(clipped(caretRun())).toBe(true);
      const seen = composeSteps(pagesOf(container), ['ㅎ', '하', '한']);
      expect(seen.map((step) => step.clipped)).toEqual([false, false, false]);
      surface.flushPendingInput();
      expect(surface.session.bodyText()).toBe('우리나라 한\n');
    });
  });

  test('in a header', () => {
    withSurface(docx(p('body'), { header: '우리나라 ' }), (surface, container) => {
      expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
      const scope = { kind: 'headerFooter', rId: 'rId10' } as const;
      const id = surface.session.paragraphIdsIn(scope)[0]!;
      caretAt(surface, id, 5);
      expect(clipped(caretRun())).toBe(true);
      const seen = composeSteps(pagesOf(container), ['ㅎ', '하', '한']);
      expect(seen.map((step) => step.clipped)).toEqual([false, false, false]);
      surface.flushPendingInput();
      expect(surface.session.storyText(scope)).toBe('우리나라 한');
    });
  });

  test('in a footnote', () => {
    withSurface(docx(p('body'), { footnote: '우리나라 ' }), (surface, container) => {
      const scope = { kind: 'notesPart', noteKind: 'footnote' } as const;
      expect(surface.enterNote('footnote:1')).toBe(true);
      const id = surface.session.paragraphIdsIn(scope)[0]!;
      caretAt(surface, id, 5);
      expect(clipped(caretRun())).toBe(true);
      const seen = composeSteps(pagesOf(container), ['ㅎ', '하', '한']);
      expect(seen.map((step) => step.clipped)).toEqual([false, false, false]);
      surface.flushPendingInput();
      expect(surface.session.storyText(scope)).toBe('우리나라 한');
    });
  });

  test('Latin text and a run that is not clipped are left alone', () => {
    withSurface(docx(p('word')), (surface, container) => {
      const id = surface.session.paragraphIds()[0]!;
      caretAt(surface, id, 4);
      const run = caretRun();
      const before = run.getAttribute('style');
      composeSteps(pagesOf(container), ['´', 'é']);
      surface.flushPendingInput();
      expect(surface.session.bodyText()).toBe('wordé');
      expect(run.getAttribute('style')).toBe(before);
    });
  });
});

const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/** A floating text box holding one paragraph, anchored in a body paragraph. */
function textBoxDocx(text: string): Uint8Array {
  const box =
    '<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2000000" cy="800000"/><wp:wrapNone/><wp:docPr id="1" name="Box"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
    '<a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${p(text)}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>` +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Host</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${TYPE}.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wps="${WPS}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:r="${R}">` +
        `<w:body>${box}</w:body></w:document>`
    ),
  });
}

describe('a composition in a text box', () => {
  test('commits once, after the space that ends its line, and stays visible', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: textBoxDocx('우리나라 ') });
    try {
      const [match] = editor.findMatches('우리나라');
      expect(match?.scope?.kind).toBe('frame');
      const surface = editor.surface!;
      expect(surface.setActiveScope(match!.scope!)).toBe(true);
      caretAt(surface, match!.blockId, 5);
      const seen = composeSteps(pagesOf(container), ['ㅎ', '하', '한']);
      expect(seen.map((step) => step.clipped)).toEqual([false, false, false]);
      surface.flushPendingInput();
      expect(editor.findMatches('우리나라 한').length).toBe(1);
      expect(editor.findMatches('우리나라').length).toBe(1);
    } finally {
      editor.destroy();
      container.remove();
      document.getSelection()?.removeAllRanges();
    }
  });
});
