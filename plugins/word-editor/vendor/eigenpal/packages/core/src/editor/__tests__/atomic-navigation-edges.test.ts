// `lockedControlNavigation: 'atomic'` edge cases: right-to-left text, nesting, wrapping, line
// and vertical motions, word motions, empty controls, paragraph edges, the documented scope
// (programmatic selection is untouched), and a header story. Footnotes and text boxes publish
// no content-control boundary records, so the rule has nothing to read there (not covered).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { LockedControlNavigation } from '../paginated-surface-options.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAIN_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

interface Parts {
  readonly body: string;
  /** `w:hdr` children; the body's section references it as the default header. */
  readonly header?: string;
}

function docx({ body, header }: Parts): Uint8Array {
  const overrides = [
    `<Override PartName="/word/document.xml" ContentType="${MAIN_CT}.document.main+xml"/>`,
    `<Override PartName="/word/styles.xml" ContentType="${MAIN_CT}.styles+xml"/>`,
    header ? `<Override PartName="/word/header1.xml" ContentType="${MAIN_CT}.header+xml"/>` : '',
  ].join('');
  const rels = [
    `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>`,
    header ? `<Relationship Id="rHdr" Type="${R}/header" Target="header1.xml"/>` : '',
  ].join('');
  const sectPr = header
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/></w:sectPr>'
    : '';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${sectPr}</w:body></w:document>`
    ),
  };
  if (header) files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`);
  return zipSync(files);
}

const run = (text: string, rPr = '') =>
  `<w:r><w:rPr>${rPr}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const control = (content: string, lock: string, n = 1) =>
  `<w:sdt><w:sdtPr><w:alias w:val="T${n}"/><w:tag w:val="dtpl:v2:00000000-0000-4000-8000-00000000000${n}"/>` +
  `${lock === 'none' ? '' : `<w:lock w:val="${lock}"/>`}<w:text/></w:sdtPr>` +
  `<w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const locked = (text: string, n = 1) => control(run(text), 'sdtContentLocked', n);

/** "aa" [2,7) "Token" "zz": the control covers offsets 2..7. */
const line = (lock = 'sdtContentLocked') =>
  `<w:p>${run('aa')}${control(run('Token'), lock)}${run('zz')}</w:p>`;

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
  readonly paragraphId: string;
}

function mount(parts: Parts | string, navigation: LockedControlNavigation | null): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(
    container,
    docx(typeof parts === 'string' ? { body: parts } : parts),
    { scale: 1, ...(navigation ? { lockedControlNavigation: navigation } : {}) }
  );
  if (!result.ok) {
    container.remove();
    throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  }
  return {
    surface: result.surface,
    container,
    paragraphId: result.surface.session.paragraphIds()[0]!,
  };
}

function done(m: Mounted): void {
  m.surface.destroy();
  m.container.remove();
  document.getSelection()?.removeAllRanges();
}

/** Mount, run `body`, and always unmount — an assertion failure must not leak the container. */
function withMounted(
  parts: Parts | string,
  navigation: LockedControlNavigation | null,
  body: (m: Mounted) => void
): void {
  const m = mount(parts, navigation);
  try {
    body(m);
  } finally {
    done(m);
  }
}

const caretAt = (m: Mounted, offset: number, paragraphId = m.paragraphId) =>
  m.surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
const head = (m: Mounted) => m.surface.state().selection.head;
const offsets = (m: Mounted): [number, number] => {
  const { anchor, head } = m.surface.state().selection;
  return [anchor.offset, head.offset];
};
const strictlyInside = (offset: number, from: number, to: number) => offset > from && offset < to;

