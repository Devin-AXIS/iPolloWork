import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../package/ooxml-tree.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(width: string, height: string, size: string, path: string) {
  const xml = `<w:document xmlns:w="${W}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p><w:r><w:t>A</w:t><w:pict><v:shape style="position:absolute;left:12pt;top:18pt;width:${width};height:${height};" coordsize="${size}" coordorigin="0,0" path="${path}" filled="false" strokecolor="#123456" strokeweight="1pt"/></w:pict><w:t>Z</w:t></w:r></w:p></w:body></w:document>`;
  const result = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

test.each([
  [
    'vertical',
    '0pt',
    '18pt',
    '0,360',
    'm0,360l0,0e',
    [
      { x: 0, y: 228600 },
      { x: 0, y: 0 },
    ],
  ],
  [
    'horizontal',
    '24pt',
    '0pt',
    '480,0',
    'm0,0l480,0e',
    [
      { x: 0, y: 0 },
      { x: 304800, y: 0 },
    ],
  ],
] as const)(
  'projects a %s VML shape path as a native line',
  (_label, width, height, size, path, points) => {
    const source = part(width, height, size, path);
    const before = serializeOoxmlPart(source);
    const drawing = projectDrawingsInPart(source)[0];
    expect(drawing?.vectorShape?.components[0]?.subpathsEmu[0]).toEqual(points);
    expect(drawing?.vectorShape?.components[0]?.strokeHex).toBe('123456');
    expect(serializeOoxmlPart(source)).toBe(before);
  }
);

test('refuses a zero coordinate axis with nonzero source coordinates', () => {
  const source = part('0pt', '18pt', '0,360', 'm3,360l3,0e');
  expect(projectDrawingsInPart(source)[0]?.vectorShape).toBeUndefined();
});

test.each([
  ['zero area', '0pt', '0pt', '0,0', 'm0,0l0,0e'],
  ['coincident endpoints', '0pt', '18pt', '0,360', 'm0,0l0,0e'],
  ['curve commands', '0pt', '18pt', '0,360', 'm0,0c0,120,0,240,0,360e'],
  ['negative extent', '0pt', '-18pt', '0,360', 'm0,360l0,0e'],
  ['negative coordinate size', '0pt', '18pt', '0,-360', 'm0,360l0,0e'],
  ['excessive extent', '0pt', '10001pt', '0,360', 'm0,360l0,0e'],
])('refuses %s without changing the source', (_label, width, height, size, path) => {
  const source = part(width, height, size, path);
  const before = serializeOoxmlPart(source);
  expect(projectDrawingsInPart(source)[0]?.vectorShape).toBeUndefined();
  expect(serializeOoxmlPart(source)).toBe(before);
});
