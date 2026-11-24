import { noticeFixture } from '../../layout/__tests__/note-continuation-fixture.ts';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  resolveFootnoteProperties,
  resolveEndnoteProperties,
} from '../../store/package/note-properties.ts';
import { layoutSemanticDocument, createFixedMeasurer } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function read(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function separatorLayout(separator: string | null) {
  const body = read(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const source = read(
    `<w:footnotes xmlns:w="${W}">${separator === null ? '' : `<w:footnote w:type="separator" w:id="-1">${separator}</w:footnote>`}<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Note</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    '/word/footnotes.xml'
  );
  const measurer = createFixedMeasurer(5, 12);
  const f = resolveFootnoteProperties(),
    e = resolveEndnoteProperties();
  return layoutSemanticDocument(body, 0, {
    measurer,
    notes: {
      footnotesPart: source,
      endnotesPart: null,
      footnotePropsBySection: [f],
      endnotePropsBySection: [e],
      documentFootnoteProps: f,
      documentEndnoteProps: e,
      measurer,
      producer: 'note-separator-paint',
    },
  });
}

test('mixed separator markers paint beside text on fresh and retained pages', () => {
  const layout = separatorLayout(
    '<w:p><w:r><w:t>Before</w:t><w:separator/><w:t>After</w:t><w:separator/></w:r></w:p>'
  );
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const sep = container.querySelector<HTMLElement>('[data-docx-note-separator]')!;
  expect(sep.textContent).toBe('BeforeAfter');
  const rules = [...sep.querySelectorAll<HTMLElement>('[data-docx-note-rule]')];
  expect(rules).toHaveLength(2);
  for (const rule of rules) {
    expect(rule.style.width).toBe('144px');
    expect((rule.firstElementChild as HTMLElement).style.height).toBe('0.5px');
    expect(rule.getAttribute('contenteditable')).toBe('false');
  }
  const before = sep.outerHTML;
  paintSemanticLayout(container, layout, { scale: 1 });
  expect(container.querySelector('[data-docx-note-separator]')!.outerHTML).toBe(before);
});

for (const separator of [
  '',
  '<w:p/>',
  '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:separator/></w:r></w:p>',
  null,
]) {
  test(`separator paint distinguishes missing and empty stories: ${separator}`, () => {
    const layout = separatorLayout(separator);
    const container = document.createElement('div');
    for (let pass = 0; pass < 2; pass++) {
      paintSemanticLayout(container, layout, { scale: 1 });
      expect(container.querySelectorAll('[data-docx-note-rule]')).toHaveLength(
        separator === null ? 1 : 0
      );
      expect(container.textContent).toContain('Note');
    }
  });
}

test('a continuation notice paints below the last note as noneditable furniture', () => {
  const source = noticeFixture('Continued');
  const layout = layoutSemanticDocument(source.document, 0, source.options);
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const notices = container.querySelectorAll<HTMLElement>(
    '[data-docx-note-separator="continuationNotice"]'
  );
  expect(notices).toHaveLength(1);
  const notice = notices[0]!;
  expect(notice.textContent).toBe('Continued');
  expect(notice.getAttribute('contenteditable')).toBe('false');
  expect(notice.closest('[data-docx-note-scope]')).toBeNull();
  const area = layout.pages[0]!.footnotes!;
  expect(Number.parseFloat(notice.style.top)).toBe(area.continuationNotice!.box.y - area.box.y);
  paintSemanticLayout(container, layout, { scale: 1 });
  expect(
    container.querySelectorAll('[data-docx-note-separator="continuationNotice"]')
  ).toHaveLength(1);
});
