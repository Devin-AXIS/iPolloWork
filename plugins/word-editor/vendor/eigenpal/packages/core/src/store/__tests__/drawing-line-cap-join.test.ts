import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readOoxmlPart, type OoxmlElement } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { projectVectorShape } from '../package/drawing-shape-projection.ts';
import { vectorShapeFrame } from '../../output/semantic-paint-vector-shape.ts';
import { vectorShapeInkClip } from '../../layout/vector-shape-ink.ts';
import type { InlineDrawingRecord } from '../../layout/drawing-layout.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const EXTENT = { cx: 127000, cy: 127000 };

function fixture(line: string, themeLine?: string) {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="${A}" xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing><wp:inline>
    <wp:extent cx="127000" cy="127000"/><wp:docPr id="1" name="Line"/>
    <a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:spPr>
    <a:prstGeom prst="line"/><a:noFill/>${line}</wps:spPr>
    <wps:style><a:lnRef idx="1"><a:srgbClr val="000000"/></a:lnRef></wps:style>
    </wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw Error(parsed.reason);
  const stack = [parsed.part.root];
  let inline: OoxmlElement | undefined;
  while (stack.length) {
    const node = stack.pop()!;
    if (node.localName === 'inline') inline = node;
    for (const child of node.children) if (child.kind !== 'textValue') stack.push(child);
  }
  if (!inline) throw Error('Missing source inline drawing');
  const theme = themeLine
    ? readOoxmlPart(`<a:ln xmlns:a="${A}" ${themeLine}`, {
        name: '/word/theme/theme1.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.theme+xml',
      })
    : null;
  if (theme && !theme.ok) throw Error(theme.reason);
  const shape = projectVectorShape(
    inline,
    EXTENT,
    false,
    undefined,
    theme?.ok ? () => theme.part.root : undefined
  );
  if (!shape) throw Error('Source line projection refused');
  const bounds = { x: 0, y: 0, width: 10, height: 10 };
  const record = {
    vectorShape: shape,
    paintBounds: bounds,
    geometry: { contentBounds: bounds },
  } as unknown as InlineDrawingRecord;
  const frame = vectorShapeFrame(document, record, 1);
  return { part: parsed.part, shape, record, frame, path: frame.querySelector('path')! };
}

const line = (attributes = '', join = '') =>
  `<a:ln w="25400" ${attributes}><a:solidFill><a:srgbClr val="112233"/></a:solidFill>${join}</a:ln>`;

