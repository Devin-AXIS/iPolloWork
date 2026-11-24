// Backspace and Delete beside an inline control whose content is locked.
//
// The first press beside a `contentLocked` / `sdtContentLocked` control selects the whole
// control and deletes nothing. A second press, with the control selected, removes it when only
// its content is locked, and is refused when the control itself is locked too. Controls whose
// content can be typed into keep deleting one character at a time. The rule is the same in
// both locked-control navigation modes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { LockedControlNavigation } from '../paginated-surface-options.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

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

const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const control = (text: string, lock: string, n = 1) =>
  `<w:sdt><w:sdtPr><w:alias w:val="T${n}"/><w:tag w:val="dtpl:v2:00000000-0000-4000-8000-00000000000${n}"/>` +
  `${lock === 'none' ? '' : `<w:lock w:val="${lock}"/>`}<w:text/></w:sdtPr>` +
  `<w:sdtContent>${run(text)}</w:sdtContent></w:sdt>`;

/** "aa" [2,7) "Token" "zz": the control covers offsets 2..7. */
const TOKEN = 'Token';
const line = (lock: string) => `<w:p>${run('aa')}${control(TOKEN, lock)}${run('zz')}</w:p>`;

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly pages: HTMLElement;
  readonly paragraphId: string;
}

const mountedContainers: HTMLElement[] = [];
const mountedSurfaces: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mountedSurfaces.splice(0)) surface.destroy();
  for (const container of mountedContainers.splice(0)) container.remove();
});

function mount(
  body: string,
  navigation: LockedControlNavigation | null,
  extra: { editingMode?: 'suggest'; author?: string } = {}
): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  mountedContainers.push(container);
  const result = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    ...extra,
    ...(navigation ? { lockedControlNavigation: navigation } : {}),
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  mountedSurfaces.push(result.surface);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
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
  return { surface: result.surface, pages, paragraphId: result.surface.session.paragraphIds()[0]! };
}

const caretAt = (m: Mounted, offset: number, head = offset) =>
  m.surface.setSelection({
    anchor: { paragraphId: m.paragraphId, offset },
    head: { paragraphId: m.paragraphId, offset: head },
  });
const offsets = (m: Mounted): [number, number] => {
  const { anchor, head } = m.surface.state().selection;
  return [anchor.offset, head.offset];
};

const MODES: readonly (LockedControlNavigation | null)[] = [null, 'atomic'];
const bodyText = (m: Mounted) => m.surface.session.bodyText();
const controls = (m: Mounted) => m.surface.layout().contentControls?.length ?? 0;
const rejection = (m: Mounted) => m.surface.state().lastRejection ?? null;

