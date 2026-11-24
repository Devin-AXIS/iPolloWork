import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

function layout(label: string, revision: number) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="2400" w:leader="dot"/></w:tabs></w:pPr>
    <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${label}</w:t><w:tab/><w:t>1</w:t></w:r></w:p>
    </w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return layoutSemanticDocument(parsed.part, revision, { measurer: createFixedMeasurer(5, 12) });
}

test('fresh and retained page paint use the same paper-relative leader grid', () => {
  const container = document.createElement('div');
  paintSemanticLayout(container, layout('One', 0), { scale: 1 });
  const changed = layout('Longer label', 1);
  paintSemanticLayout(container, changed, { scale: 1 });
  const fresh = document.createElement('div');
  paintSemanticLayout(fresh, changed, { scale: 1 });
  const selector = '[data-docx-tab-leader]';
  expect(container.querySelector(selector)!.outerHTML).toBe(
    fresh.querySelector(selector)!.outerHTML
  );
  const layer = fresh.querySelector<HTMLElement>(selector)!;
  const glyphs = layer.firstElementChild as HTMLElement;
  const page = changed.pages[0]!;
  const paragraph = page.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  const span = paragraph.lines[0]!.spans.find((span) => span.tabLeader)!;
  const first = page.contentBox.x + span.box.x + Number.parseFloat(glyphs.style.marginLeft);
  expect(first / span.tabLeaderAdvancePt!).toBeCloseTo(
    Math.round(first / span.tabLeaderAdvancePt!),
    7
  );
  expect(
    Number.parseFloat(glyphs.style.marginLeft) +
      glyphs.textContent!.length * span.tabLeaderAdvancePt!
  ).toBeLessThanOrEqual(span.box.width + 1e-8);
});
