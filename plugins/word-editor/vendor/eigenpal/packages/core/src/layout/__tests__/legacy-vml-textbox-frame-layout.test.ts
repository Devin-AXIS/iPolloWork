// Where a legacy VML text box lays its story out: the text area of an oval or round rectangle,
// the swapped frame of an upright story in a turned box, turned and vertical stories, boxes
// that fit their text, hidden text, and the painted area of turned, outlined and shadowed
// shapes. Each expectation restates a measured rendering of the same construct; positions are
// relative to a 200 pt × 100 pt box.

import { describe, expect, test } from 'bun:test';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  type AnchoredDrawingRecord,
  type InlineDrawingRecord,
} from '../index.ts';
import { linesOf } from '../semantic-record-queries.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';
const POS =
  'position:absolute;margin-left:144pt;margin-top:200pt;width:200pt;height:100pt;z-index:1;' +
  'mso-position-horizontal-relative:page;mso-position-vertical-relative:page';
const ELLIPSE_SHARE = (1 - Math.SQRT1_2) / 2;
const measurer = createFixedMeasurer(6, 14);

const lines = (count: number) =>
  Array.from({ length: count }, (_, k) => `<w:p><w:r><w:t>Line ${k}</w:t></w:r></w:p>`).join('');

function shape(options: {
  host?: string;
  attrs?: string;
  style?: string;
  textbox?: string;
  kids?: string;
  story?: string;
}): string {
  const host = options.host ?? 'v:shape';
  const attrs =
    options.attrs ??
    (host === 'v:shape' ? 'type="#_x0000_t202" filled="f" stroked="f"' : 'filled="f" stroked="f"');
  return (
    `<w:r><w:pict><${host} style="${options.style ?? POS}" ${attrs}>${options.kids ?? ''}` +
    `<v:textbox${options.textbox ?? ' inset="0,0,0,0"'}><w:txbxContent>${options.story ?? lines(1)}` +
    `</w:txbxContent></v:textbox></${host}></w:pict></w:r>`
  );
}

function layoutFor(content: string, after = '<w:p/>') {
  const loaded = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p>${content}</w:p>${after}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const part: OoxmlPart = loaded.part;
  const atoms = indexInlineDrawingProjectionsInPart(part);
  const drawingLayout: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    inlineDrawingLayout: drawingLayout,
  });
}

function drawingFor(content: string): AnchoredDrawingRecord {
  const drawings = layoutFor(content).pages[0]!.anchoredDrawings ?? [];
  expect(drawings).toHaveLength(1);
  return drawings[0]!;
}

const storyOf = (content: string) => drawingFor(content).textboxStory!;

