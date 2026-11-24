import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

type Navigation = 'normal' | 'atomic';
type Place = { rtl?: boolean; header?: boolean };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function source(lock: string, { rtl, header }: Place): Uint8Array {
  const run = (text: string) =>
    `<w:r>${rtl ? '<w:rPr><w:rtl/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>`;
  const paragraph = `<w:p>${rtl ? '<w:pPr><w:bidi/></w:pPr>' : ''}${run(rtl ? 'אב' : 'aa')}<w:sdt><w:sdtPr>${lock === 'none' ? '' : `<w:lock w:val="${lock}"/>`}<w:text/></w:sdtPr><w:sdtContent>${run(rtl ? 'שלום' : 'TOKEN')}</w:sdtContent></w:sdt>${run(rtl ? 'גד' : 'zz')}</w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (header
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${header ? '<w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rHdr"/></w:sectPr>' : paragraph}</w:body></w:document>`
    ),
    ...(header
      ? {
          'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${paragraph}</w:hdr>`),
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rHdr" Type="${R}/header" Target="header1.xml"/></Relationships>`
          ),
        }
      : {}),
  });
}
function withSurface(
  lock: string,
  navigation: Navigation,
  check: (surface: PaginatedSurface, paragraphId: string, container: HTMLElement) => void,
  place: Place = {}
) {
  const container = document.createElement('div');
  document.body.append(container);
  const mounted = mountPaginatedSurface(container, source(lock, place), {
    scale: 1,
    ...(navigation === 'atomic' ? { lockedControlNavigation: 'atomic' as const } : {}),
  });
  if (!mounted.ok) {
    container.remove();
    throw Error(mounted.reason);
  }
  try {
    const surface = mounted.surface;
    if (place.header) expect(surface.enterHeaderFooter({ rId: 'rHdr' })).toBe(true);
    const paragraphId = place.header
      ? surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rHdr' })[0]!
      : surface.session.paragraphIds()[0]!;
    check(surface, paragraphId, container);
  } finally {
    mounted.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}
const caret = (surface: PaginatedSurface, paragraphId: string, offset: number) =>
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });

for (const navigation of ['normal', 'atomic'] as const) {
  for (const lock of ['contentLocked', 'sdtContentLocked']) {
    for (const extend of [false, true]) {
      for (const [command, start, expected] of [
        ['wordRight', 0, 2],
        ['wordLeft', 9, 7],
      ] as const) {
        test(`${navigation} ${lock} ${command} stops at the control edge (extend=${extend})`, () => {
          withSurface(lock, navigation, (surface, paragraphId) => {
            caret(surface, paragraphId, start);
            surface.navigate(command, extend);
            expect(surface.state().selection.head.offset).toBe(expected);
            expect(surface.state().selection.anchor.offset).toBe(extend ? start : expected);
            expect(surface.session.bodyText()).toBe('aaTOKENzz');
          });
        });
      }
    }
    test(`${navigation} ${lock} repeated word motions cross both edges`, () => {
      withSurface(lock, navigation, (surface, paragraphId) => {
        caret(surface, paragraphId, 0);
        for (const expected of [2, 7, 9]) {
          surface.navigate('wordRight');
          expect(surface.state().selection.head.offset).toBe(expected);
        }
        for (const expected of [7, 2, 0]) {
          surface.navigate('wordLeft');
          expect(surface.state().selection.head.offset).toBe(expected);
        }
        caret(surface, paragraphId, 2);
        surface.navigate('right');
        expect(surface.state().selection.head.offset).toBe(navigation === 'atomic' ? 7 : 3);
      });
    });
  }
  for (const lock of ['none', 'sdtLocked']) {
    test(`${navigation} ${lock} stops word motions at both edges of an editable control`, () => {
      withSurface(lock, navigation, (surface, paragraphId) => {
        caret(surface, paragraphId, 0);
        for (const expected of [2, 7, 9]) {
          surface.navigate('wordRight');
          expect(surface.state().selection.head.offset).toBe(expected);
        }
        for (const expected of [7, 2, 0]) {
          surface.navigate('wordLeft');
          expect(surface.state().selection.head.offset).toBe(expected);
        }
      });
    });
  }
  for (const lock of ['none', 'sdtLocked', 'contentLocked', 'sdtContentLocked']) {
    test(`${navigation} ${lock} word deletion stops at the control edge`, () => {
      withSurface(lock, navigation, (surface, paragraphId) => {
        caret(surface, paragraphId, 9);
        surface.deleteWordBackward();
        expect(surface.session.bodyText()).toBe('aaTOKEN');
        caret(surface, paragraphId, 0);
        surface.deleteWordForward();
        expect(surface.session.bodyText()).toBe('TOKEN');
        surface.undo();
        surface.undo();
        expect(surface.session.bodyText()).toBe('aaTOKENzz');
      });
    });
  }
  for (const lock of ['contentLocked', 'sdtContentLocked']) {
    test(`${navigation} ${lock} word deletion into the control deletes nothing`, () => {
      withSurface(lock, navigation, (surface, paragraphId) => {
        caret(surface, paragraphId, 7);
        surface.deleteWordBackward();
        caret(surface, paragraphId, 2);
        surface.deleteWordForward();
        expect(surface.session.bodyText()).toBe('aaTOKENzz');
      });
    });
  }
  test(`${navigation} word motions follow RTL physical direction at control edges`, () => {
    withSurface(
      'sdtContentLocked',
      navigation,
      (surface, paragraphId) => {
        caret(surface, paragraphId, 8);
        for (const expected of [6, 2, 0]) {
          surface.navigate('wordRight');
          expect(surface.state().selection.head.offset).toBe(expected);
        }
        for (const expected of [2, 6, 8]) {
          surface.navigate('wordLeft');
          expect(surface.state().selection.head.offset).toBe(expected);
        }
      },
      { rtl: true }
    );
  });
  test(`${navigation} a header control uses its own word boundaries`, () => {
    withSurface(
      'sdtContentLocked',
      navigation,
      (surface, paragraphId) => {
        caret(surface, paragraphId, 0);
        for (const expected of [2, 7, 9]) {
          surface.navigate('wordRight');
          expect(surface.state().selection.head.offset).toBe(expected);
        }
        expect(surface.session.bodyText()).toBe('body');
      },
      { header: true }
    );
  });
  for (const modifier of ['altKey', 'ctrlKey']) {
    test(`${navigation} ${modifier}+ArrowRight reaches the edge through the input handler`, () => {
      withSurface('sdtContentLocked', navigation, (surface, paragraphId, container) => {
        caret(surface, paragraphId, 0);
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowRight',
          [modifier]: true,
        });
        container.querySelector('.docx-pages')!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(surface.state().selection.head.offset).toBe(2);
      });
    });
  }
}