for (const mode of MODES) {
  describe(`navigation ${mode ?? 'characters'}`, () => {
    test('Backspace after a contentLocked control selects it, a second Backspace removes it', () => {
      const m = mount(line('contentLocked'), mode);
      caretAt(m, 7);
      m.surface.deleteBackward();
      expect(bodyText(m)).toBe('aaTokenzz');
      expect(controls(m)).toBe(1);
      expect(offsets(m)).toEqual([7, 2]);
      expect(rejection(m)).toBeNull();
      m.surface.deleteBackward();
      expect(bodyText(m)).toBe('aazz');
      expect(controls(m)).toBe(0);
      expect(offsets(m)).toEqual([2, 2]);
    });

    test('Delete before a contentLocked control selects it, a second Delete removes it', () => {
      const m = mount(line('contentLocked'), mode);
      caretAt(m, 2);
      m.surface.deleteForward();
      expect(bodyText(m)).toBe('aaTokenzz');
      expect(controls(m)).toBe(1);
      expect(offsets(m)).toEqual([2, 7]);
      m.surface.deleteForward();
      expect(bodyText(m)).toBe('aazz');
      expect(controls(m)).toBe(0);
    });

    test('one undo after the two-step delete restores the control', () => {
      const m = mount(line('contentLocked'), mode);
      caretAt(m, 7);
      m.surface.deleteBackward();
      m.surface.deleteBackward();
      expect(controls(m)).toBe(0);
      m.surface.undo();
      expect(bodyText(m)).toBe('aaTokenzz');
      expect(controls(m)).toBe(1);
      m.surface.redo();
      expect(bodyText(m)).toBe('aazz');
      expect(controls(m)).toBe(0);
    });

    test('an sdtContentLocked control is selected, then the second press is refused', () => {
      for (const direction of ['backward', 'forward'] as const) {
        const m = mount(line('sdtContentLocked'), mode);
        caretAt(m, direction === 'backward' ? 7 : 2);
        const remove = () =>
          direction === 'backward' ? m.surface.deleteBackward() : m.surface.deleteForward();
        remove();
        expect(rejection(m)).toBeNull();
        expect([...offsets(m)].sort()).toEqual([2, 7]);
        remove();
        expect(rejection(m)).not.toBeNull();
        expect(bodyText(m)).toBe('aaTokenzz');
        expect(controls(m)).toBe(1);
      }
    });

    test('an unlocked control still deletes one character at a time', () => {
      const m = mount(line('none'), mode);
      caretAt(m, 7);
      m.surface.deleteBackward();
      expect(bodyText(m)).toBe('aaTokezz');
      expect(controls(m)).toBe(1);
      caretAt(m, 2);
      m.surface.deleteForward();
      expect(bodyText(m)).toBe('aaokezz');
    });

    test('an sdtLocked control, whose content is typed into, deletes one character', () => {
      const m = mount(line('sdtLocked'), mode);
      caretAt(m, 7);
      m.surface.deleteBackward();
      expect(bodyText(m)).toBe('aaTokezz');
    });

    test('a selection that already covers the control removes it in one press', () => {
      const m = mount(line('contentLocked'), mode);
      caretAt(m, 1, 8);
      m.surface.deleteBackward();
      expect(bodyText(m)).toBe('az');
      expect(controls(m)).toBe(0);
    });

    test('a selection that covers an sdtContentLocked control is refused', () => {
      const m = mount(line('sdtContentLocked'), mode);
      caretAt(m, 1, 8);
      m.surface.deleteBackward();
      expect(rejection(m)).not.toBeNull();
      expect(bodyText(m)).toBe('aaTokenzz');
      expect(controls(m)).toBe(1);
    });

    test('Backspace away from the control deletes a character as before', () => {
      const m = mount(line('contentLocked'), mode);
      caretAt(m, 9);
      m.surface.deleteBackward();
      expect(bodyText(m)).toBe('aaTokenz');
    });
  });
}

describe('suggesting', () => {
  const suggesting = { editingMode: 'suggest' as const, author: 'Reviewer' };

  /** The control wrapped whole in one proposal, struck text and all. */
  const struckWhole = (m: Mounted): boolean =>
    /<w:del [^>]*>(?:(?!<\/w:del>).)*<w:sdt>(?:(?!<\/w:del>).)*<w:delText>Token<\/w:delText>/.test(
      serializeOoxmlPart(m.surface.session.part())
    );

  test('a selection that covers a contentLocked control proposes deleting it whole', () => {
    const m = mount(line('contentLocked'), null, suggesting);
    caretAt(m, 1, 8);
    m.surface.deleteBackward();
    expect(rejection(m)).toBeNull();
    // A proposal: the text stays until it is decided.
    expect(controls(m)).toBe(1);
    expect(struckWhole(m)).toBe(true);
  });

  test('the second Backspace beside a contentLocked control proposes deleting it whole', () => {
    const m = mount(line('contentLocked'), null, suggesting);
    caretAt(m, 7);
    m.surface.deleteBackward();
    expect(offsets(m)).toEqual([7, 2]);
    m.surface.deleteBackward();
    expect(rejection(m)).toBeNull();
    expect(struckWhole(m)).toBe(true);
  });

  test('forward Delete steps past a control it already proposed for deletion', () => {
    const m = mount(line('contentLocked'), null, suggesting);
    caretAt(m, 2);
    m.surface.deleteForward();
    m.surface.deleteForward();
    expect(struckWhole(m)).toBe(true);
    // The next presses move on to the text after it instead of selecting it again.
    m.surface.deleteForward();
    m.surface.deleteForward();
    expect(serializeOoxmlPart(m.surface.session.part())).toContain('<w:delText>z</w:delText>');
  });

  test('forward Delete beside a checkbox strikes it and moves on', () => {
    const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
    const checkbox =
      `<w:sdt><w:sdtPr><w:tag w:val="box"/><w14:checkbox xmlns:w14="${W14}">` +
      `<w14:checked w14:val="0"/></w14:checkbox></w:sdtPr>` +
      `<w:sdtContent>${run('☐')}</w:sdtContent></w:sdt>`;
    const m = mount(`<w:p>${run('aa')}${checkbox}${run('zz')}</w:p>`, null, suggesting);
    caretAt(m, 2);
    m.surface.deleteForward();
    m.surface.deleteForward();
    const xml = serializeOoxmlPart(m.surface.session.part());
    expect(xml).toContain('<w:delText>☐</w:delText>');
    expect(xml).toContain('<w:delText>z</w:delText>');
  });

  test('an sdtContentLocked control is still refused', () => {
    const m = mount(line('sdtContentLocked'), null, suggesting);
    caretAt(m, 1, 8);
    m.surface.deleteBackward();
    expect(rejection(m)).not.toBeNull();
    expect(serializeOoxmlPart(m.surface.session.part())).not.toContain('<w:del ');
  });
});

