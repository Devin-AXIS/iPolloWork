import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { read, utils, write } from 'xlsx';
import type { FileHost } from '../../_shared/workspace-document-files.ts';
import { apply } from '../src/excel-host.ts';
import type { FileDocument } from '../src/file-contract.ts';
import { clipboardCells, rangeText, singleCell } from '../src/sheet-model.ts';

test('Excel workspace reads formatted values and saves legacy edits to copies', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ipw-excel-')));
  const routes = new Map<string, (request: Request) => Promise<Response>>();
  const session = 'excel-test';
  const ctx: FileHost = {
    connection: { fetch: { register(route) { routes.set(route.methods[0]!, route.fetch); return async () => {}; } } },
    workspaceFiles: { async scopeOf(id) { return id === session ? { workspaceRoot: root } : undefined; } },
    sessions: { get: () => ({}) },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
    fs: { resolve: async path => ({ displayPath: path, targetKey: path }), fileUrl: target => pathToFileURL(target.targetKey).href },
  };
  apply(ctx);
  function fetch(action: string, path: string, data?: object) {
    const method = data ? 'POST' : 'GET';
    const query = new URLSearchParams({ action, session, path });
    return routes.get(method)!(new Request('http://localhost/api/workbook?' + query, {
      method, ...(data && { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    }));
  }
  try {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([['甲', 0.125, 12, '合并'], ['乙', 7, 3]]);
    sheet['B1'].z = '0.0%';
    sheet['C1'].f = 'SUM(B2:C2)';
    sheet['!merges'] = [utils.decode_range('D1:E2')];
    utils.book_append_sheet(workbook, sheet, '财务');
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['保留']]), '清单');
    for (const format of ['xlsx', 'xls', 'ods'] as const) {
      const filename = 'workbook.' + format;
      const bytes: Buffer = write(workbook, { bookType: format, type: 'buffer' });
      await writeFile(join(root, filename), bytes);
      const response = await fetch('document', filename);
      assert.equal(response.status, 200, format + ' should open');
      const book = await response.json() as FileDocument;
      assert.ok(book.kind === 'workbook');
      assert.deepEqual(book.sheets.map(item => item.name), ['财务', '清单']);
      const first = book.sheets[0]!;
      assert.match(first.cells.find(cell => cell.address === 'B1')?.display ?? '', /^12\.50?%$/, format);
      assert.deepEqual(first.blocked, ['D1:E2']);
      if (format === 'xlsx') {
        assert.deepEqual(first.cells.find(cell => cell.address === 'C1'),
          { address: 'C1', value: '=SUM(B2:C2)', display: '12', kind: 'formula' });
        continue;
      }
      assert.equal(book.legacy, true);
      const change = { version: book.version, kind: 'workbook',
        changes: [{ sheet: '财务', address: 'A2', kind: 'text', value: '旧文件编辑' }] };
      assert.equal((await fetch('document', filename, change)).status, 415);
      const copy = await fetch('convert', filename, change);
      assert.equal(copy.status, 200);
      const converted = read(await copy.arrayBuffer(), { type: 'array' });
      assert.equal(converted.Sheets['财务']?.['A2']?.v, '旧文件编辑');
      assert.equal(converted.Sheets['清单']?.['A1']?.v, '保留');
      assert.deepEqual(await readFile(join(root, filename)), Buffer.from(bytes));
    }
    assert.equal((await fetch('document', '../outside.xls')).status, 403);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('range clipboard preserves separators and rejects edits beyond limits', () => {
  const start = { row: 2, column: 2 };
  const values = [['001', 'a\tb'], ['中文', '2"']].flat();
  const copied = rangeText({ start, end: { row: 3, column: 3 } }, point => values[(point.row - 2) * 2 + point.column - 2] ?? '');
  assert.deepEqual(clipboardCells(copied!, start)?.cells.map(cell => cell.value), values);
  assert.equal(rangeText(singleCell(start), () => '单元格'), '单元格');
  assert.equal(clipboardCells('A\tB', { row: 1, column: 16_384 }), undefined);
  assert.equal(clipboardCells('A\n'.repeat(1001), start), undefined);
});
