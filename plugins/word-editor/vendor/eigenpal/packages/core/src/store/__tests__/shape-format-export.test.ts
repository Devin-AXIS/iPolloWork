// A save repairs what concurrent shape edits can merge into: a hidden-fill extension keeps
// exactly one fill or goes, and a VML fallback agrees with the DrawingML fill and outline.

import { expect, test } from 'bun:test';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { findNode, nodeIndexTestRecorder } from '../package/ooxml-edit.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { shapeFormatExportPackage } from '../package/shape-format-export.ts';

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
].join(' ');

const HIDDEN_FILL = '{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}';
const HIDDEN_LINE = '{91240B29-F687-4F45-9708-019B960494DF}';

function shape(spPr: string, rect: string): string {
  return (
    '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" ' +
    'distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH ' +
    'relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV ' +
    'relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent ' +
    'cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="Box"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
    'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>' +
    '<wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/>' +
    `</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${spPr}</wps:spPr><wps:bodyPr/>` +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback>' +
    `<w:pict>${rect}</w:pict></mc:Fallback></mc:AlternateContent>`
  );
}

function packageOf(run: string): OoxmlPackage {
  const xml = `<w:document ${NS}><w:body><w:p><w:r>${run}</w:r></w:p></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  return {
    parts: new Map([[loaded.part.name, loaded.part]]),
    partBytes: new Map(),
    relationships: new Map(),
    externalTargets: [],
    contentTypes: { defaults: new Map(), overrides: new Map() },
    mainDocumentPart: loaded.part.name,
  } as unknown as OoxmlPackage;
}

function saved(pkg: OoxmlPackage): string {
  return serializeOoxmlPart(shapeFormatExportPackage(pkg).parts.get('/word/document.xml')!);
}

const ext = (uri: string, body: string) =>
  `<a:extLst><a:ext uri="${uri}">${body}</a:ext></a:extLst>`;
const RED = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>';
const BLUE = '<a:solidFill><a:srgbClr val="0000FF"/></a:solidFill>';

test('an empty hidden fill goes, with its emptied extension list', () => {
  const xml = saved(
    packageOf(shape(`<a:noFill/>${ext(HIDDEN_FILL, '<a14:hiddenFill/>')}`, '<v:rect filled="f"/>'))
  );
  expect(xml).not.toContain('hiddenFill');
  expect(xml).not.toContain('extLst');
  expect(xml).toContain('<a:noFill/>');
});

test('a hidden fill with two fills keeps the first, and a repeated extension goes', () => {
  const body = `<a14:hiddenFill>${RED}${BLUE}</a14:hiddenFill>`;
  const twice =
    `<a:extLst><a:ext uri="${HIDDEN_FILL}">${body}</a:ext>` +
    `<a:ext uri="${HIDDEN_FILL}"><a14:hiddenFill>${BLUE}</a14:hiddenFill></a:ext></a:extLst>`;
  const xml = saved(packageOf(shape(`<a:noFill/>${twice}`, '<v:rect filled="f"/>')));
  expect(xml.match(/<a14:hiddenFill>/g)).toHaveLength(1);
  expect(xml).toContain(`<a14:hiddenFill>${RED}</a14:hiddenFill>`);
  expect(xml).not.toContain('0000FF');
});

test('a hidden line keeps its first fill and the rest of the line', () => {
  const line = `<a14:hiddenLine w="12700">${RED}${BLUE}<a:miter lim="800000"/><a:headEnd/></a14:hiddenLine>`;
  const ln = `<a:ln><a:noFill/>${ext(HIDDEN_LINE, line)}</a:ln>`;
  const xml = saved(packageOf(shape(`${BLUE}${ln}`, '<v:rect fillcolor="#0000ff" stroked="f"/>')));
  expect(xml).toContain(
    `<a14:hiddenLine w="12700">${RED}<a:miter lim="800000"/><a:headEnd/></a14:hiddenLine>`
  );
});

test('the VML copy takes the fill and outline the DrawingML copy writes', () => {
  // A shown fill clears filled="f" and takes the colour.
  let xml = saved(packageOf(shape(RED, '<v:rect fillcolor="#7030a0" filled="f"/>')));
  expect(xml).toContain('<v:rect fillcolor="#ff0000"/>');
  // No fill says filled="f" where the VML copy names a colour.
  xml = saved(packageOf(shape('<a:noFill/>', '<v:rect fillcolor="#7030a0"/>')));
  expect(xml).toContain('<v:rect fillcolor="#7030a0" filled="f"/>');
  // A hidden outline says stroked="f"; a shown one clears it and takes the colour.
  xml = saved(
    packageOf(
      shape(`${RED}<a:ln><a:noFill/></a:ln>`, '<v:rect fillcolor="#ff0000" strokecolor="#0000ff"/>')
    )
  );
  expect(xml).toContain('<v:rect fillcolor="#ff0000" strokecolor="#0000ff" stroked="f"/>');
  xml = saved(
    packageOf(
      shape(
        `${RED}<a:ln w="12700">${BLUE}</a:ln>`,
        '<v:rect fillcolor="#ff0000" strokecolor="#00b050" stroked="f"/>'
      )
    )
  );
  expect(xml).toContain('<v:rect fillcolor="#ff0000" strokecolor="#0000ff"/>');
});

test('a named VML colour, a theme suffix, style paint and VML defaults stay as authored', () => {
  for (const [spPr, rect] of [
    [`<a:solidFill><a:srgbClr val="000000"/></a:solidFill>`, '<v:rect fillcolor="black"/>'],
    [`<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>`, '<v:rect fillcolor="white [3201]"/>'],
    // Paint from a shape style: the DrawingML copy writes no fill or line of its own.
    ['', '<v:rect filled="f" stroked="f"/>'],
    // No colour named: the VML default stays.
    ['<a:noFill/><a:ln><a:noFill/></a:ln>', '<v:rect/>'],
  ]) {
    const pkg = packageOf(shape(spPr!, rect!));
    expect(shapeFormatExportPackage(pkg)).toBe(pkg);
  }
});

test('a shape whose copies agree saves the same package', () => {
  const pkg = packageOf(
    shape(
      `<a:noFill/>${ext(HIDDEN_FILL, `<a14:hiddenFill>${RED}</a14:hiddenFill>`)}`,
      '<v:rect filled="f" stroked="f"/>'
    )
  );
  const part: OoxmlPart = pkg.parts.get('/word/document.xml')!;
  const next = shapeFormatExportPackage(pkg);
  expect(next).toBe(pkg);
  expect(next.parts.get('/word/document.xml')).toBe(part);
});

test('a VML colour the repair cannot read stays as written', () => {
  for (const colour of ['window', 'rgb(10, 20, 30)', 'fill darken(118)']) {
    const pkg = packageOf(shape(RED, `<v:rect fillcolor="${colour}"/>`));
    expect(shapeFormatExportPackage(pkg)).toBe(pkg);
  }
});

test('a v:fill child that turns the fill off counts as the flag does', () => {
  // The fill is off in both copies: nothing to repair.
  const off = packageOf(
    shape('<a:noFill/>', '<v:rect fillcolor="#ff0000"><v:fill on="f"/></v:rect>')
  );
  expect(shapeFormatExportPackage(off)).toBe(off);
  // The DrawingML fill shows: the child turns it back on.
  const xml = saved(packageOf(shape(RED, '<v:rect fillcolor="#ff0000"><v:fill on="f"/></v:rect>')));
  expect(xml).toContain('<v:rect fillcolor="#ff0000"><v:fill/></v:rect>');
});

test('2,000 disagreeing shapes repair in one pass, under a second', () => {
  const run = Array.from({ length: 2000 }, () =>
    shape(RED, '<v:rect fillcolor="#7030a0" filled="f"/>')
  ).join('');
  const pkg = packageOf(run);
  const started = performance.now();
  const xml = saved(pkg);
  expect(performance.now() - started).toBeLessThan(1000);
  expect(xml.match(/<v:rect fillcolor="#ff0000"\/>/g)).toHaveLength(2000);
});

test('a repaired save leaves the live part and its node index as they were', () => {
  const pkg = packageOf(shape(RED, '<v:rect fillcolor="#7030a0" filled="f"/>'));
  const part = pkg.parts.get('/word/document.xml')!;
  const rectId = idOfRect(part);
  const rect = findNode(part, rectId)!;
  shapeFormatExportPackage(pkg);
  const recorder = nodeIndexTestRecorder();
  recorder.reset();
  // The live part still finds its nodes without a rebuild walk.
  expect(findNode(part, rectId)).toBe(rect);
  expect(recorder.completeBuilds).toBe(0);
  expect(serializeOoxmlPart(part)).toContain('filled="f"');
});

function idOfRect(part: OoxmlPart): string {
  const walk = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === 'rect') return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root)!;
}
