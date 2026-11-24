import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  collectReviewItems,
  readOoxmlPackage,
  revisionItemsOf,
  serializeOoxmlPart,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../../store/index.ts';
import {
  structuralWordCases,
  structuralWordXmlParts,
  type StructuralWordCase,
} from '../../store/__tests__/fixtures/structural-word-cases.ts';

function mount(cases: readonly StructuralWordCase[]) {
  const container = document.createElement('div');
  document.body.append(container);
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(structuralWordXmlParts(cases)).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
  const editor = createDocxEditor({
    container,
    document: bytes,
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: () => [],
        },
      },
    ],
  });
  return {
    editor,
    session: editor.surface!.session,
    cleanup() {
      editor.destroy();
      container.remove();
    },
  };
}
const snapshot = (pkg: OoxmlPackage) =>
  Object.fromEntries([...pkg.parts].map(([name, part]) => [name, serializeOoxmlPart(part)]));
const remaining = (pkg: OoxmlPackage) =>
  [...pkg.parts.values()].flatMap((part) => revisionItemsOf(part)).length;
function content(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagName('w:t')].map((n) => n.textContent).join('');
}
for (const action of ['accept', 'reject'] as const) {
  for (const fixture of structuralWordCases) {
    test(`${action}: structural matrix ${fixture.name}, package round trip and atomic undo`, () => {
      const { editor, session, cleanup } = mount([fixture]);
      try {
        const before = snapshot(session.currentPackage());
        const result = editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' });
        expect(result.ok).toBe(true);
        const unsupported = 0;
        expect(remaining(session.currentPackage())).toBe(unsupported);
        const after = snapshot(session.currentPackage());
        const main = after[session.currentPackage().mainDocumentPart]!;
        const text = content(main);
        const kind = fixture.name.endsWith('-ins') ? 'ins' : 'del';
        const retain = (action === 'accept') === (kind === 'ins');
        const doc = new DOMParser().parseFromString(main, 'application/xml');
        const paragraphs = [...doc.getElementsByTagName('w:p')].map((p) =>
          [...p.getElementsByTagName('w:t')].map((t) => t.textContent).join('')
        );
        if (
          /^paragraph-(ins|del)$/.test(fixture.name) ||
          /^paragraph-properties-/.test(fixture.name) ||
          /^paragraph-in-cell-/.test(fixture.name)
        ) {
          expect(paragraphs.includes('FirstSecond')).toBe(!retain);
          expect(paragraphs.includes('First')).toBe(retain);
          expect(paragraphs.includes('Second')).toBe(retain);
        }
        if (/^consecutive-paragraph-/.test(fixture.name)) {
          expect(paragraphs.includes('OneTwoThree')).toBe(!retain);
          expect(paragraphs.includes('One')).toBe(retain);
        }
        if (/^paragraph-before-table-/.test(fixture.name)) {
          expect(paragraphs).toContain(retain ? 'Before' : 'BeforeLeft');
          expect(paragraphs.includes('Before')).toBe(retain);
          expect(paragraphs).toContain('After');
          expect(doc.getElementsByTagName('w:tbl')).toHaveLength(1);
        }
        if (/^section-break-/.test(fixture.name)) {
          expect(text).toContain('Before section');
          expect(text).toContain('After section');
        }
        const firstAttribute = (tag: string, attribute: string) =>
          doc.getElementsByTagName(`w:${tag}`)[0]?.getAttribute(`w:${attribute}`);
        if (fixture.name === 'paragraph-format') {
          expect(firstAttribute('jc', 'val')).toBe(action === 'accept' ? 'right' : 'center');
          expect(firstAttribute('spacing', 'after')).toBe(action === 'accept' ? '120' : '300');
        }
        if (fixture.name === 'run-format') {
          expect(firstAttribute('color', 'val')).toBe(action === 'accept' ? 'CC0000' : '0000CC');
          expect(firstAttribute('sz', 'val')).toBe(action === 'accept' ? '32' : '24');
        }
        if (fixture.name === 'row-properties') {
          expect(firstAttribute('trHeight', 'val')).toBe(action === 'accept' ? '720' : '360');
          expect(firstAttribute('trHeight', 'hRule')).toBe(
            action === 'accept' ? 'atLeast' : 'exact'
          );
        }
        if (fixture.name === 'cell-properties') {
          expect(firstAttribute('shd', 'fill')).toBe(action === 'accept' ? 'FFFF00' : '00FFFF');
          expect(firstAttribute('vAlign', 'val')).toBe(action === 'accept' ? 'bottom' : 'center');
        }
        if (fixture.name === 'table-properties')
          expect(firstAttribute('jc', 'val')).toBe(action === 'accept' ? 'right' : 'center');
        if (/^(inline-field|hyperlink|bookmarked-text|sdt-contained)-/.test(fixture.name)) {
          const token = fixture.name.startsWith('inline-field')
            ? 'Field value'
            : fixture.name.startsWith('hyperlink')
              ? 'Link text'
              : fixture.name.startsWith('bookmarked')
                ? 'Bookmarked'
                : 'Controlled';
          expect(text.includes(token)).toBe(retain);
        }
        if (/^nested-table-/.test(fixture.name)) {
          expect(text.includes('Nested')).toBe(retain);
          expect(text).toContain('Outside');
          expect(text).toContain('Tail');
        }
        if (/^row-span-/.test(fixture.name)) {
          expect(text.includes('Spanning')).toBe(retain);
          expect(text).toContain('LeftRight');
        }
        if (/^tracked-content-in-row-/.test(fixture.name)) {
          expect(text.includes('Inserted')).toBe(retain && action === 'accept');
          expect(text.includes('Deleted')).toBe(retain && action === 'reject');
          expect(text).toContain('BaselineBaseline2');
        }
        if (/^note-reference-/.test(fixture.name)) {
          const id = kind === 'ins' ? 2 : 3;
          expect(content(after['/word/footnotes.xml']!).includes(`Note ${id}`)).toBe(retain);
          expect(content(after['/word/footnotes.xml']!)).toContain(`Note ${id === 2 ? 3 : 2}`);
        }
        if (fixture.name === 'paired-move') expect(text.match(/Moved/g)).toHaveLength(1);
        const reread = readOoxmlPackage(writeOoxmlPackage(session.currentPackage()));
        expect(reread.ok).toBe(true);
        if (!reread.ok) throw Error(reread.reason);
        expect(remaining(reread.package)).toBe(unsupported);
        expect(
          content(serializeOoxmlPart(reread.package.parts.get(reread.package.mainDocumentPart)!))
        ).toBe(text);
        // A repeated bulk action must not consume retained/unsupported state or add history.
        editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' });
        expect(snapshot(session.currentPackage())).toEqual(after);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          session.undo();
          expect(snapshot(session.currentPackage())).toEqual(before);
          session.redo();
          expect(snapshot(session.currentPackage())).toEqual(after);
        }
      } finally {
        cleanup();
      }
    });
  }
  test(`${action}: all structural cases resolve together as one package history entry`, () => {
    const { editor, session, cleanup } = mount(structuralWordCases);
    try {
      const before = snapshot(session.currentPackage());
      expect(editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' }).ok).toBe(
        true
      );
      expect(remaining(session.currentPackage())).toBe(0);
      const after = snapshot(session.currentPackage());
      session.undo();
      expect(snapshot(session.currentPackage())).toEqual(before);
      session.redo();
      expect(snapshot(session.currentPackage())).toEqual(after);
    } finally {
      cleanup();
    }
  });
}