describe('right-to-left paragraphs', () => {
  const RTL_TEXTS = [
    [
      'bidi paragraph, Latin runs',
      `<w:p><w:pPr><w:bidi/></w:pPr>${run('aa')}${locked('Token')}${run('zz')}</w:p>`,
    ],
    [
      'bidi paragraph, w:rtl Hebrew runs',
      `<w:p><w:pPr><w:bidi/></w:pPr>${run('אב', '<w:rtl/>')}` +
        `${control(run('שלום', '<w:rtl/>'), 'sdtContentLocked')}${run('גד', '<w:rtl/>')}</w:p>`,
    ],
  ] as const;

  test.each(RTL_TEXTS)(
    '%s: each arrow crosses the control in one press and moves on',
    (_, body) => {
      withMounted(body, 'atomic', (m) => {
        const range = m.surface.layout().contentControls![0]!.range!;
        const { start, end } = range;
        for (const command of ['right', 'left'] as const) {
          for (const from of [start, end]) {
            caretAt(m, from);
            m.surface.navigate(command);
            const first = head(m).offset;
            expect(strictlyInside(first, start, end)).toBe(false);
            // When the press entered the control, it crossed it whole.
            if (first !== from - 1 && first !== from + 1)
              expect(first).toBe(from === start ? end : start);
            m.surface.navigate(command);
            const second = head(m);
            expect(strictlyInside(second.offset, start, end)).toBe(false);
            // Never stuck: the second press moves on (unless the first reached a paragraph edge).
            const atParagraphEdge = first === 0 || first === m.surface.session.bodyText().length;
            if (!atParagraphEdge) expect(second.offset).not.toBe(first);
          }
        }
      });
    }
  );

  test('bidi paragraph: ArrowRight then ArrowLeft returns to the start edge', () => {
    const body = `<w:p><w:pPr><w:bidi/></w:pPr>${run('aa')}${locked('Token')}${run('zz')}</w:p>`;
    withMounted(body, 'atomic', (m) => {
      caretAt(m, 2);
      m.surface.navigate('right');
      const crossed = head(m).offset;
      expect([1, 7]).toContain(crossed);
      m.surface.navigate('left');
      expect(head(m).offset).toBe(2);
    });
  });
});

describe('nested locked controls', () => {
  // "aa" | outer [2, 13): "pre" inner [5, 10) "Inner" "post" ... | "zz"
  const nested =
    `<w:p>${run('aa')}` +
    control(`${run('pre')}${locked('Inner', 2)}${run('pst')}`, 'sdtContentLocked', 1) +
    `${run('zz')}</w:p>`;

  test('one ArrowRight from the outer leading edge lands on the OUTER trailing edge', () => {
    withMounted(nested, 'atomic', (m) => {
      caretAt(m, 2);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([13, 13]);
    });
  });

  test('one ArrowLeft from the outer trailing edge lands on the outer leading edge', () => {
    withMounted(nested, 'atomic', (m) => {
      caretAt(m, 13);
      m.surface.navigate('left');
      expect(offsets(m)).toEqual([2, 2]);
    });
  });

  test('an unlocked outer around a locked inner: only the inner is a unit', () => {
    const body =
      `<w:p>${run('aa')}` +
      control(`${run('pre')}${locked('Inner', 2)}${run('pst')}`, 'none', 1) +
      `${run('zz')}</w:p>`;
    withMounted(body, 'atomic', (m) => {
      caretAt(m, 2);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([3, 3]);
      caretAt(m, 5);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([10, 10]);
    });
  });
});

// 4000 twips wide with 720 margins: 2560 twips (128pt) of text per line.
const NARROW =
  '<w:sectPr><w:pgSz w:w="4000" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const LONG = 'alpha beta gamma delta epsilon zeta eta theta';

describe('a control that wraps to more lines', () => {
  const body = `<w:p>${run('aa ')}${locked(LONG)}${run(' zz')}</w:p>${NARROW}`;
  const start = 3;
  const end = 3 + LONG.length;

  test('the control really wraps', () => {
    withMounted(body, 'atomic', (m) => {
      const fragments = m.surface.layout().contentControls![0]!.fragments;
      const lines = new Set(fragments.map((f) => Math.round(f.box.y)));
      expect(lines.size).toBeGreaterThan(1);
    });
  });

  test('ArrowRight from the leading edge lands on the trailing edge, and back', () => {
    withMounted(body, 'atomic', (m) => {
      caretAt(m, start);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([end, end]);
      m.surface.navigate('left');
      expect(offsets(m)).toEqual([start, start]);
    });
  });

  test('Home from after the control ends on a control edge, not inside', () => {
    withMounted(body, 'characters', (probe) => {
      caretAt(probe, end + 3);
      probe.surface.navigate('lineStart');
      // Precondition: without the option, the line start falls inside the control.
      expect(strictlyInside(head(probe).offset, start, end)).toBe(true);
    });
    withMounted(body, 'atomic', (m) => {
      caretAt(m, end + 3);
      m.surface.navigate('lineStart');
      expect(offsets(m)).toEqual([start, start]);
    });
  });

  test('End from before the control ends on a control edge, not inside', () => {
    withMounted(body, 'characters', (probe) => {
      caretAt(probe, 0);
      probe.surface.navigate('lineEnd');
      expect(strictlyInside(head(probe).offset, start, end)).toBe(true);
    });
    withMounted(body, 'atomic', (m) => {
      caretAt(m, 0);
      m.surface.navigate('lineEnd');
      expect(offsets(m)).toEqual([end, end]);
    });
  });

  // A nearer-edge rule hands a Down that lands in the first half of the control back to the
  // leading edge, on the line it started from, so the caret never gets past the control.
  test('Down and Up pass the control instead of stopping on its edge', () => {
    const below = `<w:p>${run('a'.repeat(12) + ' ')}${locked(LONG)}${run(' zz')}</w:p><w:p>${run('next')}</w:p>${NARROW}`;
    withMounted(below, 'atomic', (m) => {
      const ids = m.surface.session.paragraphIds();
      caretAt(m, 0);
      for (let press = 0; press < 8 && head(m).paragraphId === ids[0]; press += 1) {
        m.surface.navigate('down');
      }
      expect(head(m).paragraphId).toBe(ids[1]!);
      const atStart = () => head(m).paragraphId === ids[0] && head(m).offset === 0;
      for (let press = 0; press < 8 && !atStart(); press += 1) {
        m.surface.navigate('up');
      }
      expect(head(m)).toEqual({ paragraphId: ids[0]!, offset: 0 });
    });
  });
});