describe('source vector line ends and joins', () => {
  for (const [source, svg] of [
    ['flat', 'butt'],
    ['rnd', 'round'],
    ['sq', 'square'],
  ] as const) {
    test(`source ${source} cap reaches the actual SVG path`, () => {
      const value = fixture(line(`cap="${source}"`));
      expect(value.shape.components[0]!.strokeCap).toBe(svg);
      expect(value.path.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(value.path.getAttribute('stroke-linecap')).toBe(svg);
      expect(value.path.getAttribute('stroke-width')).toBe('25400');
      expect(value.path.getAttribute('stroke')).toBe('#112233');
      expect(value.path.getAttribute('d')).toBe('M0 0L127000 127000');
    });
  }
  for (const join of ['round', 'bevel'] as const) {
    test(`source ${join} join reaches the actual SVG path`, () => {
      const value = fixture(line('', `<a:${join}/>`));
      expect(value.shape.components[0]!.strokeJoin).toBe(join);
      expect(value.path.getAttribute('stroke-linejoin')).toBe(join);
      expect(value.path.getAttribute('stroke-linecap')).toBeNull();
    });
  }
  test('theme cap and join inherit independently of direct width and fill', () => {
    const value = fixture(line(), 'w="63500" cap="rnd"><a:bevel/></a:ln>');
    expect(value.path.getAttribute('stroke-width')).toBe('25400');
    expect(value.path.getAttribute('stroke')).toBe('#112233');
    expect(value.path.getAttribute('stroke-linecap')).toBe('round');
    expect(value.path.getAttribute('stroke-linejoin')).toBe('bevel');
  });
  test('direct cap and join override the selected theme', () => {
    const value = fixture(line('cap="sq"', '<a:round/>'), 'cap="flat"><a:bevel/></a:ln>');
    expect(value.path.getAttribute('stroke-linecap')).toBe('square');
    expect(value.path.getAttribute('stroke-linejoin')).toBe('round');
  });
  test('an absent join is round and an absent cap keeps the SVG default', () => {
    const value = fixture(line());
    expect(value.path.getAttribute('stroke-linecap')).toBeNull();
    expect(value.path.getAttribute('stroke-linejoin')).toBe('round');
    expect(value.path.getAttribute('stroke-miterlimit')).toBeNull();
    expect(value.shape.components[0]!.subpathsEmu).toEqual([
      [
        { x: 0, y: 0 },
        { x: 127000, y: 127000 },
      ],
    ]);
  });
  test('unsupported cap and miter do not inherit a different authored theme', () => {
    const value = fixture(
      line('cap="unknown"', '<a:miter lim="800000"/>'),
      'cap="rnd"><a:round/></a:ln>'
    );
    expect(value.path.getAttribute('stroke-linecap')).toBeNull();
    expect(value.path.getAttribute('stroke-linejoin')).toBe('miter');
    expect(value.path.getAttribute('stroke-miterlimit')).toBe('8');
  });
  test('a miter join without a limit uses 8 line widths, and the limit reads in thousandths', () => {
    expect(fixture(line('', '<a:miter/>')).path.getAttribute('stroke-miterlimit')).toBe('8');
    const limited = fixture(line('', '<a:miter lim="250000"/>'));
    expect(limited.shape.components[0]!.strokeMiterLimit).toBe(2.5);
    expect(fixture(line('', '<a:miter lim="junk"/>')).shape.components[0]!.strokeMiterLimit).toBe(
      8
    );
  });
  test('duplicate joins do not select one or inherit a theme join', () => {
    const value = fixture(line('', '<a:round/><a:bevel/>'), 'cap="flat"><a:bevel/></a:ln>');
    expect(value.path.getAttribute('stroke-linejoin')).toBe('round');
  });
  test('foreign QName cap and join do not become DrawingML properties', () => {
    const value = fixture(
      line('xmlns:f="urn:foreign" f:cap="rnd"', '<f:round xmlns:f="urn:foreign"/>')
    );
    expect(value.path.getAttribute('stroke-linecap')).toBeNull();
    expect(value.path.getAttribute('stroke-linejoin')).toBe('round');
  });
  test('projection and paint preserve source cap and join through save and reopen', () => {
    const value = fixture(line('cap="rnd"', '<a:round/>'));
    const before = serializeOoxmlPart(value.part);
    expect(before).toContain('cap="rnd"');
    expect(before).toContain('round');
    const reopened = readOoxmlPart(before, {
      name: value.part.name,
      contentType: value.part.contentType,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw Error(reopened.reason);
    expect(serializeOoxmlPart(reopened.part)).toBe(before);
    expect(serializeOoxmlPart(value.part)).toBe(before);
    expect(value.path.getAttribute('stroke-linecap')).toBe('round');
  });
  test('round end ink reaches one half width past the source endpoint', () => {
    const value = fixture(line('cap="rnd"'));
    const bounds = vectorShapeInkClip(value.record, value.record.paintBounds);
    expect(bounds.x).toBeCloseTo(-1, 9);
    expect(bounds.y).toBeCloseTo(-1, 9);
    expect(bounds.width).toBeCloseTo(12, 9);
    expect(value.record.paintBounds.width).toBe(10);
  });
  test('square end ink includes the extended diagonal corners', () => {
    const value = fixture(line('cap="sq"'));
    const bounds = vectorShapeInkClip(value.record, value.record.paintBounds);
    expect(bounds.x).toBeCloseTo(-Math.SQRT2, 9);
    expect(bounds.y).toBeCloseTo(-Math.SQRT2, 9);
    expect(bounds.width).toBeCloseTo(10 + 2 * Math.SQRT2, 9);
  });
  test('absent and authored flat ends keep identical old clip geometry', () => {
    const absent = fixture(line());
    const flat = fixture(line('cap="flat"'));
    expect(vectorShapeInkClip(absent.record, absent.record.paintBounds)).toEqual(
      vectorShapeInkClip(flat.record, flat.record.paintBounds)
    );
  });
});
