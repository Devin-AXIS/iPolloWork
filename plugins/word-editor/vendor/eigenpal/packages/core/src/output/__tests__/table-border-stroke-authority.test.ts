import { expect, test } from 'bun:test';
import { applyCellBorders } from '../semantic-paint-table-borders.ts';
import type { ResolvedCellBorders } from '../../layout/table-borders.ts';

for (const cssStyle of ['solid', 'dashed', 'dotted'] as const) {
  for (const side of ['top', 'left'] as const) {
    test(`published ${side} ${cssStyle} stroke replaces the CSS edge`, () => {
      const element = document.createElement('div');
      const horizontal = side === 'top';
      const borders: ResolvedCellBorders = {
        [side]: { style: cssStyle === 'solid' ? 'single' : cssStyle, widthPt: 2, color: '123456' },
        strokes: [
          {
            side,
            role: 'edge',
            cssStyle,
            color: '123456',
            x: 0,
            y: -1,
            width: horizontal ? 80 : 2,
            height: horizontal ? 2 : 40,
          },
        ],
      };
      applyCellBorders(document, element, borders, 2);
      expect(element.style[horizontal ? 'borderTopStyle' : 'borderLeftStyle']).toBe('none');
      const strokes = element.querySelectorAll<HTMLElement>('.docx-table-border-edge-stroke');
      expect(strokes).toHaveLength(1);
      const stroke = strokes[0]!;
      expect(stroke.style.top).toBe('-2px');
      expect(stroke.style.width).toBe(horizontal ? '160px' : '4px');
      expect(stroke.style.height).toBe(horizontal ? '4px' : '80px');
      if (cssStyle === 'solid') expect(stroke.style.backgroundColor).toBe('#123456');
      else {
        expect(stroke.style[horizontal ? 'borderTopStyle' : 'borderLeftStyle']).toBe(cssStyle);
        expect(stroke.style[horizontal ? 'borderTopWidth' : 'borderLeftWidth']).toBe('4px');
        expect(stroke.style.backgroundColor).toBe('');
        expect(stroke.style.boxSizing).toBe('border-box');
      }
      expect(stroke.parentElement!.getAttribute('contenteditable')).toBe('false');
    });
  }
}