describe('Up and Down take the nearer edge', () => {
  // Paragraph 2 is "b" + [1, 31) control + "c"; paragraph 1 and 3 are plain lines above/below.
  const CONTROL = 'TOKENTOKENTOKENTOKENTOKENTOKEN';
  const body =
    `<w:p>${run('x'.repeat(40))}</w:p>` +
    `<w:p>${run('b')}${locked(CONTROL)}${run('c')}</w:p>` +
    `<w:p>${run('y'.repeat(40))}</w:p>`;
  const from = 1;
  const to = 1 + CONTROL.length;

  test.each([
    ['down', 0, 5],
    ['down', 0, 28],
    ['up', 2, 5],
    ['up', 2, 28],
  ] as const)('%s from paragraph %i offset %i', (command, sourceIndex, offset) => {
    let landed = -1;
    withMounted(body, 'characters', (probe) => {
      const ids = probe.surface.session.paragraphIds();
      caretAt(probe, offset, ids[sourceIndex]);
      probe.surface.navigate(command);
      expect(head(probe).paragraphId).toBe(ids[1]!);
      landed = head(probe).offset;
      // Precondition: without the option, the vertical motion lands inside the control.
      expect(strictlyInside(landed, from, to)).toBe(true);
    });
    const nearer = landed < (from + to) / 2 ? from : to;
    withMounted(body, 'atomic', (m) => {
      const ids = m.surface.session.paragraphIds();
      caretAt(m, offset, ids[sourceIndex]);
      m.surface.navigate(command);
      expect(head(m)).toEqual({ paragraphId: ids[1]!, offset: nearer });
    });
  });
});

describe('word motions over a control with no spaces around it', () => {
  // "aaTOKENzz": the control covers [2, 7).
  const body = `<w:p>${run('aa')}${locked('TOKEN')}${run('zz')}</w:p>`;

  test('wordRight and wordLeft never stop inside the control', () => {
    withMounted(body, 'atomic', (m) => {
      for (const start of [0, 1, 2]) {
        caretAt(m, start);
        m.surface.navigate('wordRight');
        const landed = head(m).offset;
        expect(strictlyInside(landed, 2, 7)).toBe(false);
        expect(landed).toBeGreaterThan(start);
      }
      for (const start of [9, 8, 7]) {
        caretAt(m, start);
        m.surface.navigate('wordLeft');
        const landed = head(m).offset;
        expect(strictlyInside(landed, 2, 7)).toBe(false);
        expect(landed).toBeLessThan(start);
      }
    });
  });

  test('wordRight from the leading edge crosses the control; wordLeft from the trailing edge crosses back', () => {
    withMounted(body, 'atomic', (m) => {
      caretAt(m, 2);
      m.surface.navigate('wordRight');
      expect(head(m).offset).toBeGreaterThanOrEqual(7);
      caretAt(m, 7);
      m.surface.navigate('wordLeft');
      expect(head(m).offset).toBeLessThanOrEqual(2);
    });
  });
});

