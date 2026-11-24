// A renderer that throws refuses its drawing, and a late install says so once.

import { expect, spyOn, test } from 'bun:test';
import { drawingRenderers, installDrawingRenderers } from '../drawing-renderers.ts';
import type { OoxmlElement } from '../ooxml-tree.ts';

const anchor = {} as OoxmlElement;
const extent = { cx: 1, cy: 1 };

test('a throwing renderer returns its refusal instead of throwing', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  installDrawingRenderers({
    chart: () => {
      throw new RangeError('bad format code');
    },
    effects: {
      shape: () => {
        throw new Error('effects');
      },
      picture: () => {
        throw new Error('effects');
      },
    },
    metafile: { replay: () => Promise.reject(new Error('replay')) },
  });
  const installed = drawingRenderers();
  expect(installed.chart?.(anchor, extent, {})).toBeNull();
  const components = [] as const;
  expect(installed.effects?.shape({ components, extent } as never)).toBe(components);
  expect(installed.effects?.picture({ outlineEmu: null } as never)).toBeNull();
  expect(await installed.metafile?.replay(new Uint8Array(), 'image/x-emf', {} as never)).toBeNull();
  warn.mockRestore();
});

test('installing new renderers after a document read warns once; reinstalling is silent', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  const chart = () => null;
  drawingRenderers();
  installDrawingRenderers({ chart });
  installDrawingRenderers({ chart });
  installDrawingRenderers({ diagramLayout: () => null });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]![0])).toContain('before the first document opens');
  warn.mockRestore();
});

test('naming a renderer with undefined removes it', () => {
  installDrawingRenderers({ chart: () => null });
  installDrawingRenderers({ chart: undefined });
  expect(drawingRenderers().chart).toBeUndefined();
});