test('Ctrl+Backspace and deleteSelection remove a selected contentLocked control too', () => {
  const m = mount(line('contentLocked'), null);
  caretAt(m, 7);
  m.surface.deleteBackward();
  m.surface.deleteWordBackward();
  expect(rejection(m)).toBeNull();
  expect(bodyText(m)).toBe('aazz');
  const n = mount(line('contentLocked'), null);
  caretAt(n, 1, 8);
  expect(n.surface.deleteSelection()).toBe(true);
  expect(bodyText(n)).toBe('az');
});

describe('ranges and joins across paragraphs', () => {
  const two = (lock: string) => line(lock) + `<w:p>${run('next')}</w:p>`;
  const select = (m: Mounted, from: number, to: number) => {
    const second = m.surface.session.paragraphIds()[1]!;
    m.surface.setSelection({
      anchor: { paragraphId: m.paragraphId, offset: from },
      head: { paragraphId: second, offset: to },
    });
  };

  test('a selection across paragraphs that covers a contentLocked control removes it', () => {
    const m = mount(two('contentLocked'), null);
    select(m, 1, 2);
    m.surface.deleteBackward();
    expect(rejection(m)).toBeNull();
    expect(bodyText(m)).toBe('axt');
    expect(controls(m)).toBe(0);
  });

  test('a selection across paragraphs that covers an sdtContentLocked control is refused', () => {
    const m = mount(two('sdtContentLocked'), null);
    select(m, 1, 2);
    m.surface.deleteBackward();
    expect(rejection(m)).not.toBeNull();
    expect(controls(m)).toBe(1);
  });

  test('typing over a selection that covers a contentLocked control replaces it', () => {
    const m = mount(line('contentLocked'), null);
    caretAt(m, 1, 8);
    m.surface.type('Q');
    expect(rejection(m)).toBeNull();
    expect(bodyText(m)).toBe('aQz');
    expect(controls(m)).toBe(0);
  });

  test('Backspace at the start of the next paragraph joins it to a locked control line', () => {
    for (const lock of ['contentLocked', 'sdtContentLocked']) {
      const m = mount(two(lock), null);
      const second = m.surface.session.paragraphIds()[1]!;
      m.surface.setSelection({
        anchor: { paragraphId: second, offset: 0 },
        head: { paragraphId: second, offset: 0 },
      });
      m.surface.deleteBackward();
      expect(rejection(m)).toBeNull();
      expect(m.surface.session.paragraphIds()).toHaveLength(1);
      expect(controls(m)).toBe(1);
    }
  });
});
