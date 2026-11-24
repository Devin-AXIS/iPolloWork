// Legacy shapes as some writers save them: omitted path operands, a flat coordinate extent,
// an explicit solid fill type, and the anchor paragraph named as `paragraph`.

import { expect, test } from 'bun:test';
import { projectDrawingsInPart, type DrawingProjection } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { isLegacyPlaceholder } from './legacy-vml-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const W10 = 'urn:schemas-microsoft-com:office:word';

function project(content: string): DrawingProjection | undefined {
  const xml = `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:w10="${W10}"><w:body><w:p><w:r><w:pict>${content}</w:pict></w:r></w:p></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  const [projection] = projectDrawingsInPart(loaded.part);
  return projection;
}

/** Whether the shape paints: a refused floating shape projects nothing, an inline one a placeholder. */
const paints = (projection: DrawingProjection | undefined) =>
  projection !== undefined && !isLegacyPlaceholder(projection);

const FLOAT =
  'position:absolute;margin-left:100pt;margin-top:12pt;mso-position-horizontal-relative:page';

test('an omitted path operand is zero', () => {
  const projection = project(
    `<v:shape style="${FLOAT};width:90pt;height:.1pt" coordsize="1812,1270" path="m,l1811,e" filled="f" strokeweight="1pt"><w10:wrap type="topAndBottom"/></v:shape>`
  );
  expect(paints(projection)).toBe(true);
  expect(projection!.kind).toBe('anchored');
});

test('a flat coordinate extent keeps its points on the axis', () => {
  const flat = project(
    `<v:shape style="${FLOAT};width:142pt;height:.1pt" coordorigin="2006,258" coordsize="2852,0" path="m2006,258l4857,258e" filled="false" stroked="true" strokeweight=".5pt"/>`
  );
  expect(paints(flat)).toBe(true);
  // A point off the flat axis has no position, so the shape is refused.
  const off = project(
    `<v:shape style="${FLOAT};width:142pt;height:.1pt" coordorigin="2006,258" coordsize="2852,0" path="m2006,258l4857,260e" filled="false" stroked="true" strokeweight=".5pt"/>`
  );
  expect(paints(off)).toBe(false);
});

test('an explicit solid fill paints; another fill type is refused', () => {
  const rect = (type: string) =>
    project(
      `<v:rect style="${FLOAT};width:470pt;height:.5pt" filled="true" fillcolor="#231f20" stroked="false"><v:fill type="${type}"/></v:rect>`
    );
  expect(paints(rect('solid'))).toBe(true);
  expect(paints(rect('gradient'))).toBe(false);
});

test('a line placed against the paragraph by name follows its paragraph', () => {
  const projection = project(
    `<v:line style="position:absolute;mso-position-horizontal-relative:page;mso-position-vertical-relative:paragraph" from="290pt,-3pt" to="538pt,-3pt" strokeweight=".5pt"><w10:wrap type="none"/></v:line>`
  );
  expect(paints(projection)).toBe(true);
  expect(projection!.position?.vertical.relativeFrom).toBe('paragraph');
});

test('a through-wrapped shape wraps through its own coordinates', () => {
  const projection = project(
    `<v:rect style="${FLOAT};width:6in;height:134pt" wrapcoords="-38 -360 -38 21240 21638 21240 21638 -360 -38 -360" filled="f"><w10:wrap type="through"/></v:rect>`
  );
  expect(paints(projection)).toBe(true);
  expect(projection!.wrap).toBe('through');
  expect(projection!.wrapGeometry?.polygon).toHaveLength(5);
});
