// A rich paste in suggesting mode is ONE proposed insertion that keeps its formatting.
//
// The expected shape is what a desktop word processor writes when it pastes with tracking on:
// every run, paragraph mark and table row carries the pasting author's `w:ins`; insertions
// the source proposed are absorbed; deletions it proposed stay, nested inside the insertion.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { revisionItemsOf, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, putCaret } from './paginated-surface-fixtures.ts';

const WORD_HTML = readFileSync(
  new URL('./fixtures/word-mac-tracked-changes.html', import.meta.url),
  'utf8'
);

function mountSuggesting(body: string, author = 'Grace Hopper'): PaginatedSurface {
  const opened = mountPaginatedSurface(document.createElement('div'), docx(body), { author });
  if (!opened.ok) throw new Error(opened.reason);
  opened.surface.setEditingMode('suggest');
  return opened.surface;
}

const xmlOf = (surface: PaginatedSurface) =>
  serializeOoxmlPart(surface.session.part())
    .replace(/ w14:(?:paraId|textId)="[^"]*"/g, '')
    .replace(/ w:id="\d+"/g, '')
    .replace(/ w:date="[^"]*"/g, '');

const GRACE = 'w:author="Grace Hopper"';

describe('rich paste in suggesting mode', () => {
  test('Word HTML lands as one insertion that keeps the other authors deletions', () => {
    const surface = mountSuggesting('<w:p><w:r><w:t>host</w:t></w:r></w:p>');
    putCaret(surface, 4);
    surface.pasteRich('fallback', WORD_HTML);
    const xml = xmlOf(surface);
    // The other author's deletion stays, inside the pasting author's insertion.
    expect(xml).toMatch(
      new RegExp(
        `<w:ins ${GRACE}>(?:(?!</w:ins>).)*<w:del w:author="Ann Author">` +
          '<w:r>(?:<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>)?<w:delText xml:space="preserve">test </w:delText>'
      )
    );
    // Their insertions are absorbed: no other author proposes an insertion.
    expect(xml).not.toMatch(/<w:ins w:author="(?:Ann Author|Bob[^"]*)"/);
    // Every pasted paragraph mark and table row is part of the proposal.
    expect(xml).toMatch(new RegExp(`<w:trPr><w:ins ${GRACE}/>`));
    expect(xml).toMatch(new RegExp(`<w:trPr><w:ins ${GRACE}/><w:del w:author="Ann Author"/>`));
    expect(xml).toMatch(new RegExp(`<w:rPr><w:ins ${GRACE}/><w:del w:author="Ann Author"/>`));
    // Formatting travels: bold, alignment, and the formatting history.
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:rPrChange ');
    // The struck words inside the proposal keep a card of their own, by their author.
    const items = revisionItemsOf(surface.session.part());
    expect(
      items.some((item) => item.revisionKind === 'delete' && item.author === "Bob O'Brien & Co")
    ).toBe(true);
    // Rejecting every proposal gives the host paragraph back.
    surface.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(surface.session.bodyText()).toBe('host');
  });

  test('a fragment copied from the editor keeps its formatting as a proposal', () => {
    const source = mountPaginatedSurface(
      document.createElement('div'),
      docx(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>' +
          '<w:del w:id="3" w:author="Ann Author"><w:r><w:delText xml:space="preserve"> old</w:delText></w:r></w:del></w:p>' +
          '<w:p><w:r><w:t>second</w:t></w:r></w:p>'
      ),
      { scale: 1 }
    );
    if (!source.ok) throw new Error(source.reason);
    putCaret(source.surface, 0);
    source.surface.selectAll();
    const flavours = source.surface.copyFlavours();

    const target = mountSuggesting('<w:p><w:r><w:t>host</w:t></w:r></w:p>');
    putCaret(target, 4);
    target.pasteRich(flavours.text, flavours.html);
    const xml = xmlOf(target);
    expect(xml).toMatch(
      new RegExp(`<w:ins ${GRACE}><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>`)
    );
    expect(xml).toContain('<w:del w:author="Ann Author"><w:r><w:delText xml:space="preserve"> old');
    const items = revisionItemsOf(target.session.part());
    expect(items.some((item) => item.author === 'Grace Hopper')).toBe(true);
    target.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(target.session.bodyText()).toBe('host');
  });

  test('pasting over a selection strikes it and lands the proposal after it', () => {
    const surface = mountSuggesting('<w:p><w:r><w:t>keep gone keep</w:t></w:r></w:p>');
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 9 },
    });
    surface.pasteRich('new', '<p><b>new</b></p>');
    const xml = xmlOf(surface);
    expect(xml).toMatch(
      new RegExp(
        `<w:del ${GRACE}><w:r><w:delText>gone</w:delText></w:r></w:del>` +
          `<w:ins ${GRACE}><w:r><w:rPr><w:b/></w:rPr><w:t>new</w:t></w:r></w:ins>`
      )
    );
  });

  for (const offset of [0, 2, 4]) {
    test(`a paste that opens with a table at offset ${offset} is rejected cleanly`, () => {
      const surface = mountSuggesting('<w:p><w:r><w:t>host</w:t></w:r></w:p>');
      putCaret(surface, offset);
      surface.pasteRich('cell', '<table><tr><td>cell</td></tr></table><p>after</p>');
      expect(xmlOf(surface)).toContain(`<w:trPr><w:ins ${GRACE}/></w:trPr>`);
      surface.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
      expect(surface.session.bodyText()).toBe('host');
      expect(surface.session.paragraphIds()).toHaveLength(1);
    });
  }

  test('a row inside a row-level content control is proposed like any row', () => {
    const source = mountPaginatedSurface(
      document.createElement('div'),
      docx(
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
          '<w:tr><w:tc><w:p><w:r><w:t>plain row</w:t></w:r></w:p></w:tc></w:tr>' +
          '<w:sdt><w:sdtPr/><w:sdtContent><w:tr><w:tc><w:p><w:r><w:t>sdt row</w:t></w:r></w:p>' +
          '</w:tc></w:tr></w:sdtContent></w:sdt></w:tbl><w:p/>'
      ),
      { scale: 1 }
    );
    if (!source.ok) throw new Error(source.reason);
    putCaret(source.surface, 0);
    source.surface.selectAll();
    const flavours = source.surface.copyFlavours();
    const target = mountSuggesting('<w:p><w:r><w:t>host</w:t></w:r></w:p>');
    putCaret(target, 4);
    target.pasteRich(flavours.text, flavours.html);
    const pasted = xmlOf(target);
    expect(pasted).toContain('<w:sdtContent><w:tr><w:trPr><w:ins ');
    expect(pasted.match(new RegExp(`<w:trPr><w:ins ${GRACE}/>`, 'g'))).toHaveLength(2);
    target.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(target.session.bodyText()).toBe('host');
  });

  test('a pasted note body is part of the proposal', () => {
    const surface = mountSuggesting('<w:p><w:r><w:t>host</w:t></w:r></w:p>');
    putCaret(surface, 4);
    surface.pasteRich(
      'See[1].\nSource note.',
      '<p>See<a style="mso-footnote-id:ftn1" href="#_ftn1">[1]</a>.</p>' +
        '<div style="mso-element:footnote-list">' +
        '<div style="mso-element:footnote" id="ftn1"><p>' +
        '<a style="mso-footnote-id:ftn1" href="#_ftnref1">[1]</a>Source note.</p>' +
        '</div></div>'
    );
    const notes = surface.session.currentPackage().parts.get('/word/footnotes.xml');
    expect(notes).toBeDefined();
    const notesXml = serializeOoxmlPart(notes!);
    expect(notesXml).toMatch(
      /<w:ins [^>]*w:author="Grace Hopper"[^>]*>(?:(?!<\/w:ins>).)*Source note/
    );
  });

  test('the struck selection and the pasted proposal share one date', () => {
    const surface = mountSuggesting('<w:p><w:r><w:t>keep gone keep</w:t></w:r></w:p>');
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset: 5 }, head: { paragraphId, offset: 9 } });
    surface.pasteRich('new', '<p><b>new</b></p>');
    const dates = new Set(
      [
        ...serializeOoxmlPart(surface.session.part()).matchAll(
          /<w:(?:ins|del) [^>]*w:date="([^"]+)"/g
        ),
      ].map((match) => match[1])
    );
    expect(dates.size).toBe(1);
  });

  test('one undo takes the whole proposal back', () => {
    const surface = mountSuggesting('<w:p><w:r><w:t>host</w:t></w:r></w:p>');
    const before = xmlOf(surface);
    putCaret(surface, 4);
    surface.pasteRich('fallback', WORD_HTML);
    expect(xmlOf(surface)).not.toBe(before);
    surface.undo();
    expect(xmlOf(surface)).toBe(before);
  });

  test('without an author the paste is refused, never written untracked', () => {
    const opened = mountPaginatedSurface(
      document.createElement('div'),
      docx('<w:p><w:r><w:t>host</w:t></w:r></w:p>'),
      { scale: 1 }
    );
    if (!opened.ok) throw new Error(opened.reason);
    opened.surface.setEditingMode('suggest');
    const before = serializeOoxmlPart(opened.surface.session.part());
    putCaret(opened.surface, 4);
    opened.surface.pasteRich('plain', '<p><b>rich</b></p>');
    expect(serializeOoxmlPart(opened.surface.session.part())).toBe(before);
  });
});
