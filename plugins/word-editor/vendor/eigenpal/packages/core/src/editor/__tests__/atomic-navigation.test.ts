// `lockedControlNavigation: 'atomic'`: an inline control with locked content is ONE caret unit.
//
// Off (the default) the caret walks through the characters of a locked control, as in Word.
// On, arrows step over it, Shift+arrows select it whole, a press or double click INSIDE it
// selects it whole — and a press on an EDGE still places a caret, because that is where text is
// typed beside a locked control. No write rule changes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { LockedControlNavigation } from '../paginated-surface-options.ts';
import { createDocxEditor } from '../docx-editor.ts';
import {
  controlEdgeSide,
  inlineControlEdges,
  wordMotionBoundaries,
} from '../../layout/word-navigation-boundaries.ts';

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

const MARGIN = 72;

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

function mount(body: string, navigation: LockedControlNavigation | null): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  mountedContainers.push(container);
  const result = mountPaginatedSurface(container, docx(body), {
    scale: 1,
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

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 100 + MARGIN + x,
    clientY: 50 + MARGIN + y,
    ...init,
  });
}
const press = (m: Mounted, x: number, y: number, init: PointerEventInit = {}) =>
  m.pages.dispatchEvent(pointer('pointerdown', x, y, init));
const release = (x: number, y: number) => document.dispatchEvent(pointer('pointerup', x, y));
const click = (m: Mounted, x: number, y: number, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    press(m, x, y);
    release(x, y);
  }
};

/** The control's first fragment box, in page-content coordinates. */
function box(m: Mounted, index = 0) {
  const c = m.surface.layout().contentControls?.[index];
  if (!c || c.fragments.length === 0) throw new Error('no control fragment');
  return c.fragments[0]!.box;
}
const middle = (m: Mounted) => {
  const b = box(m);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

describe('atomic navigation is opt-in', () => {
  test.each(['sdtContentLocked', 'contentLocked'])(
    'default: ArrowRight walks into %s content',
    (lock) => {
      const m = mount(line(lock), null);
      caretAt(m, 2);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([3, 3]);
      m.surface.destroy();
    }
  );

  test('default: a press inside the control places a plain caret there', () => {
    const m = mount(line('sdtContentLocked'), 'characters');
    const { x, y } = middle(m);
    click(m, x, y);
    const [anchor, head] = offsets(m);
    expect(anchor).toBe(head);
    expect(anchor).toBeGreaterThan(2);
    expect(anchor).toBeLessThan(7);
    m.surface.destroy();
  });
});

describe('arrows step over a locked inline control', () => {
  test.each(['sdtContentLocked', 'contentLocked'])(
    '→ from the left edge lands on the right edge (%s)',
    (lock) => {
      const m = mount(line(lock), 'atomic');
      caretAt(m, 2);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([7, 7]);
      m.surface.destroy();
    }
  );

  test('← from the right edge lands on the left edge', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 7);
    m.surface.navigate('left');
    expect(offsets(m)).toEqual([2, 2]);
    m.surface.destroy();
  });

  test('motion outside the control is untouched', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 0);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([1, 1]);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([2, 2]);
    caretAt(m, 7);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([8, 8]);
    m.surface.destroy();
  });

  test('a caret placed INSIDE by a host leaves in the direction of travel', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 4);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([7, 7]);
    caretAt(m, 4);
    m.surface.navigate('left');
    expect(offsets(m)).toEqual([2, 2]);
    m.surface.destroy();
  });

  test('Home and End are the line edges, not the control edges', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 4);
    m.surface.navigate('lineStart');
    expect(offsets(m)).toEqual([0, 0]);
    m.surface.navigate('lineEnd');
    expect(offsets(m)).toEqual([9, 9]);
    m.surface.destroy();
  });

  test('two controls in a row are two steps', () => {
    const m = mount(
      `<w:p>${control('One', 'sdtContentLocked', 1)}${control('Two', 'sdtContentLocked', 2)}</w:p>`,
      'atomic'
    );
    caretAt(m, 0);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([3, 3]);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([6, 6]);
    m.surface.navigate('left');
    expect(offsets(m)).toEqual([3, 3]);
    m.surface.destroy();
  });

  test('a control inside a table cell is a unit too', () => {
    const cell = `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${line('sdtContentLocked')}</w:tc>`;
    const m = mount(`<w:tbl><w:tr>${cell}</w:tr></w:tbl><w:p/>`, 'atomic');
    caretAt(m, 2);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([7, 7]);
    m.surface.destroy();
  });

  test('sdtLocked (content stays editable) is NOT a unit', () => {
    const m = mount(line('sdtLocked'), 'atomic');
    caretAt(m, 2);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([3, 3]);
    m.surface.destroy();
  });

  test('an unlocked control is NOT a unit', () => {
    const m = mount(line('none'), 'atomic');
    caretAt(m, 2);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([3, 3]);
    m.surface.destroy();
  });

  test('the real keymap routes the arrow through the same rule', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 2);
    m.pages.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );
    expect(offsets(m)).toEqual([7, 7]);
    m.surface.destroy();
  });
});

