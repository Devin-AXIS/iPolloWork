import { expect, test } from 'bun:test';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { resolveRevisionMarkup } from '../../contracts/revision-markup.ts';
import { selectionRunStyle } from '../surface-formatting.ts';
import { linesOf } from '../../layout/semantic-records.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { projectRevisionMarkup } from '../../layout/revision-markup-projection.ts';
import { DEFAULT_RUN_STYLE, runStylesEqual } from '../../layout/run-style.ts';

test.each(['bold', 'italic'] as const)(
  'viewer %s markup does not change toolbar state or formatting commands',
  (mark) => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(
      container,
      docx('<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:t>plain</w:t></w:r></w:ins></w:p>'),
      {
        revisionDisplayMode: 'all-markup',
        revisionMarkup: resolveRevisionMarkup({ insertions: { mark } }),
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const paragraphId = surface.session.paragraphIds()[0]!;
      const selection = { anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } };
      surface.setSelection(selection);
      expect(linesOf(surface.layout())[0]!.spans[0]!.style[mark]).toBe(true);
      expect(surface.formatting()[mark]).toBe(false);
      expect(selectionRunStyle(surface.layout(), selection)![mark]).toBe(false);
      surface.toggleRunProperty(mark === 'bold' ? 'b' : 'i');
      expect(surface.formatting()[mark]).toBe(true);
      surface.toggleRunProperty(mark === 'bold' ? 'b' : 'i');
      expect(surface.formatting()[mark]).toBe(false);
      expect(linesOf(surface.layout())[0]!.spans[0]!.style[mark]).toBe(true);
    } finally {
      surface.destroy();
      container.remove();
    }
  }
);

test('markup emphasis preserves distinct authored formatting when visual styles agree', () => {
  const settings = resolveRevisionMarkup({ insertions: { mark: 'bold' } });
  const revision = { kind: 'insert', id: '1', author: 'Reviewer', nodeId: 'revision' } as const;
  const plain = projectRevisionMarkup('x', DEFAULT_RUN_STYLE, false, settings, revision).style;
  const bold = projectRevisionMarkup(
    'x',
    { ...DEFAULT_RUN_STYLE, bold: true },
    false,
    settings,
    revision
  ).style;
  expect(plain.bold).toBe(true);
  expect(bold.bold).toBe(true);
  expect(runStylesEqual(plain, bold)).toBe(false);
});

test.each(['caret', 'pound'] as const)(
  'deleted PAGE fields keep %s markup after page finalization',
  (mark) => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(
      container,
      docx(
        '<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:del></w:p>'
      ),
      {
        revisionDisplayMode: 'all-markup',
        revisionMarkup: resolveRevisionMarkup({ deletions: { mark } }),
      }
    );
    if (!opened.ok) throw new Error(opened.reason);
    try {
      expect(
        linesOf(opened.surface.layout())
          .flatMap((line) => line.spans)
          .map((span) => span.text)
          .join('')
      ).toBe(mark === 'caret' ? '^' : '#');
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  }
);
