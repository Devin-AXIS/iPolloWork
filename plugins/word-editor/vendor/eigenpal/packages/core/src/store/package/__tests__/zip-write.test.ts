// The ZIP writer works in steps so a long save never holds the page in one task. Its archive
// layout must stay the one `zipSync` writes, and its output must read back through both the
// bounded reader and an independent one.
import { describe, expect, test } from 'bun:test';
import { deflateSync, unzipSync, zipSync } from 'fflate';
import { readZip, writeZip, writeZipSteps } from '../zip.ts';
import { ZIP_WRITE_SLICE_BYTES, writeZipEntriesSteps } from '../zip-write.ts';

const MTIME = new Date(Date.UTC(1980, 0, 2, 12));

function drain<T>(steps: Generator<void, T>): { value: T; yields: number } {
  let yields = 0;
  for (;;) {
    const next = steps.next();
    if (next.done) return { value: next.value, yields };
    yields += 1;
  }
}

/** Compressible bytes longer than one slice, with enough variety to need real deflating. */
function longEntry(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + (index >> 7)) & 0x7f;
  return bytes;
}

describe('ZIP writer', () => {
  test('writes the zipSync layout byte for byte', () => {
    const entries = new Map<string, Uint8Array>([
      ['[Content_Types].xml', new TextEncoder().encode('<Types/>')],
      ['word/document.xml', new TextEncoder().encode('<w:document/>'.repeat(50))],
      ['word/média/émpty.bin', new Uint8Array(0)],
    ]);
    const { value } = drain(
      writeZipEntriesSteps(entries, MTIME, function* (data) {
        return deflateSync(data);
      })
    );
    expect([...value]).toEqual([...zipSync(Object.fromEntries(entries), { mtime: MTIME })]);
  });

  test('deflates a long entry across steps and reads back unchanged', () => {
    const long = longEntry(ZIP_WRITE_SLICE_BYTES * 4 + 123);
    const entries = new Map<string, Uint8Array>([
      ['/word/document.xml', long],
      ['/[Content_Types].xml', new TextEncoder().encode('<Types/>')],
    ]);
    const { value, yields } = drain(writeZipSteps(entries));
    expect(yields).toBeGreaterThanOrEqual(8);
    expect([...value]).toEqual([...writeZip(entries)]);

    const independent = unzipSync(value);
    expect([...independent['word/document.xml']!]).toEqual([...long]);
    const bounded = readZip(value);
    if (!bounded.ok) throw new Error(bounded.reason);
    expect(bounded.entries.get('/word/document.xml')).toEqual(long);
  });

  test('refuses unsafe part names before writing anything', () => {
    expect(() => writeZipSteps(new Map([['/../evil.xml', new Uint8Array(1)]]))).toThrow(
      /unsafe part name/
    );
  });
});
