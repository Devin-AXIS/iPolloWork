import { expect, test } from 'bun:test';
import { inspectDrawingSupport, readOoxmlPackage, canonicalOoxmlFingerprint } from '../index.ts';
import { previewDocument, previewShape } from './drawing-support-fixtures.ts';
import { drawingSourceIssues } from '../package/drawing-support-issues.ts';
function inspect(content: string) {
  const read = readOoxmlPackage(previewDocument(content));
  if (!read.ok) throw new Error(read.reason);
  const before = canonicalOoxmlFingerprint(read.package.parts.get('/word/document.xml')!.root);
  const result = inspectDrawingSupport(read.package);
  expect(canonicalOoxmlFingerprint(read.package.parts.get('/word/document.xml')!.root)).toEqual(
    before
  );
  return result;
}
test('explicit ignored effects are reported even when a shape projects', () => {
  const plain = inspect(previewShape());
  expect(plain.complete).toBe(true);
  expect(plain.entries[0]!.state).toBe('projected');
  expect(plain.entries[0]!.issues).toEqual([]);
  const partial = inspect(previewShape('<a:effectLst><a:blur rad="127000"/></a:effectLst>'));
  expect(partial.entries[0]!.state).toBe('projected');
  expect(partial.entries[0]!.issues).toEqual([
    expect.objectContaining({ code: 'unsupported-effect', detail: 'a:blur', localName: 'blur' }),
  ]);
  expect(partial.entries[0]!.issues[0]!.nodeId).not.toBe(partial.entries[0]!.nodeId);
});
test('floating opaque VML and malformed drawings remain in the source inventory', () => {
  const report = inspect(
    '<w:pict><v:arc style="position:absolute;width:100pt;height:50pt"/></w:pict><w:drawing/>'
  );
  expect(report.entries).toHaveLength(2);
  for (const entry of report.entries) {
    expect(entry.state).toBe('unplaced');
    expect(entry.issues).toContainEqual(expect.objectContaining({ code: 'unplaced-drawing' }));
  }
});
test('a saved fallback retains both branches without reporting effects from the unused choice', () => {
  const report = inspect(
    `<mc:AlternateContent><mc:Choice xmlns:unknown="urn:unknown" Requires="unknown">${previewShape('<a:effectDag/>')}</mc:Choice><mc:Fallback>${previewShape()}</mc:Fallback></mc:AlternateContent>`
  );
  expect(report.entries).toHaveLength(1);
  expect(report.entries[0]!.state).toBe('fallback');
  expect(report.entries[0]!.source.localName).toBe('AlternateContent');
  expect(report.entries[0]!.issues.map((issue) => issue.code)).toEqual(['saved-fallback']);
});
test('hidden drawings stay hidden and 3-D is explicitly unverified', () => {
  const hidden = inspect(previewShape().replace('id="1" name=', 'hidden="1" id="1" name='));
  expect(hidden.entries[0]!.state).toBe('hidden');
  const report = inspect(previewShape('<a:scene3d/><a:sp3d/>'));
  expect(report.entries[0]!.issues.filter((issue) => issue.code === 'unverified-3d')).toHaveLength(
    2
  );
});
test('source inspection reports exhaustion rather than a clean result', () => {
  const report = inspect(previewShape());
  const source = report.entries[0]!.source;
  const huge = {
    ...source,
    children: Array.from({ length: 4100 }, (_, i) => ({ ...source, id: `n${i}`, children: [] })),
  };
  expect(drawingSourceIssues(huge, huge.id)).toContainEqual(
    expect.objectContaining({ code: 'inspection-limit' })
  );
});

