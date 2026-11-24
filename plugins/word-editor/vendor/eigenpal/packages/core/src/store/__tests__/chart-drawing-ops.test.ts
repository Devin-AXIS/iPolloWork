// A chart is no picture in every state the page can show it. Without a chart renderer, a
// wrapped chart shows its saved fallback and a chart without one shows its placeholder; in
// both, picture edits refuse with `chart-drawing` and a delete removes the whole chart, unless
// the chart's own locks forbid it. A bare chart drawing also takes its frame edits: size,
// position, wrap and alt text. The drawn state, with the
// real renderer, is covered in `pro/src/drawing/__tests__/chart-drawing-ops.test.ts`.

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { indexInlineDrawingProjectionsInPart } from '../package/drawing-projection.ts';
import { packageDrawingProjectionContext } from '../package/drawing-projection-context.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';
import {
  chartexDocx,
  classicBarChartSpace,
  waterfallChartSpace,
  type ChartexDocxOptions,
} from './chartex-fixture.ts';

const VML_FALLBACK =
  '<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:432pt;height:252pt">' +
  '<v:imagedata r:id="rId11"/></v:shape></w:pict>';

function load(bytes: Uint8Array): OoxmlPackage {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function chartPackage(options: ChartexDocxOptions & { readonly vml?: boolean } = {}) {
  const chartXml = options.classic
    ? classicBarChartSpace('Net')
    : waterfallChartSpace({ title: 'Net' });
  const files = unzipSync(chartexDocx(chartXml, options));
  if (options.vml) {
    files['word/document.xml'] = strToU8(
      strFromU8(files['word/document.xml']!).replace(
        /<mc:Fallback>.*<\/mc:Fallback>/,
        `<mc:Fallback>${VML_FALLBACK}</mc:Fallback>`
      )
    );
  }
  return load(zipSync(files));
}

function chart(options: ChartexDocxOptions & { readonly vml?: boolean } = {}) {
  const pkg = chartPackage(options);
  const part = pkg.parts.get('/word/document.xml')!;
  const index = indexInlineDrawingProjectionsInPart(
    part,
    packageDrawingProjectionContext(pkg, part.name)
  );
  const [[atomId, projection]] = [...index.entries()];
  return { part, atomId: atomId!, projection: projection! };
}

function editsFor(drawingNodeId: string): readonly TreeDocOp[] {
  return [
    { op: 'resizeDrawing', drawingNodeId, extentEmu: { cx: 914400, cy: 457200 } },
    { op: 'cropDrawing', drawingNodeId, crop: { left: 1000, top: 0, right: 0, bottom: 0 } },
    {
      op: 'positionDrawing',
      drawingNodeId,
      position: { mode: 'simple', horizontalEmu: 0, verticalEmu: 0 },
    },
    { op: 'setDrawingWrap', drawingNodeId, wrap: 'square' },
    { op: 'replaceDrawingResource', drawingNodeId, relationshipId: 'rId1' },
    { op: 'setDrawingMetadata', drawingNodeId, title: 'T', description: 'D' },
    { op: 'setDrawingLocks', drawingNodeId, locks: { resize: true } },
    { op: 'transformDrawing', drawingNodeId, action: 'rotateCW' },
  ];
}

/** Every id that names the chart: the atom, the shown drawing, and each branch's content. */
function chartIds(part: OoxmlPart, atomId: string, shownId: string): readonly string[] {
  const ids = new Set([atomId, shownId]);
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'Choice' || node.localName === 'Fallback') {
      for (const child of node.children) if (child.kind !== 'textValue') ids.add(child.id);
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return [...ids];
}

function expectRefusals(part: OoxmlPart, ids: readonly string[]): void {
  for (const id of ids) {
    for (const op of editsFor(id)) {
      expect([op.op, validateTreeOp(part, op)]).toEqual([op.op, 'chart-drawing']);
      const result = applyTreeOp(part, op);
      expect([op.op, result.ok ? null : result.reason]).toEqual([op.op, 'chart-drawing']);
    }
  }
}

function expectWholeDelete(part: OoxmlPart, ids: readonly string[], removed: string): void {
  for (const id of ids) {
    expect(validateTreeOp(part, { op: 'deleteDrawing', drawingNodeId: id })).toBeNull();
    const result = applyTreeOp(part, { op: 'deleteDrawing', drawingNodeId: id });
    if (!result.ok) throw new Error(result.reason);
    const xml = String(serializeOoxmlPart(result.part));
    expect(xml).not.toContain('AlternateContent');
    expect(xml).not.toContain('w:drawing');
    expect(xml).not.toContain('w:pict');
    expect(result.effect.deleted).toEqual([removed]);
  }
}

for (const classic of [false, true]) {
  const name = classic ? 'classic' : 'chartex';

  test(`${name}: a chart that shows its fallback picture refuses picture edits`, () => {
    const { part, atomId, projection } = chart({ classic, alternateContent: true });
    expect(projection.chartSummary).toEqual({
      title: 'Net',
      plotTypes: [classic ? 'bar' : 'waterfall'],
      shownAs: 'fallback',
    });
    expect(projection.chartFallbackPicture?.embeddedRelationshipId).toBe('rId11');
    const ids = chartIds(part, atomId, projection.drawingNodeId);
    expect(ids).toHaveLength(3);
    expectRefusals(part, ids);
    expectWholeDelete(part, ids, atomId);
  });

  test(`${name}: a VML fallback picture follows the same rule`, () => {
    const { part, atomId, projection } = chart({ classic, alternateContent: true, vml: true });
    expect(projection.chartSummary?.shownAs).toBe('fallback');
    expect(projection.chartFallbackPicture?.embeddedRelationshipId).toBe('rId11');
    const ids = chartIds(part, atomId, projection.drawingNodeId);
    expectRefusals(part, ids);
    expectWholeDelete(part, ids, atomId);
  });

  test(`${name}: a wrapped chart without a fallback shows its placeholder`, () => {
    const { part, atomId, projection } = chart({
      classic,
      alternateContent: true,
      emptyFallback: true,
    });
    expect(projection.chartSummary?.shownAs).toBe('placeholder');
    expect(projection.chartFallbackPicture).toBeUndefined();
    const ids = chartIds(part, atomId, projection.drawingNodeId);
    expectRefusals(part, ids);
    expectWholeDelete(part, ids, atomId);
  });

  test(`${name}: a bare chart drawing takes frame edits, refuses picture edits, deletes whole`, () => {
    const { part, atomId, projection } = chart({ classic });
    expect(projection.chartSummary?.shownAs).toBe('placeholder');
    expect(projection.drawingNodeId).toBe(atomId);
    const frame = new Set(['resizeDrawing', 'setDrawingWrap', 'setDrawingMetadata']);
    for (const op of editsFor(atomId)) {
      // An inline chart has no position to set; the wrap change makes it float first.
      const expected = frame.has(op.op)
        ? null
        : op.op === 'positionDrawing'
          ? 'invalid-drawing-value'
          : 'chart-drawing';
      expect([op.op, validateTreeOp(part, op)]).toEqual([op.op, expected]);
    }
    expectWholeDelete(part, [atomId], atomId);
  });

  test(`${name}: a bare chart resizes, floats and moves by its own anchor`, () => {
    const { part, atomId } = chart({ classic });
    const resized = applyTreeOp(part, {
      op: 'resizeDrawing',
      drawingNodeId: atomId,
      extentEmu: { cx: 914400, cy: 457200 },
    });
    if (!resized.ok) throw new Error(resized.reason);
    expect(String(serializeOoxmlPart(resized.part))).toContain('cx="914400" cy="457200"');
    const floated = applyTreeOp(resized.part, {
      op: 'setDrawingWrap',
      drawingNodeId: atomId,
      wrap: 'square',
    });
    if (!floated.ok) throw new Error(floated.reason);
    const floatedXml = String(serializeOoxmlPart(floated.part));
    expect(floatedXml).toContain('<wp:anchor');
    expect(floatedXml).toContain('<wp:wrapSquare');
    expect(floatedXml).toMatch(/<c:chart |<cx:chart /);
    const moved = applyTreeOp(floated.part, {
      op: 'positionDrawing',
      drawingNodeId: atomId,
      position: { mode: 'simple', horizontalEmu: 127000, verticalEmu: 254000 },
    });
    if (!moved.ok) throw new Error(moved.reason);
    const movedXml = String(serializeOoxmlPart(moved.part));
    expect(movedXml).toContain('<wp:posOffset>127000</wp:posOffset>');
    expect(movedXml).toContain('<wp:posOffset>254000</wp:posOffset>');
  });

  test(`${name}: the chart's own select lock keeps its whole delete from running`, () => {
    for (const options of [
      { classic, alternateContent: true },
      { classic, alternateContent: true, vml: true },
      { classic },
    ]) {
      const { part, atomId, projection } = chart({ ...options, frameLocks: 'noSelect="1"' });
      for (const id of new Set([atomId, projection.drawingNodeId])) {
        const op = { op: 'deleteDrawing', drawingNodeId: id } as const;
        expect(validateTreeOp(part, op)).toBe('drawing-locked');
        const result = applyTreeOp(part, op);
        expect(result.ok ? null : result.reason).toBe('drawing-locked');
      }
    }
  });
}

test('a hidden chart stays hidden when its fallback picture is visible', () => {
  const files = unzipSync(chartexDocx(waterfallChartSpace(), { alternateContent: true }));
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '<wp:docPr id="1" name="Chart 1"/>',
      '<wp:docPr id="1" name="Chart 1" hidden="1"/>'
    )
  );
  const pkg = load(zipSync(files));
  const part = pkg.parts.get('/word/document.xml')!;
  const [projection] = indexInlineDrawingProjectionsInPart(
    part,
    packageDrawingProjectionContext(pkg, part.name)
  ).values();
  expect(projection!.hidden).toBe(true);
  expect(projection!.picture).toBeNull();
  expect(projection!.docPrId).toBe(1);
});