describe('upright text in a turned box', () => {
  // Measured frames for one 20 pt inset at a quarter turn: the text area keeps its centre and
  // swaps its width and height.
  const cases = [
    ['20pt,0,0,0', { x: 60, y: -40, width: 100, height: 180 }],
    ['0,20pt,0,0', { x: 60, y: -40, width: 80, height: 200 }],
    ['0,0,20pt,0', { x: 40, y: -40, width: 100, height: 180 }],
    ['0,0,0,20pt', { x: 60, y: -60, width: 80, height: 200 }],
  ] as const;

  for (const degrees of [90, 270, 45]) {
    test(`a ${degrees} degree box swaps its text area about its centre`, () => {
      for (const [inset, frame] of cases) {
        const story = storyOf(
          shape({ style: `${POS};rotation:${degrees}`, textbox: ` inset="${inset}"` })
        );
        expect(story.contentOffset.x).toBeCloseTo(frame.x, 6);
        expect(story.contentOffset.y).toBeCloseTo(frame.y, 6);
        expect(story.contentWidth).toBeCloseTo(frame.width, 6);
        expect(story.contentHeight).toBeCloseTo(frame.height, 6);
        expect(story.contentRotation).toBeUndefined();
        expect(story.chromeRotationDegrees).toBe(degrees);
      }
    });
  }

  test('a box turned less than 45 degrees or a half turn keeps its text area', () => {
    for (const degrees of [30, 180]) {
      const story = storyOf(
        shape({ style: `${POS};rotation:${degrees}`, textbox: ' inset="20pt,0,0,0"' })
      );
      expect(story.contentOffset).toEqual({ x: 20, y: 0 });
      expect(story.contentWidth).toBe(180);
    }
  });

  test('wrapped text keeps off both the box and the box turned about its centre', () => {
    const body = `<w:p><w:r><w:t>${'word '.repeat(300)}</w:t></w:r></w:p>`;
    const beside = (degrees: number) => {
      const layout = layoutFor(
        shape({
          style:
            'position:absolute;margin-left:0;margin-top:0;width:200pt;height:40pt;z-index:1;' +
            `mso-position-horizontal-relative:margin;mso-position-vertical-relative:text;rotation:${degrees}`,
          kids: '<w10:wrap type="square"/>',
        }),
        body
      );
      return linesOf(layout).filter((line) => line.contentX > 1);
    };
    const upright = beside(0),
      turned = beside(90);
    // A quarter turn stands 200 pt tall, so more lines pass beside it, and they still clear the
    // unturned 200 pt width and its 9 pt wrap distance.
    expect(turned.length).toBeGreaterThan(upright.length);
    for (const line of turned) expect(line.contentX).toBeCloseTo(209, 3);
  });

  test('the painted area holds the turned shape', () => {
    const drawing = drawingFor(shape({ style: `${POS};rotation:90` }));
    expect(drawing.paintBounds.x - drawing.x).toBeCloseTo(50, 6);
    expect(drawing.paintBounds.y - drawing.y).toBeCloseTo(-50, 6);
    expect(drawing.paintBounds.width).toBeCloseTo(100, 6);
    expect(drawing.paintBounds.height).toBeCloseTo(200, 6);
  });
});

describe('turned and vertical stories', () => {
  test('top-to-bottom text turns a quarter clockwise about the text area centre', () => {
    const story = storyOf(shape({ textbox: ' inset="0,0,0,0" style="layout-flow:vertical"' }));
    // Lines run down from the top edge and stack from the right edge.
    expect(story.contentOffset).toEqual({ x: 50, y: -50 });
    expect(story.contentWidth).toBe(100);
    expect(story.contentHeight).toBe(200);
    expect(story.contentRotation).toEqual({ degrees: 90, pivot: { x: 100, y: 50 } });
  });

  test('bottom-to-top text turns a quarter counterclockwise', () => {
    const story = storyOf(
      shape({
        textbox: ' inset="0,0,0,0" style="layout-flow:vertical;mso-layout-flow-alt:bottom-to-top"',
      })
    );
    expect(story.contentRotation).toEqual({ degrees: 270, pivot: { x: 100, y: 50 } });
  });

  test('vertical text keeps the physical insets', () => {
    // A 20 pt top inset moves the line starts down; a 20 pt right inset moves the first line.
    const top = storyOf(shape({ textbox: ' inset="0,20pt,0,0" style="layout-flow:vertical"' }));
    expect(top.contentWidth).toBe(80);
    expect(top.contentRotation!.pivot).toEqual({ x: 100, y: 60 });
    const right = storyOf(shape({ textbox: ' inset="0,0,20pt,0" style="layout-flow:vertical"' }));
    expect(right.contentHeight).toBe(180);
    expect(right.contentRotation!.pivot).toEqual({ x: 90, y: 50 });
  });

  test('text that turns with its shape turns with the whole box', () => {
    const story = storyOf(
      shape({
        style: `${POS};rotation:90`,
        textbox: ' inset="0,0,0,0" style="mso-rotate-with-shape:t"',
      })
    );
    expect(story.contentOffset).toEqual({ x: 0, y: 0 });
    expect(story.contentWidth).toBe(200);
    expect(story.contentRotation!.degrees).toBe(90);
    expect(story.contentRotation!.pivot.x).toBeCloseTo(100, 6);
    expect(story.contentRotation!.pivot.y).toBeCloseTo(50, 6);
  });
});