describe('Shift+arrows select a locked inline control whole', () => {
  test('Shift+→ from the left edge selects the whole control', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 2);
    m.surface.navigate('right', true);
    expect(offsets(m)).toEqual([2, 7]);
    m.surface.destroy();
  });

  test('Shift+← from the right edge selects the whole control', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 7);
    m.surface.navigate('left', true);
    expect(offsets(m)).toEqual([7, 2]);
    m.surface.destroy();
  });

  test('Shift in the opposite direction shrinks it back instead of sticking', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 2);
    m.surface.navigate('right', true);
    m.surface.navigate('left', true);
    expect(offsets(m)).toEqual([2, 2]);
    m.surface.destroy();
  });

  test('a range from outside that ends inside takes the control whole', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 1);
    m.surface.navigate('right', true); // 1 → 2: still outside
    expect(offsets(m)).toEqual([1, 2]);
    m.surface.navigate('right', true); // would land inside: crosses
    expect(offsets(m)).toEqual([1, 7]);
    m.surface.destroy();
  });

  test('the same keys without the option select one character at a time', () => {
    const m = mount(line('sdtContentLocked'), null);
    caretAt(m, 2);
    m.surface.navigate('right', true);
    expect(offsets(m)).toEqual([2, 3]);
    m.surface.destroy();
  });

  test('a collapsing arrow on the selected control goes to the edge it points at', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    caretAt(m, 2, 7);
    m.surface.navigate('left');
    expect(offsets(m)).toEqual([2, 2]);
    caretAt(m, 2, 7);
    m.surface.navigate('right');
    expect(offsets(m)).toEqual([7, 7]);
    m.surface.destroy();
  });
});

describe('pointer gestures on a locked inline control', () => {
  test('a press INSIDE selects the whole control', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    const { x, y } = middle(m);
    click(m, x, y);
    expect(offsets(m)).toEqual([2, 7]);
    m.surface.destroy();
  });

  test('a press on either EDGE still places a caret (that is where text is typed)', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    const b = box(m);
    const y = b.y + b.height / 2;
    click(m, b.x, y);
    expect(offsets(m)).toEqual([2, 2]);
    click(m, b.x + b.width, y);
    expect(offsets(m)).toEqual([7, 7]);
    m.surface.destroy();
  });

  test('a double click inside selects the whole control, not a word of it', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    const { x, y } = middle(m);
    click(m, x, y, 2);
    expect(offsets(m)).toEqual([2, 7]);
    m.surface.destroy();
  });

  test('a drag that ends inside takes the control whole', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    const { x, y } = middle(m);
    press(m, 0, y);
    document.dispatchEvent(pointer('pointermove', x, y));
    expect(offsets(m)).toEqual([0, 7]);
    release(x, y);
    m.surface.destroy();
  });

  test('shift-press inside extends over the whole control', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    const { x, y } = middle(m);
    click(m, 0, y);
    press(m, x, y, { shiftKey: true });
    expect(offsets(m)).toEqual([0, 7]);
    release(x, y);
    m.surface.destroy();
  });

  test('without the option a double click selects a word of the control text', () => {
    const m = mount(line('sdtContentLocked'), null);
    const { x, y } = middle(m);
    click(m, x, y, 2);
    const [anchor, head] = offsets(m);
    expect(Math.abs(head - anchor)).toBeGreaterThan(0);
    m.surface.destroy();
  });
});

