import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { projectFile, readFileBounded, versionOf, writeVersion } from '../../_shared/workspace-document-files.ts';
import { readWorkbook, updateWorkbook } from '../src/workbook.ts';

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const part = (text: string) => strToU8(text);
function workbook() {
  return zipSync({
    'xl/workbook.xml': part(`<workbook xmlns="${ns}" xmlns:r="urn:ref"><sheets>
      <sheet name="预算" sheetId="1" r:id="r1"/><sheet name="Sheet 2" sheetId="2" r:id="r2"/>
      </sheets><calcPr calcId="23"/></workbook>`),
    'xl/_rels/workbook.xml.rels': part(`<Relationships><Relationship Id="r1" Type="${relType}" Target="worksheets/sheet1.xml"/>
      <Relationship Id="r2" Type="${relType}" Target="worksheets/sheet2.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': part(`<worksheet xmlns="${ns}"><dimension ref="A1:B2"/><sheetData>
      <row r="1"><c r="A1" s="3"><v>8</v></c><c r="B1"><f>A1*2</f><v>16</v></c></row>
      <row r="2"><c r="B2" t="inlineStr"><is><t>原文</t></is></c></row></sheetData>
      <mergeCells><mergeCell ref="C2:D2"/></mergeCells></worksheet>`),
    'xl/worksheets/sheet2.xml': part(`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><v>10</v></c></row></sheetData></worksheet>`),
    'xl/styles.xml': part('<styleSheet><fills count="1"/></styleSheet>'),
    'xl/charts/chart1.xml': part('<chartSpace><chart/></chartSpace>'),
  });
}

test('single-cell workbook updates preserve formulas, styles and all unrelated OOXML parts', () => {
  const before = workbook();
  const after = updateWorkbook(before, [
    { sheet: '预算', address: 'A1', kind: 'number', value: '12.5' },
    { sheet: '预算', address: 'D3', kind: 'text', value: '001 & 中文' },
  ]);
  const original = unzipSync(before), updated = unzipSync(after);
  for (const path of ['xl/worksheets/sheet2.xml', 'xl/styles.xml', 'xl/charts/chart1.xml', 'xl/_rels/workbook.xml.rels'])
    assert.deepEqual(updated[path], original[path]);
  const sheet = strFromU8(updated['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /r="A1" s="3"/);
  assert.match(sheet, /<f>A1\*2<\/f>/);
  assert.match(strFromU8(updated['xl/workbook.xml']!), /fullCalcOnLoad="1"/);
  assert.deepEqual(readWorkbook(after)[0]?.cells.map(cell => [cell.address, cell.value]),
    [['A1', '12.5'], ['B1', '=A1*2'], ['B2', '原文'], ['D3', '001 & 中文']]);
  for (const address of ['B1', 'D2']) {
    assert.throws(() => updateWorkbook(before, [{ sheet: '预算', address, kind: 'text', value: 'bad' }]), /protected-cell/);
  }
});

test('versioned saves reject stale edits and preserve the external modification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ipw-workspace-test-'));
  const root = await realpath(directory);
  try {
    const path = join(root, '草稿.md');
    await writeFile(path, '# first');
    const version = versionOf(await readFileBounded(path));
    await writeFile(path, '# external');
    await assert.rejects(writeVersion(root, path, version, part('# stale'), new AbortController().signal), /conflict/);
    assert.equal(await readFile(path, 'utf8'), '# external');
    await writeVersion(root, path, versionOf(await readFileBounded(path)), part('# saved'), new AbortController().signal);
    assert.equal(await readFile(path, 'utf8'), '# saved');
    await assert.rejects(projectFile(root, '../outside.md'), /outside-project/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