test('picture effects distinguish supported adjustments from ignored duotone and blur', async () => {
  const { previewPicture } = await import('./drawing-support-fixtures.ts');
  const supported = inspect(
    previewPicture('<a:grayscl/><a:lum bright="10000"/><a:alphaModFix amt="50000"/>')
  );
  expect(supported.entries[0]!.state).toBe('projected');
  expect(supported.entries[0]!.issues).toEqual([]);
  for (const effect of [
    '<a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FF0000"/></a:duotone>',
    '<a:blur rad="127000"/>',
  ]) {
    const result = inspect(previewPicture(effect));
    expect(result.entries[0]!.state).toBe('projected');
    expect(result.entries[0]!.issues[0]!.code).toBe('unsupported-effect');
  }
});

test('the inventory does not duplicate drawings from an inactive text-box fallback', () => {
  const shape = previewShape().replace(
    '<wps:bodyPr/>',
    `<wps:txbx><w:txbxContent><w:p><w:r>${previewShape()}</w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/>`
  );
  const result = inspect(
    `<mc:AlternateContent><mc:Choice Requires="wps">${shape}</mc:Choice><mc:Fallback>${shape}</mc:Fallback></mc:AlternateContent>`
  );
  expect(result.entries).toHaveLength(2);
  expect(result.entries.every((entry) => entry.state === 'projected')).toBe(true);
});

test('selection scan exhaustion cannot report an empty issue list', () => {
  const report = inspect(previewShape());
  const source = report.entries[0]!.source;
  const wrapper = {
    ...source,
    id: 'wrapper',
    namespaceUri: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    localName: 'AlternateContent',
    children: [
      source,
      ...Array.from({ length: 4100 }, (_, i) => ({ ...source, id: `other${i}`, children: [] })),
    ],
  };
  expect(drawingSourceIssues(wrapper, source.id)).toContainEqual(
    expect.objectContaining({ code: 'inspection-limit', detail: 'drawing-selection-budget' })
  );
});

test('entries name the graphic their source holds, whether or not it renders', async () => {
  const { previewPicture } = await import('./drawing-support-fixtures.ts');
  const { smartArtPackage } = await import('./smartart-fixture.ts');
  expect(inspect(previewShape()).entries[0]!.graphicKind).toBe('textbox');
  expect(inspect(previewPicture()).entries[0]!.graphicKind).toBe('picture');
  expect(
    inspect('<w:pict><v:arc style="position:absolute;width:100pt;height:50pt"/></w:pict>')
      .entries[0]!.graphicKind
  ).toBe('shape');
  const smartArt = inspectDrawingSupport(
    smartArtPackage({ shapes: [{ preset: 'rect', off: [1000, 2000], ext: [3000, 4000] }] })
  ).entries[0]!;
  expect(smartArt.state).toBe('projected');
  expect(smartArt.graphicKind).toBe('diagram');
  expect(smartArt.issues).toEqual([]);
});

test('a legacy horizontal rule reports as projected, not as a placeholder', () => {
  const report = inspect(
    '<w:pict><v:rect xmlns:o="urn:schemas-microsoft-com:office:office" style="width:0;height:1.5pt" o:hralign="center" o:hrstd="t" o:hr="t" fillcolor="#a0a0a0" stroked="f"/></w:pict>'
  );
  expect(report.entries[0]!.state).toBe('projected');
  expect(report.entries[0]!.graphicKind).toBe('shape');
});

test('support gives one verdict: native, partial with issues, or unrendered', async () => {
  const { previewPicture } = await import('./drawing-support-fixtures.ts');
  expect(inspect(previewShape()).entries[0]!.support).toBe('native');
  expect(inspect(previewPicture()).entries[0]!.support).toBe('native');
  expect(
    inspect(previewShape('<a:effectLst><a:blur rad="127000"/></a:effectLst>')).entries[0]!.support
  ).toBe('partial');
  expect(
    inspect(previewShape('<a:scene3d><a:camera prst="orthographicFront"/></a:scene3d>')).entries[0]!
      .support
  ).toBe('partial');
  const unplaced = inspect(
    '<w:pict><v:arc style="position:absolute;width:100pt;height:50pt"/></w:pict>'
  );
  expect(unplaced.entries[0]!.support).toBe('unrendered');
});