describe('the write rules are untouched', () => {
  test('Backspace after the control and Delete before it still refuse', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    const before = m.surface.layout().contentControls?.length;
    caretAt(m, 7);
    m.surface.deleteBackward();
    caretAt(m, 2);
    m.surface.deleteForward();
    expect(m.surface.layout().contentControls?.length).toBe(before);
    expect(m.surface.session.paragraphIds().length).toBe(1);
    m.surface.destroy();
  });

  test('typing over the control a press selected is still refused', () => {
    const m = mount(line('sdtContentLocked'), 'atomic');
    const { x, y } = middle(m);
    click(m, x, y);
    expect(offsets(m)).toEqual([2, 7]);
    m.surface.type('x');
    expect(m.surface.state().lastRejection).not.toBeNull();
    expect(m.surface.session.bodyText()).toBe(`aa${TOKEN}zz`);
    m.surface.destroy();
  });
});

describe('createDocxEditor takes the option', () => {
  test.each([
    ['atomic', 7],
    ['characters', 3],
  ] as const)('lockedControlNavigation %s', (navigation, expected) => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: docx(line('sdtContentLocked')),
      lockedControlNavigation: navigation,
    });
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 2 },
    });
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(expected);
    editor.destroy();
    container.remove();
  });
});

describe('a double click selects a word up to an inline control edge', () => {
  for (const lock of ['none', 'sdtLocked', 'contentLocked']) {
    for (const [side, expected] of [
      ['after', [7, 9]],
      ['before', [0, 2]],
    ] as const) {
      test(`${lock}: the word ${side} the control`, () => {
        const m = mount(line(lock), null);
        const b = box(m);
        const x = side === 'after' ? b.x + b.width + 2 : 1;
        click(m, x, b.y + b.height / 2, 2);
        expect([...offsets(m)].sort((a, c) => a - c)).toEqual([...expected]);
      });
    }
    // One point either side of each edge: the clicked letter's word, never its neighbour's.
    for (const [where, dx, expected] of [
      ['just before the start edge', (b: { x: number }) => b.x - 1, [0, 2]],
      ['just after the start edge', (b: { x: number }) => b.x + 1, [2, 7]],
      ['just before the end edge', (b: { x: number; width: number }) => b.x + b.width - 1, [2, 7]],
      ['just after the end edge', (b: { x: number; width: number }) => b.x + b.width + 1, [7, 9]],
    ] as const) {
      test(`${lock}: a double click ${where}`, () => {
        const m = mount(line(lock), null);
        const b = box(m);
        click(m, dx(b), b.y + b.height / 2, 2);
        expect([...offsets(m)].sort((a, c) => a - c)).toEqual([...expected]);
      });
    }
  }

  test('atomic: just outside the edges selects the neighbour word, inside the control', () => {
    for (const [x, expected] of [
      [(b: { x: number }) => b.x - 1, [0, 2]],
      [(b: { x: number }) => b.x + 1, [2, 7]],
      [(b: { x: number; width: number }) => b.x + b.width + 1, [7, 9]],
    ] as const) {
      const m = mount(line('contentLocked'), 'atomic');
      const b = box(m);
      click(m, x(b), b.y + b.height / 2, 2);
      expect([...offsets(m)].sort((a, c) => a - c)).toEqual([...expected]);
    }
  });

  test('the painter word keeps control edges and drops tracked deletion edges', () => {
    const mark = 'w:author="A" w:date="2026-01-01T00:00:00Z"';
    const m = mount(
      `<w:p>${run('t')}<w:del w:id="1" ${mark}><w:r><w:delText>eh</w:delText></w:r></w:del>` +
        `${run('he')}${control(TOKEN, 'none')}</w:p>`,
      null
    );
    const layout = m.surface.layout();
    expect([...wordMotionBoundaries(layout, m.paragraphId)].sort((a, b) => a - b)).toEqual([
      1, 3, 5, 10,
    ]);
    expect([...inlineControlEdges(layout, m.paragraphId)].sort((a, b) => a - b)).toEqual([5, 10]);
  });

  test('an empty control inside a word never decides the side', () => {
    const m = mount(`<w:p>${run('ab')}${control('', 'none')}${run('cd')}</w:p>`, null);
    const at = { paragraphId: m.paragraphId, offset: 2 };
    expect(controlEdgeSide(m.surface.layout(), at, null)).toBe('after');
  });
});