describe('text areas of curved shapes', () => {
  // Insets 2, 6, 14 and 24 pt with the default 0.75 pt outline, which insets by its half.
  const insets = ' inset="2pt,6pt,14pt,24pt"';

  test('an oval lays its text out in the inscribed rectangle', () => {
    const story = storyOf(shape({ host: 'v:oval', attrs: 'filled="f"', textbox: insets }));
    expect(story.contentOffset.x).toBeCloseTo(200 * ELLIPSE_SHARE + 2.375, 3);
    expect(story.contentOffset.y).toBeCloseTo(100 * ELLIPSE_SHARE + 6.375, 3);
    expect(story.outline).toEqual({ kind: 'ellipse' });
  });

  test('a round rectangle clears the inscribed square of its corner arcs', () => {
    for (const [arcsize, arc] of [
      ['5461f', 5461 / 65536],
      ['21845f', 21845 / 65536],
      ['32768f', 0.5],
    ] as const) {
      const story = storyOf(
        shape({ host: 'v:roundrect', attrs: `arcsize="${arcsize}" filled="f"`, textbox: insets })
      );
      const clear = arc * 100 * (1 - Math.SQRT1_2);
      expect(story.contentOffset.x).toBeCloseTo(clear + 2.375, 3);
      expect(story.contentOffset.y).toBeCloseTo(clear + 6.375, 3);
    }
  });
});

describe('boxes that fit their text', () => {
  test('a fitted rectangle takes the text height plus its insets', () => {
    const drawing = drawingFor(
      shape({ textbox: ' inset="0,10pt,0,5pt" style="mso-fit-shape-to-text:t"', story: lines(3) })
    );
    const story = drawing.textboxStory!;
    expect(drawing.height).toBeCloseTo(story.flowHeight + 15, 3);
    expect(story.contentOffset.y).toBe(10);
  });

  test('a fitted oval keeps its authored text area and moves its text to the new one', () => {
    for (const count of [1, 2, 4, 8]) {
      const drawing = drawingFor(
        shape({
          host: 'v:oval',
          attrs: 'filled="f"',
          textbox: ' style="mso-fit-shape-to-text:t"',
          story: lines(count),
        })
      );
      const story = drawing.textboxStory!;
      const height = story.flowHeight + 7.2 + 0.75 + 2 * ELLIPSE_SHARE * 100;
      expect(drawing.height).toBeCloseTo(height, 3);
      expect(story.contentOffset.y).toBeCloseTo(ELLIPSE_SHARE * height + 3.6 + 0.375, 3);
    }
  });

  test('a fitted round rectangle sizes its arc to the new height', () => {
    const drawing = drawingFor(
      shape({
        host: 'v:roundrect',
        attrs: 'arcsize="21845f" filled="f"',
        textbox: ' style="mso-fit-shape-to-text:t"',
        story: lines(1),
      })
    );
    const story = drawing.textboxStory!;
    const arc = 21845 / 65536;
    const height = story.flowHeight + 7.2 + 0.75 + 2 * arc * 100 * (1 - Math.SQRT1_2);
    expect(drawing.height).toBeCloseTo(height, 3);
    const clear = arc * Math.min(200, height) * (1 - Math.SQRT1_2);
    expect(story.contentOffset.x).toBeCloseTo(clear + 7.2 + 0.375, 3);
    expect(story.contentOffset.y).toBeCloseTo(clear + 3.6 + 0.375, 3);
  });

  test('a fitted box pushes surrounding text aside for its fitted height', () => {
    const body = `<w:p><w:r><w:t>${'word '.repeat(200)}</w:t></w:r></w:p>`;
    const shifted = (textbox: string) => {
      const layout = layoutFor(
        shape({
          style:
            'position:absolute;margin-left:0;margin-top:0;width:100pt;height:20pt;z-index:1;' +
            'mso-position-horizontal-relative:margin;mso-position-vertical-relative:text',
          kids: '<w10:wrap type="square"/>',
          textbox,
          story: lines(6),
        }),
        body
      );
      // A line beside the box starts its content past it.
      const lefts = linesOf(layout).map((line) => line.contentX);
      const column = Math.min(...lefts);
      return lefts.filter((x) => x > column + 1).length;
    };
    // Six story lines need more than the authored 20 pt, and the wrap follows the fitted box.
    expect(shifted(' inset="0,0,0,0" style="mso-fit-shape-to-text:t"')).toBeGreaterThan(
      shifted(' inset="0,0,0,0"')
    );
  });

  test('a fitted round rectangle lays its lines out at the fitted text width', () => {
    const drawing = drawingFor(
      shape({
        host: 'v:roundrect',
        attrs: 'arcsize="21845f" filled="f" stroked="f"',
        textbox: ' inset="0,0,0,0" style="mso-fit-shape-to-text:t"',
        story: lines(1),
      })
    );
    const story = drawing.textboxStory!;
    const clear = (21845 / 65536) * Math.min(200, drawing.height) * (1 - Math.SQRT1_2);
    expect(story.contentWidth).toBeCloseTo(200 - 2 * clear, 3);
    expect(story.contentOffset.x).toBeCloseTo(clear, 3);
  });

  test('fitted vertical text sets the box width from its left edge', () => {
    const drawing = drawingFor(
      shape({ textbox: ' style="mso-fit-shape-to-text:t;layout-flow:vertical"', story: lines(3) })
    );
    const authored = drawingFor(
      shape({ textbox: ' style="layout-flow:vertical"', story: lines(3) })
    );
    expect(drawing.x).toBe(authored.x);
    expect(drawing.width).toBeCloseTo(drawing.textboxStory!.flowHeight + 14.4, 3);
  });
});

