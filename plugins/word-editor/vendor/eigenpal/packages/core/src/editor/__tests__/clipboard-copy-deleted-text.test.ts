// The plain-text clipboard flavour is the proposed text: deleted words and deleted paragraph
// marks stay out, as a desktop word processor leaves them out. The Original view copies the
// text before the changes, which is what it shows.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { mount, putCaret } from './paginated-surface-fixtures.ts';

const ANN = 'w:author="Ann" w:date="2026-01-01T00:00:00Z"';
const BODY =
  `<w:p><w:pPr><w:rPr><w:del w:id="1" ${ANN}/></w:rPr></w:pPr>` +
  '<w:r><w:t xml:space="preserve">Joined </w:t></w:r></w:p>' +
  `<w:p><w:r><w:t xml:space="preserve">first </w:t></w:r>` +
  `<w:del w:id="2" ${ANN}><w:r><w:delText xml:space="preserve">gone </w:delText></w:r></w:del>` +
  `<w:ins w:id="3" ${ANN}><w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins>` +
  '<w:r><w:t>end</w:t></w:r></w:p>' +
  `<w:p><w:del w:id="4" ${ANN}><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  '<w:r><w:delInstrText>PAGE</w:delInstrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:delText>17</w:delText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:del>' +
  '<w:r><w:t>tail</w:t></w:r></w:p>';

function copyAll(mode?: 'original' | 'proposed' | 'simple-markup'): string {
  const { surface } = mount(BODY);
  if (mode) surface.setRevisionDisplayMode(mode);
  putCaret(surface, 0);
  surface.selectAll();
  return surface.copyFlavours().text;
}

describe('the plain-text flavour of a copy over tracked changes', () => {
  test('leaves deleted words, fields and paragraph marks out', () => {
    expect(copyAll()).toBe('Joined first added end\ntail');
  });

  test('the HTML flavour agrees: no deleted text', () => {
    const { surface } = mount(BODY);
    putCaret(surface, 0);
    surface.selectAll();
    expect(surface.copyFlavours().html).not.toContain('gone');
  });

  test('a deleted mark before a table keeps the break', () => {
    const { surface } = mount(
      `<w:p><w:pPr><w:rPr><w:del w:id="1" ${ANN}/></w:rPr></w:pPr><w:r><w:t>para</w:t></w:r></w:p>` +
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' +
        '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>'
    );
    putCaret(surface, 0);
    surface.selectAll();
    expect(surface.copyFlavours().text).toMatch(/^para\ncell/);
  });

  test('the final views copy the same proposed text', () => {
    expect(copyAll('proposed')).toBe('Joined first added end\ntail');
    expect(copyAll('simple-markup')).toBe('Joined first added end\ntail');
  });

  test('the Original view copies the text it shows, without the hidden insertion', () => {
    // The deleted PAGE field shows the page it is on, not its saved `17`.
    expect(copyAll('original')).toBe('Joined \nfirst gone end\n1tail');
  });
});