describe('empty controls and paragraph edges', () => {
  test('an empty locked control shows a prompt; atomic arrows move exactly like the default', () => {
    // An empty `w:sdtContent` is painted as a placeholder prompt, which has its own (older)
    // one-unit rule; the locked rule must not change it.
    const body = `<w:p>${run('aa')}${control('', 'sdtContentLocked')}${run('zz')}</w:p>`;
    const trailOf = (navigation: LockedControlNavigation) => {
      const trail: number[][] = [];
      withMounted(body, navigation, (m) => {
        const record = m.surface.layout().contentControls![0]!;
        expect(record.placeholder).toBe(true);
        caretAt(m, 0);
        for (let i = 0; i < 6; i += 1) {
          m.surface.navigate('right');
          trail.push(offsets(m));
        }
        for (let i = 0; i < 6; i += 1) {
          m.surface.navigate('left');
          trail.push(offsets(m));
        }
      });
      return trail;
    };
    expect(trailOf('atomic')).toEqual(trailOf('characters'));
  });

  test('an empty locked control with an empty run is no stop either', () => {
    const body = `<w:p>${run('aa')}${control(run(''), 'sdtContentLocked')}${run('zz')}</w:p>`;
    withMounted(body, 'atomic', (m) => {
      caretAt(m, 2);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([3, 3]);
      m.surface.navigate('left');
      m.surface.navigate('left');
      expect(offsets(m)).toEqual([1, 1]);
    });
  });

  test('a control at paragraph start: → from 0 crosses, ← from its end returns to 0', () => {
    const body = `<w:p>${locked('Token')}${run('zz')}</w:p>`;
    withMounted(body, 'atomic', (m) => {
      caretAt(m, 0);
      m.surface.navigate('right');
      expect(offsets(m)).toEqual([5, 5]);
      m.surface.navigate('left');
      expect(offsets(m)).toEqual([0, 0]);
    });
  });

  test('a control at paragraph end: → crosses to the end, then on to the next paragraph', () => {
    const body = `<w:p>${run('aa')}${locked('Token')}</w:p><w:p>${run('next')}</w:p>`;
    withMounted(body, 'atomic', (m) => {
      const ids = m.surface.session.paragraphIds();
      caretAt(m, 2);
      m.surface.navigate('right');
      expect(head(m)).toEqual({ paragraphId: ids[0]!, offset: 7 });
      m.surface.navigate('right');
      expect(head(m).paragraphId).toBe(ids[1]!);
      m.surface.navigate('left');
      expect(head(m)).toEqual({ paragraphId: ids[0]!, offset: 7 });
      m.surface.navigate('left');
      expect(head(m)).toEqual({ paragraphId: ids[0]!, offset: 2 });
    });
  });

  test('← from the next paragraph start lands on the trailing edge, not inside', () => {
    const body = `<w:p>${run('aa')}${locked('Token')}</w:p><w:p>${run('next')}</w:p>`;
    withMounted(body, 'atomic', (m) => {
      const ids = m.surface.session.paragraphIds();
      caretAt(m, 0, ids[1]);
      m.surface.navigate('left');
      expect(head(m)).toEqual({ paragraphId: ids[0]!, offset: 7 });
    });
  });
});

describe('documented scope', () => {
  test('programmatic setSelection inside the control is NOT moved', () => {
    withMounted(line(), 'atomic', (m) => {
      caretAt(m, 4);
      expect(offsets(m)).toEqual([4, 4]);
      m.surface.setSelection({
        anchor: { paragraphId: m.paragraphId, offset: 3 },
        head: { paragraphId: m.paragraphId, offset: 5 },
      });
      expect(offsets(m)).toEqual([3, 5]);
    });
  });

  test("'characters' behaves like the default", () => {
    const trailOf = (navigation: LockedControlNavigation | null) => {
      const trail: number[] = [];
      withMounted(line(), navigation, (m) => {
        caretAt(m, 0);
        for (let i = 0; i < 9; i += 1) {
          m.surface.navigate('right');
          trail.push(head(m).offset);
        }
        m.surface.navigate('left', true);
        trail.push(...offsets(m));
      });
      return trail;
    };
    const characters = trailOf('characters');
    expect(characters).toEqual(trailOf(null));
    expect(characters.slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('other stories', () => {
  test('header: an inline locked control carries a range and ArrowRight crosses it', () => {
    withMounted({ body: `<w:p>${run('body')}</w:p>`, header: line() }, 'atomic', (m) => {
      expect(m.surface.enterHeaderFooter({ rId: 'rHdr' })).toBe(true);
      const [paragraphId] = m.surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rHdr' });
      const record = m.surface
        .layout()
        .contentControls!.find((c) => c.range?.paragraphId === paragraphId);
      expect(record?.range).toEqual({ paragraphId: paragraphId!, start: 2, end: 7 });
      caretAt(m, 2, paragraphId);
      m.surface.navigate('right');
      expect(head(m)).toEqual({ paragraphId: paragraphId!, offset: 7 });
      m.surface.navigate('left');
      expect(head(m)).toEqual({ paragraphId: paragraphId!, offset: 2 });
    });
  });
});