describe('inline boxes', () => {
  test('an inline box keeps the reach of its shadow above and below its line', () => {
    const layout = layoutFor(
      shape({
        style:
          'width:100pt;height:40pt;mso-position-horizontal-relative:char;mso-position-vertical-relative:line',
        attrs: 'type="#_x0000_t202" filled="f"',
        kids: '<v:shadow on="t" offset="0,6pt"/>',
      })
    );
    const drawing = linesOf(layout)
      .flatMap((line) => line.drawings ?? [])
      .find((record): record is InlineDrawingRecord => !!record.textboxStory)!;
    expect(drawing.paintBounds.y + drawing.paintBounds.height).toBeCloseTo(
      drawing.y + 40 + 0.375 + 6,
      3
    );
  });
});

describe('shapes that paint without their text', () => {
  test('a rectangle with a text area of its own paints no text', () => {
    const story = storyOf(
      shape({
        host: 'v:rect',
        attrs: 'filled="f"',
        kids: '<v:path textboxrect="0,0,21600,21600"/>',
      })
    );
    expect(story.fragments).toEqual([]);
    expect(story.strokeHex).toBe('000000');
  });
});

describe('outline style and shadow', () => {
  test('a centred outline and a shadow widen the painted area', () => {
    const drawing = drawingFor(
      shape({
        attrs: 'type="#_x0000_t202" filled="f" strokeweight="4pt"',
        kids: '<v:shadow on="t" offset="6pt,-4pt"/>',
      })
    );
    const bounds = drawing.paintBounds;
    expect([bounds.x - drawing.x, bounds.y - drawing.y, bounds.width, bounds.height]).toEqual([
      -2, -6, 210, 108,
    ]);
  });

  test('dash lengths follow the outline width; capped dashes keep their length', () => {
    const plain = storyOf(
      shape({
        attrs: 'type="#_x0000_t202" filled="f" strokeweight="1pt"',
        kids: '<v:stroke dashstyle="dash"/>',
      })
    );
    expect(plain.strokeDashPt).toEqual([4, 3]);
    const capped = storyOf(
      shape({
        attrs: 'type="#_x0000_t202" filled="f" strokeweight="1pt"',
        kids: '<v:stroke dashstyle="dash" endcap="round"/>',
      })
    );
    expect(capped.strokeDashPt).toEqual([3, 4]);
    expect(capped.strokeCap).toBe('round');
  });
});
