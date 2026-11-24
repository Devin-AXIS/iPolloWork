// Layout must measure with the face paint draws with.
//
// A document-embedded font is registered under an engine-minted alias, and paint prefers
// that alias over the declared family. If measurement only ever sees the declared family,
// the browser falls back to an installed font: every advance, every wrap point and every
// page break comes from a font the reader never sees.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RUN_STYLE,
  resolveDefaultSurfaceMeasurer,
  tryCreateCanvasMeasurer,
  type CanvasTextContext,
} from '../index.ts';

/** Records the font shorthand it was asked to measure with. */
function recordingContext(): { context: CanvasTextContext; fonts: string[] } {
  const fonts: string[] = [];
  const context = {
    font: '',
    measureText(text: string) {
      fonts.push((context as { font: string }).font);
      return { width: text.length * 6 };
    },
  } as unknown as CanvasTextContext;
  return { context, fonts };
}

const style = { ...DEFAULT_RUN_STYLE, fontFamily: 'Embedded Serif' };

describe('the canvas measurer resolves embedded-font aliases', () => {
  test('without an alias it measures the declared family', () => {
    const { context, fonts } = recordingContext();
    const measurer = tryCreateCanvasMeasurer({ context });
    measurer!.measure('hello', style);
    expect(fonts[0]).toContain('"Embedded Serif"');
    expect(fonts[0]).not.toContain('docx-embedded');
  });

  test('with an alias the alias LEADS, with the declared family behind it', () => {
    const { context, fonts } = recordingContext();
    const measurer = tryCreateCanvasMeasurer({
      context,
      fontAlias: (family) => (family === 'Embedded Serif' ? 'docx-embedded-1' : undefined),
    });
    measurer!.measure('hello', style);
    expect(fonts[0]).toContain('"docx-embedded-1", "Embedded Serif"');
  });

  test('a family the alias does not cover is measured as declared', () => {
    const { context, fonts } = recordingContext();
    const measurer = tryCreateCanvasMeasurer({ context, fontAlias: () => undefined });
    measurer!.measure('hello', style);
    expect(fonts[0]).toContain('"Embedded Serif"');
  });

  test('an alias that is not a valid font name is refused, not interpolated', () => {
    const { context, fonts } = recordingContext();
    const measurer = tryCreateCanvasMeasurer({
      context,
      fontAlias: () => '"; background: url(x); font-family: "evil',
    });
    measurer!.measure('hello', style);
    expect(fonts[0]).not.toContain('url(');
    expect(fonts[0]).toContain('"Embedded Serif"');
  });

  test('resolving aliases is a different cache producer', () => {
    const { context } = recordingContext();
    expect(resolveDefaultSurfaceMeasurer(1, { context }).producer).toBe('canvas-measurer');
    expect(
      resolveDefaultSurfaceMeasurer(1, { context, fontAlias: () => 'docx-embedded-1' }).producer
    ).toBe('canvas-measurer+embedded');
  });
});
