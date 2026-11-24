import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDelimitedSpreadsheet, serializeDelimitedSpreadsheet } from '../src/delimited.ts';

test('CSV and TSV round-trip quoted separators, line breaks, leading zeros, and empty borders', () => {
  const rows = [['编号', '说明', ''], ['001', '中文, spaced\tvalue\r\n他说 "你好"', ''], ['', '', '']];
  for (const delimiter of [',', '\t']) {
    for (const lineEnding of ['\r\n', '\n', '\r']) {
      const serialized = serializeDelimitedSpreadsheet(rows, delimiter, lineEnding);
      assert.deepEqual(parseDelimitedSpreadsheet(serialized, delimiter), rows);
    }
  }
  assert.deepEqual(parseDelimitedSpreadsheet('1,a "quote"\n', ','), [['1', 'a "quote"']]);
});
